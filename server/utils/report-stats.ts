import {
	findAllSkills,
	findAssessmentRecordsByUser,
	findLearningPathItems,
	findLearningPathsByUser,
	findLearningRecordsByUser,
	findUserSkills,
} from "../repositories/learning.repository"
import { asRecord, LlmFormatError, str, strArray } from "./llm-json"

/**
 * 学习报告的「客观部分」。
 *
 * 抽出来是为了让报告能分两段给用户：
 * 1. 数字（进度、掌握率、分类分布）——纯数据库计算，毫秒级，可以立刻渲染；
 * 2. 叙述（总评、亮点、短板、下一步）——要等大模型，慢。
 *
 * 不拆的话用户只能盯着一个转圈等全部算完；拆开后数字先落地，
 * 叙述区单独显示骨架，观感上「报告已经在生成」而不是「页面卡住了」。
 */

export interface ReportPathRow {
	name: string
	generationStatus: string
	total: number
	completed: number
	nextSkill: string | null
	completedSkillIds: number[]
	skillIds: number[]
}

export interface ReportOverview {
	totalAssessments: number
	masteredSkills: number
	learningSkills: number
	totalSkills: number
	masteryRate: number
	learningRecords: number
	learningPaths: number
	totalItems: number
	completedItems: number
}

export interface ReportStats {
	generatedAt: string
	/** 既没有路径也没有测评：没有素材可复盘 */
	empty: boolean
	overview: ReportOverview
	skillBreakdown: Record<string, number>
	recentAssessments: { score: number, date: string }[]
	profileText: string[]
	pathRows: ReportPathRow[]
	totalItems: number
	completedItems: number
}

export function buildReportStats(userId: number, userName: string): ReportStats {
	const assessments = findAssessmentRecordsByUser(userId)
	const userSkills = findUserSkills(userId)
	const learningRecords = findLearningRecordsByUser(userId)
	const paths = findLearningPathsByUser(userId)

	const allSkills = findAllSkills()
	const skillNameById = new Map(allSkills.map((skill) => [skill.id, skill.name]))
	const skillCategoryById = new Map(allSkills.map((skill) => [skill.id, skill.category]))

	// 逐条路径取关卡：路径数量很少，这里不做批量优化，读起来更直白
	const pathRows: ReportPathRow[] = paths.map((path) => {
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

	const overview: ReportOverview = {
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

	const profileText = [
		`学习者：${userName}`,
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

	return {
		generatedAt: new Date().toISOString(),
		empty: paths.length === 0 && assessments.length === 0,
		overview,
		skillBreakdown,
		recentAssessments: assessments
			.slice(0, 3)
			.map((record) => ({ score: record.score, date: record.created_at })),
		profileText,
		pathRows,
		totalItems,
		completedItems,
	}
}

export interface NextStep {
	title: string
	reason: string
}

export interface ReportNarrative {
	summary: string
	highlights: string[]
	gaps: string[]
	nextSteps: NextStep[]
}

/** 允许 reason 缺失：模型偶尔只给标题 */
function optionalStr(value: unknown, max: number): string {
	return typeof value === "string" ? value.trim().slice(0, max) : ""
}

/** 严格版：JSON 模式（chatJson）用，格式不对就抛，交给重试 */
export function validateNarrative(value: unknown): ReportNarrative {
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

/**
 * 宽松版：流式模式用。
 *
 * 流式拿不到 JSON 模式保证，模型可能先写一段自然语言再给 JSON，
 * 所以这里不抛异常——解析不出来返回 null，由调用方决定降级文案。
 */
export function parseReportNarrative(text: string): ReportNarrative | null {
	const candidates: string[] = []

	// 优先取 ```json 代码块
	const fenced = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)].map((match) => match[1] ?? "")
	candidates.push(...fenced)

	// 再退化为「首个 { 到最后一个 }」
	const start = text.indexOf("{")
	const end = text.lastIndexOf("}")
	if (start >= 0 && end > start) candidates.push(text.slice(start, end + 1))

	for (const candidate of candidates) {
		try {
			const raw = JSON.parse(candidate.trim()) as unknown
			return validateNarrative(raw)
		} catch {
			// 换下一个候选
		}
	}
	return null
}

export function buildReportMessages(profileText: string[]) {
	return [
		{
			role: "system" as const,
			content: [
				"你是学习教练，根据真实数据写一份简短、具体的阶段复盘。",
				"硬性要求：",
				"1. 只依据给出的数据，不编造数字、不虚构未发生的事。",
				"2. 禁止套话（如「继续保持」「相信你可以」），每条结论都要能对应到具体关卡或数字。",
				"3. 指出短板时，必须同时说清下一步怎么做。",
				"4. 先用 1~2 句自然语言概括，然后输出 JSON 对象，用 ```json 代码块包裹。",
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
}

/** 模型没产出时的客观描述：只陈述数据，不写任何"建议"，避免看起来像 AI 结论 */
export function buildFallbackSummary(stats: ReportStats): string {
	return stats.totalItems > 0
		? `共 ${stats.overview.learningPaths} 条学习路径、${stats.totalItems} 个关卡，已完成 ${stats.completedItems} 个（${Math.round((stats.completedItems / stats.totalItems) * 100)}%）。`
		: `已创建 ${stats.overview.learningPaths} 条学习路径，还没有完成任何关卡。`
}
