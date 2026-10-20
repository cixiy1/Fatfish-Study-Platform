import {
	createLearningReport,
	findAllSkills,
	findAssessmentRecordsByUser,
	findLearningPathItems,
	findLearningPathsByUser,
	findLearningRecordsByUser,
	findUserSkills,
} from "../../repositories/learning.repository"
import { findUserByAccount } from "../../repositories/user.repository"
import { chatJson } from "../../utils/llm"
import { asRecord, LlmFormatError, str, strArray } from "../../utils/llm-json"
import { readSession } from "../../utils/session"

/**
 * 生成学习复盘：POST /api/reports/generate
 *
 * 分工：
 * - 数字（进度、掌握率、分类分布）由数据库算，保证真实；
 * - 叙述（总评、亮点、短板、下一步）交给大模型，避免模板化套话。
 *
 * 模型调用失败时仍然返回真实统计，但 `aiGenerated=false` 并给出说明，
 * 不拿规则文本冒充模型产出。
 */

interface NextStep {
	title: string
	reason: string
}

interface ReportNarrative {
	summary: string
	highlights: string[]
	gaps: string[]
	nextSteps: NextStep[]
}

/** 允许 reason 缺失：模型偶尔只给标题 */
function optionalStr(value: unknown, max: number): string {
	return typeof value === "string" ? value.trim().slice(0, max) : ""
}

function validateNarrative(value: unknown): ReportNarrative {
	const record = asRecord(value)
	const summary = str(record.summary, 10, 600, "summary")

	const highlights = strArray(record.highlights ?? [], 0, 4, 80, "highlights")
	const gaps = strArray(record.gaps ?? [], 0, 4, 80, "gaps")

	const rawSteps = Array.isArray(record.nextSteps) ? record.nextSteps : []
	const nextSteps = rawSteps
		.slice(0, 3)
		.map((item) => {
			const step = asRecord(item)
			return {
				title: str(step.title, 2, 40, "nextSteps.title"),
				reason: optionalStr(step.reason, 120),
			}
		})
		.filter((step) => step.title)

	if (nextSteps.length === 0) throw new LlmFormatError("nextSteps 为空")

	return { summary, highlights, gaps, nextSteps }
}

export default defineEventHandler(async (event) => {
	const session = readSession(event)
	if (!session) throw createError({ statusCode: 401, message: "未登录" })

	const user = findUserByAccount(session.account)
	if (!user) throw createError({ statusCode: 401, message: "用户不存在" })

	const assessments = findAssessmentRecordsByUser(user.id)
	const userSkills = findUserSkills(user.id)
	const learningRecords = findLearningRecordsByUser(user.id)
	const paths = findLearningPathsByUser(user.id)

	const allSkills = findAllSkills()
	const skillNameById = new Map(allSkills.map((skill) => [skill.id, skill.name]))
	const skillCategoryById = new Map(allSkills.map((skill) => [skill.id, skill.category]))

	// 逐条路径取关卡：路径数量很少，这里不做批量优化，读起来更直白
	const pathRows = paths.map((path) => {
		const items = findLearningPathItems(path.id)
		const completed = items.filter((item) => item.status === "completed")
		const next = items.find((item) => item.status !== "completed")
		const skillIds = items
			.map((item) => item.skill_id)
			.filter((id): id is number => typeof id === "number")

		return {
			name: path.name,
			generationStatus: path.generation_status,
			total: items.length,
			completed: completed.length,
			nextSkill: next?.skill_id ? skillNameById.get(next.skill_id) ?? null : null,
			completedSkillIds: completed
				.map((item) => item.skill_id)
				.filter((id): id is number => typeof id === "number"),
			skillIds,
		}
	})

	const pathSkillIds = new Set<number>()
	for (const row of pathRows) row.skillIds.forEach((id) => pathSkillIds.add(id))

	const masteredSkills = userSkills.filter((skill) => skill.status === "mastered")
	const learningSkills = userSkills.filter((skill) => skill.status === "learning")

	const totalItems = pathRows.reduce((sum, row) => sum + row.total, 0)
	const completedItems = pathRows.reduce((sum, row) => sum + row.completed, 0)
	// 掌握率只在「学习者自己的范围」里算：用全站技能数做分母会让比率永远贴近 0
	const totalSkills = pathSkillIds.size || userSkills.length
	const masteryRate = totalSkills > 0
		? Math.round((masteredSkills.length / totalSkills) * 100)
		: 0

	// 分类分布按「路径里已完成的技能」的真实分类统计，不再写死前端/后端/数据/AI/制造
	const skillBreakdown: Record<string, number> = {}
	for (const row of pathRows) {
		for (const skillId of row.completedSkillIds) {
			const category = skillCategoryById.get(skillId) ?? "其他"
			skillBreakdown[category] = (skillBreakdown[category] ?? 0) + 1
		}
	}

	const overview = {
		totalAssessments: assessments.length,
		masteredSkills: masteredSkills.length,
		learningSkills: learningSkills.length,
		totalSkills,
		masteryRate,
		learningRecords: learningRecords.length,
		learningPaths: paths.length,
		totalItems,
		completedItems,
	}

	const generatedAt = new Date().toISOString()
	const recentAssessments = assessments
		.slice(0, 3)
		.map((record) => ({ score: record.score, date: record.created_at }))

	// 空态：没有路径也没有记录时，模型没有素材可复盘，直接给引导而不是让它在真空里编
	if (paths.length === 0 && assessments.length === 0) {
		const summary = "还没有可复盘的学习记录。先确定一个学习方向并完成前几关，再回来生成报告。"
		return {
			generatedAt,
			empty: true,
			aiGenerated: false,
			model: null,
			overview,
			skillBreakdown,
			recentAssessments,
			summary,
			highlights: [],
			gaps: ["暂无学习数据，无法判断薄弱环节"],
			nextSteps: [
				{ title: "确定一个学习方向", reason: "有方向后系统才能拆成可执行的每日关卡" },
				{ title: "完成前 3 关", reason: "有了完成记录，复盘才有依据" },
			],
			recommendation: summary,
		}
	}

	const profileText = [
		`学习者：${user.name}`,
		`学习路径：${pathRows.length} 条`,
		...pathRows.map((row) => {
			const progress = row.total > 0 ? `${row.completed}/${row.total} 关` : "尚未拆关"
			const next = row.nextSkill ? `，下一关是「${row.nextSkill}」` : ""
			return `- ${row.name}（${progress}${next}）`
		}),
		`关卡合计：${completedItems}/${totalItems} 关已完成`,
		`已掌握技能：${masteredSkills.length} 项；学习中：${learningSkills.length} 项`,
		"",
		`测评：${assessments.length > 0
			? `${assessments.length} 次，最近一次完成 ${assessments[0]?.score ?? 0} 题作答`
			: "未做测评"}`,
		`分类分布（已完成）：${Object.keys(skillBreakdown).length > 0
			? Object.entries(skillBreakdown).map(([key, value]) => `${key} ${value}`).join("、")
			: "暂无"}`,
	]

	const messages = [
		{
			role: "system" as const,
			content: [
				"你是学习教练，根据真实数据写一份简短、具体的阶段复盘。",
				"硬性要求：",
				"1. 只依据给出的数据，不编造数字、不虚构未发生的事。",
				"2. 禁止套话（如「继续保持」「相信你可以」），每条结论都要能对应到具体关卡或数字。",
				"3. 指出短板时，必须同时说清下一步怎么做。",
				"4. 只输出 JSON 对象，不要 Markdown 代码块包裹。",
			].join("\n"),
		},
		{
			role: "user" as const,
			content: [
				...profileText,
				"",
				"请输出这份复盘：",
				'{"summary":"总评（80~150字）","highlights":["2~3条具体亮点"],"gaps":["1~3条具体短板"],"nextSteps":[{"title":"下一步动作（12字内，动词开头）","reason":"为什么做（30字内）"}]}',
				"",
				"字段要求：",
				"- summary：说清「现在处在什么阶段、推进节奏如何、卡在哪」，不要罗列数字",
				"- highlights：只写数据能支撑的事实，如「已完成 4 关并推进到第 5 关」",
				"- gaps：最多 3 条；数据太少时就写「样本不足，暂无法判断」，不要硬凑",
				"- nextSteps：恰好 2~3 条，按优先级排列，第一条必须是马上能做的事",
			].join("\n"),
		},
	]

	let narrative: ReportNarrative | null = null
	let model: string | null = null
	let degradedReason: string | null = null

	try {
		const result = await chatJson<ReportNarrative>({
			messages,
			temperature: 0.4,
			maxTokens: 3000,
			timeoutMs: 90_000,
			maxAttempts: 2,
			tag: `report:${user.id}`,
			validate: validateNarrative,
			allowMockOnError: false,
			mock: () => ({ summary: "", highlights: [], gaps: [], nextSteps: [] }),
		})

		if (!result.mock) {
			narrative = result.data
			model = result.model
		}
	} catch (error) {
		degradedReason = error instanceof Error ? error.message : "大模型调用失败"
		console.warn(`[report] narrative failed user=${user.id} error=${degradedReason}`)
	}

	// 模型没产出时只给客观数据描述，不写任何"建议"，避免看起来像 AI 结论
	const fallbackSummary = totalItems > 0
		? `共 ${paths.length} 条学习路径、${totalItems} 个关卡，已完成 ${completedItems} 个（${Math.round((completedItems / totalItems) * 100)}%）。`
		: `已创建 ${paths.length} 条学习路径，还没有完成任何关卡。`

	const summary = narrative?.summary ?? fallbackSummary
	const aiGenerated = narrative !== null

	const payload = {
		generatedAt,
		empty: false,
		aiGenerated,
		model,
		degradedReason,
		overview,
		skillBreakdown,
		recentAssessments,
		summary,
		highlights: narrative?.highlights ?? [],
		gaps: narrative?.gaps ?? [],
		nextSteps: narrative?.nextSteps ?? [],
		// 兼容旧字段：报告列表/详情读的是 recommendation
		recommendation: summary,
	}

	createLearningReport(user.id, "stage", null, null, JSON.stringify(payload))
	return payload
})
