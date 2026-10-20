import {
	findAllResources,
	findAllSkills,
	findLearningPathItems,
	findLearningPathsByUser,
	findResourceById,
	findUserSkills,
} from "../repositories/learning.repository"

/**
 * 智能答疑的上下文装配。
 *
 * 抽出来是为了让「整页问答」和「单关追问」共用同一套检索与 prompt——
 * 单关追问额外注入当前关卡正文，但进度/技能/历史这些部分是共有的，
 * 之前两者如果各写一份，prompt 行为会悄悄漂移。
 */

export const MAX_QUESTION_LENGTH = 500
export const MAX_CONTEXT_RESOURCES = 3
export const MAX_EXCERPT_LENGTH = 800

const DIFFICULTY_LABEL: Record<string, string> = {
	beginner: "入门",
	intermediate: "进阶",
	advanced: "高级",
}

export interface LearningContext {
	paths: { name: string, completed: number, total: number, nextSkill: string | null }[]
	mastered: string[]
}

export function collectLearningContext(userId: number, skillNameById: Map<number, string>): LearningContext {
	const paths = findLearningPathsByUser(userId).slice(0, 3)
	const rows = paths.map((path) => {
		const items = findLearningPathItems(path.id)
		const completed = items.filter((item) => item.status === "completed").length
		const next = items.find((item) => item.status !== "completed")
		const nextSkill = next?.skill_id ? skillNameById.get(next.skill_id) ?? null : null
		return { name: path.name, completed, total: items.length, nextSkill }
	})

	const userSkills = findUserSkills(userId)
	const mastered = userSkills
		.filter((skill) => skill.status === "mastered")
		.map((skill) => skillNameById.get(skill.skill_id))
		.filter((name): name is string => Boolean(name))
		.slice(0, 10)

	return { paths: rows, mastered }
}

/** 学习者进行中路径覆盖的方向集合（归档路径不算）；没有任何进行中路径时返回 undefined（检索不设限） */
export function activePositionIds(userId: number): Set<number> | undefined {
	const ids = findLearningPathsByUser(userId)
		.filter((path) => path.status !== "archived")
		.map((path) => path.target_position_id)
		.filter((id): id is number => typeof id === "number" && id > 0)
	return ids.length > 0 ? new Set(ids) : undefined
}

/**
 * 关键词检索：模型生成回答前的候选上下文（也作为降级时的输出）。
 *
 * allowedPositionIds 是学习者自己路径的方向集合：资料只在
 * 「无方向标记 或 属于这些方向」时才入围。否则学英语四级的问「短对话」，
 * 会把韩语方向的同名课文摘录喂给模型——和路径生成那次串味是同一个病根。
 * 没传（用户还没有任何路径）时不过滤，无法判断方向就只能不设限。
 */
export function searchKnowledge(question: string, allowedPositionIds?: Set<number>) {
	const skills = findAllSkills()
	const resources = findAllResources()

	const keywords = question
		.toLowerCase()
		.split(/[\s,，。？?!！:：；;、]+/)
		.map((word) => word.trim())
		.filter((word) => word.length > 1)

	const matchedSkills = keywords.length === 0
		? []
		: skills.filter((skill) =>
				keywords.some((word) =>
					skill.name.toLowerCase().includes(word)
					|| (skill.description ?? "").toLowerCase().includes(word),
				),
			).slice(0, 5)

	const matchedResources = keywords.length === 0
		? []
		: resources.filter((resource) => {
				if (allowedPositionIds && resource.position_id !== null && !allowedPositionIds.has(resource.position_id)) {
					return false
				}
				return keywords.some((word) =>
					resource.title.toLowerCase().includes(word)
					|| (resource.description ?? "").toLowerCase().includes(word),
				)
			}).slice(0, MAX_CONTEXT_RESOURCES)

	return { matchedSkills, matchedResources }
}

/** 降级回答：只列命中的资料，明确说明不是模型生成 */
export function buildFallbackAnswer(question: string, search: ReturnType<typeof searchKnowledge>): string {
	const { matchedSkills, matchedResources } = search

	if (matchedSkills.length === 0 && matchedResources.length === 0) {
		return `平台内没有找到与「${question}」相关的内容。（本次大模型不可用，以上为关键词检索结果）`
	}

	const lines = ["**平台内找到的相关内容**", ""]
	if (matchedSkills.length > 0) {
		lines.push("**相关技能**")
		for (const skill of matchedSkills) {
			lines.push(`- ${skill.name}${skill.description ? `：${skill.description}` : ""}`)
		}
		lines.push("")
	}
	if (matchedResources.length > 0) {
		lines.push("**相关关卡资料**")
		for (const resource of matchedResources) {
			const difficulty = DIFFICULTY_LABEL[resource.difficulty] ?? resource.difficulty
			lines.push(`- ${resource.title}（${difficulty}）${resource.description ? `：${resource.description}` : ""}`)
		}
		lines.push("")
	}
	lines.push("_本次大模型不可用，以上为关键词检索结果。_")
	return lines.join("\n")
}

export interface QaPromptInput {
	question: string
	context: LearningContext
	search: ReturnType<typeof searchKnowledge>
	history: { question: string, answer: string | null }[]
	/**
	 * 当前关卡的正文节选（单关追问时注入）。
	 * 有了它模型才能回答「这段里说的 X 是什么意思」这类强依赖上下文的问题。
	 */
	lesson?: { title: string, excerpt: string } | null
}

export function buildQaMessages(input: QaPromptInput) {
	const { question, context, search, history, lesson } = input

	const progressLines = context.paths.length > 0
		? context.paths.map((row) => {
				const progress = row.total > 0 ? `${row.completed}/${row.total} 关` : "尚未拆关"
				const next = row.nextSkill ? `，下一关「${row.nextSkill}」` : ""
				return `- ${row.name}：已完成 ${progress}${next}`
			})
		: ["- 还没有学习路径（尚未确定方向）"]

	const knowledgeLines: string[] = []
	for (const skill of search.matchedSkills) {
		knowledgeLines.push(`- 技能「${skill.name}」：${skill.description ?? "无描述"}`)
	}
	for (const item of search.matchedResources) {
		const detail = findResourceById(item.id)
		const excerpt = (detail?.content ?? item.description ?? "")
			.replace(/\s+/g, " ")
			.slice(0, MAX_EXCERPT_LENGTH)
		const difficulty = DIFFICULTY_LABEL[item.difficulty] ?? item.difficulty
		knowledgeLines.push(`- 关卡资料《${item.title}》（${difficulty}）：${excerpt || "无正文"}`)
	}

	const historyLines = history.length > 0
		? history.map((item) => `问：${item.question}\n答：${(item.answer ?? "").slice(0, 200)}`)
		: []

	const lessonBlock = lesson?.excerpt
		? ["", `学习者当前正在学的关卡《${lesson.title}》正文节选（回答优先基于这段内容）：`, lesson.excerpt]
		: []

	return [
		{
			role: "system" as const,
			content: [
				"你是这个学习平台的答疑助手，回答学习者提出的具体问题。",
				"要求：",
				"1. 先给结论，再给步骤或示例；涉及代码就给能直接运行的片段。",
				"2. 优先结合学习者的当前进度和平台内资料，让回答落到他正在学的那一关。",
				"3. 资料不足时直接说「平台内没有这部分资料」，再给通用的学习路径建议，不要编造事实。",
				"4. 用 Markdown，控制在 400 字以内，不说「以下是」「希望对你有帮助」这类废话。",
				"5. 回答用简体中文；外语例句只能是学习者所学方向对应的那一门外语，不能夹杂其他语种。",
				...(lesson?.excerpt ? ["6. 已给出当前关卡的正文节选时，回答要紧扣它，不要泛泛而谈。"] : []),
			].join("\n"),
		},
		{
			role: "user" as const,
			content: [
				`学习者的问题：${question}`,
				"",
				"学习者的当前进度：",
				...progressLines,
				context.mastered.length > 0 ? `- 已掌握：${context.mastered.join("、")}` : "- 已掌握：暂无",
				...lessonBlock,
				"",
				knowledgeLines.length > 0
					? `平台内检索到的相关内容：\n${knowledgeLines.join("\n")}`
					: "平台内没有检索到相关内容，请基于通用知识回答，并提示这一点。",
				...(historyLines.length > 0
					? ["", "最近的历史问答（仅供理解上下文，不要重复回答）：", ...historyLines]
					: []),
			].join("\n"),
		},
	]
}
