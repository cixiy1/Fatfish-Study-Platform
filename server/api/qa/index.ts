import {
	createQARecord,
	findAllResources,
	findAllSkills,
	findLearningPathItems,
	findLearningPathsByUser,
	findQARecordsByUser,
	findResourceById,
	findUserSkills,
} from "../../repositories/learning.repository"
import { findUserByAccount } from "../../repositories/user.repository"
import { chat } from "../../utils/llm"
import { readSession } from "../../utils/session"

/**
 * 智能答疑：GET /api/qa（历史） POST /api/qa（提问）
 *
 * 回答由大模型生成，上下文分两层：
 * 1. 学习者当前进度（路径、关卡、已掌握技能）——决定回答的深浅；
 * 2. 平台内关键词命中的资料正文节选——让回答能落到用户正在学的内容上。
 *
 * 模型不可用时退回「命中的资料清单」，并在回答里写明不是模型生成，
 * 不伪装成 AI 结论。
 */

const MAX_QUESTION_LENGTH = 500
const MAX_CONTEXT_RESOURCES = 3
const MAX_EXCERPT_LENGTH = 800

const DIFFICULTY_LABEL: Record<string, string> = {
	beginner: "入门",
	intermediate: "进阶",
	advanced: "高级",
}

interface LearningContext {
	paths: { name: string, completed: number, total: number, nextSkill: string | null }[]
	mastered: string[]
}

function collectLearningContext(userId: number, skillNameById: Map<number, string>): LearningContext {
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

/** 关键词检索：模型生成回答前的候选上下文（也作为降级时的输出） */
function searchKnowledge(question: string) {
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
		: resources.filter((resource) =>
				keywords.some((word) =>
					resource.title.toLowerCase().includes(word)
					|| (resource.description ?? "").toLowerCase().includes(word),
				),
			).slice(0, MAX_CONTEXT_RESOURCES)

	return { matchedSkills, matchedResources }
}

/** 降级回答：只列命中的资料，明确说明不是模型生成 */
function buildFallbackAnswer(question: string, search: ReturnType<typeof searchKnowledge>): string {
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

function buildMessages(
	question: string,
	context: LearningContext,
	search: ReturnType<typeof searchKnowledge>,
	history: { question: string, answer: string | null }[],
) {
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

export default defineEventHandler(async (event) => {
	const session = readSession(event)
	if (!session) throw createError({ statusCode: 401, message: "未登录" })

	const user = findUserByAccount(session.account)
	if (!user) throw createError({ statusCode: 401, message: "用户不存在" })

	if (event.method === "POST") {
		return handleQuestion(event, user.id, user.name)
	}
	return findQARecordsByUser(user.id)
})

async function handleQuestion(
	event: Parameters<Parameters<typeof defineEventHandler>[0]>[0],
	userId: number,
	userName: string,
) {
	const body = await readBody<{ question?: string }>(event).catch(() => null)
	const question = (body?.question ?? "").trim()

	if (!question) throw createError({ statusCode: 400, message: "请输入问题" })
	if (question.length > MAX_QUESTION_LENGTH) {
		throw createError({ statusCode: 400, message: `问题长度不能超过 ${MAX_QUESTION_LENGTH} 字` })
	}

	const skillNameById = new Map(findAllSkills().map((skill) => [skill.id, skill.name]))
	const context = collectLearningContext(userId, skillNameById)
	const search = searchKnowledge(question)
	const history = findQARecordsByUser(userId, 2)

	let answer = ""
	let source: "llm" | "fallback" = "llm"
	let model: string | null = null

	try {
		const result = await chat({
			messages: buildMessages(question, context, search, history),
			temperature: 0.3,
			maxTokens: 2500,
			timeoutMs: 60_000,
			retries: 1,
			tag: `qa:${userId}`,
			allowMockOnError: false,
		})

		if (result.mock || !result.text.trim()) throw new Error("模型未返回内容")

		answer = result.text.trim()
		model = result.model
	} catch (error) {
		const reason = error instanceof Error ? error.message : "大模型调用失败"
		console.warn(`[qa] llm failed user=${userId} error=${reason}`)
		source = "fallback"
		answer = buildFallbackAnswer(question, search)
	}

	const recordContext = JSON.stringify({
		source,
		model,
		skills: search.matchedSkills.map((skill) => skill.id),
		resources: search.matchedResources.map((resource) => resource.id),
		asker: userName,
	})

	createQARecord(userId, question, answer, recordContext)
	return { question, answer, source, model }
}
