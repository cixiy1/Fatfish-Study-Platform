import { createError } from "h3"
import {
	findAllSkills,
	findAssessmentRecordsByUser,
	findPositionById,
	findSkillsByPosition,
	findStudyPositions,
	findUserProfile,
	findUserSkills,
	parseProfileData,
} from "../repositories/learning.repository"

/**
 * 能力测评的方向上下文。
 *
 * 为什么要有这层：出题一开始只读 user_profiles.career_direction（用户第一次
 * 选中的那个方向），技能范围又是 findUserSkills(userId) —— 全方向混在一起。
 * 结果就是：用户后来新增了「日语 N4」「雅思 7 分」这些方向，
 * 点开能力测评看到的仍然是当年 Java 那套题；测完还会把结论写到别的方向头上。
 *
 * 现在统一由 resolveAssessmentContext 决定「这次测评考哪个方向、考哪些技能」：
 * - 传了 positionId 就严格按它（越权直接 403，不静默回退）
 * - 没传就按「当前主方向」（profile_data.aiDirection）→「最近在学的方向」→ 无方向
 */

export interface AssessmentSkillBrief {
	id: number
	name: string
	category: string
	level: number
	requiredLevel: number
	/** 用户在该技能上的状态：mastered / learning / not_started / 未记录 */
	status: string
}

export interface AssessmentContext {
	positionId: number | null
	positionName: string | null
	positionCategory: string | null
	positionDescription: string | null
	/** 该方向的学习目标（onboarding 里填的）*/
	goal: string | null
	/** 自评水平：零基础 / 入门 / 有基础 / 熟练 */
	level: string | null
	dailyMinutes: number | null
	/** 只含该方向的技能；无方向时退化为「用户已记录的技能」 */
	skills: AssessmentSkillBrief[]
	progress: { total: number, completed: number } | null
	/** 该方向上一次的测评结论，用于避免重复出同一批题 */
	previous: { direction: string, strengths: string[], weaknesses: string[], recommendation: string } | null
}

const STATUS_LABEL: Record<string, string> = {
	mastered: "已掌握",
	learning: "学习中",
	not_started: "未开始",
}

function toStatusMap(userId: number): Map<number, string> {
	const map = new Map<number, string>()
	for (const row of findUserSkills(userId)) map.set(row.skill_id, row.status)
	return map
}

function parsePrevious(raw: string | null): AssessmentContext["previous"] {
	if (!raw) return null
	try {
		const data = JSON.parse(raw) as Record<string, unknown>
		const arr = (value: unknown) => (Array.isArray(value)
			? value.filter((item): item is string => typeof item === "string")
			: [])
		return {
			direction: typeof data.careerDirection === "string" ? data.careerDirection : "",
			strengths: arr(data.strengths),
			weaknesses: arr(data.weaknesses),
			recommendation: typeof data.recommendation === "string" ? data.recommendation : "",
		}
	} catch {
		return null
	}
}

/** 校验方向归属：种子方向（owner 为空）任何人可用，AI 方向只能本人用 */
export function assertPositionAccess(positionId: number, userId: number): void {
	const position = findPositionById(positionId)
	if (!position) throw createError({ statusCode: 404, message: "学习方向不存在" })
	if (position.owner_user_id !== null && position.owner_user_id !== userId) {
		throw createError({ statusCode: 403, message: "无权使用该学习方向" })
	}
}

/**
 * 解析本次测评的方向上下文。
 *
 * @param requestedPositionId 前端显式选择的；不传则按主方向 / 最近在学的方向
 */
export function resolveAssessmentContext(userId: number, requestedPositionId?: number | null): AssessmentContext {
	const profile = findUserProfile(userId)
	const profileData = parseProfileData(profile?.profile_data ?? null)
	const aiDirection = profileData.aiDirection as
		| { positionId?: number, profile?: { goal?: string | null, level?: string | null } }
		| undefined

	const studyPositions = findStudyPositions(userId)

	let positionId: number | null = null
	if (requestedPositionId && Number.isFinite(requestedPositionId) && requestedPositionId > 0) {
		assertPositionAccess(requestedPositionId, userId)
		positionId = requestedPositionId
	} else if (aiDirection?.positionId) {
		// 主方向可能已被归档/删除，校验失败就退回最近在学的方向
		const exists = findPositionById(aiDirection.positionId)
		if (exists && (exists.owner_user_id === null || exists.owner_user_id === userId)) {
			positionId = aiDirection.positionId
		}
	}
	if (!positionId && studyPositions.length > 0) positionId = studyPositions[0].id

	const statusMap = toStatusMap(userId)

	if (!positionId) {
		// 无方向：只能拿用户自己记录过的技能，凑不出就用技能库前 12 个
		const recorded = findUserSkills(userId).map((row) => row.skill_id)
		const all = findAllSkills()
		const picked = recorded.length > 0
			? all.filter((skill) => recorded.includes(skill.id))
			: all.slice(0, 12)
		return {
			positionId: null,
			positionName: null,
			positionCategory: null,
			positionDescription: null,
			goal: profile?.learning_goal ?? aiDirection?.profile?.goal ?? null,
			level: aiDirection?.profile?.level ?? null,
			dailyMinutes: (profileData.dailyMinutes as number | undefined) ?? null,
			skills: picked.slice(0, 20).map((skill) => ({
				id: skill.id,
				name: skill.name,
				category: skill.category,
				level: skill.level,
				requiredLevel: skill.level,
				status: statusMap.get(skill.id) ?? "not_started",
			})),
			progress: null,
			previous: null,
		}
	}

	const position = findPositionById(positionId)
	const skills = findSkillsByPosition(positionId)
	const study = studyPositions.find((item) => item.id === positionId) ?? null
	const isPrimary = aiDirection?.positionId === positionId

	// 该方向的历史测评：优先按 position_id 精确匹配，老记录（无 position_id）不误用
	const previousRecord = findAssessmentRecordsByUser(userId)
		.find((record) => record.position_id === positionId) ?? null

	return {
		positionId,
		positionName: position?.name ?? null,
		positionCategory: position?.category ?? null,
		positionDescription: position?.description ?? null,
		goal: (isPrimary ? aiDirection?.profile?.goal : null) ?? profile?.learning_goal ?? null,
		level: isPrimary ? (aiDirection?.profile?.level ?? null) : null,
		dailyMinutes: (profileData.dailyMinutes as number | undefined) ?? null,
		skills: skills.map((skill) => ({
			id: skill.id,
			name: skill.name,
			category: skill.category,
			level: skill.level,
			requiredLevel: skill.required_level,
			status: statusMap.get(skill.id) ?? "not_started",
		})),
		progress: study ? { total: study.item_count, completed: study.completed_count ?? 0 } : null,
		previous: parsePrevious(previousRecord?.result_data ?? null),
	}
}

/** 把方向上下文压成 prompt 行（出题 / 分析共用，避免两处各写一套导致漂移） */
export function buildContextLines(ctx: AssessmentContext): string[] {
	const lines: string[] = []

	if (ctx.positionId && ctx.positionName) {
		lines.push(`- 本次测评的学习方向：${ctx.positionName}${ctx.positionCategory ? `（${ctx.positionCategory}）` : ""}`)
		if (ctx.positionDescription) lines.push(`- 方向说明：${ctx.positionDescription.slice(0, 160)}`)
	} else {
		lines.push("- 本次测评的学习方向：未指定（按学员已记录的技能出题）")
	}

	if (ctx.goal) lines.push(`- 学习目标：${ctx.goal}`)
	if (ctx.level) lines.push(`- 自评水平：${ctx.level}`)
	if (ctx.dailyMinutes) lines.push(`- 每日可学：${ctx.dailyMinutes} 分钟`)
	if (ctx.progress && ctx.progress.total > 0) {
		lines.push(`- 方向进度：已完成 ${ctx.progress.completed}/${ctx.progress.total} 个关卡`)
	}

	if (ctx.skills.length > 0) {
		const listed = ctx.skills
			.slice(0, 24)
			.map((skill) => `${skill.name}（${STATUS_LABEL[skill.status] ?? skill.status}，难度 ${skill.level}）`)
			.join("、")
		lines.push(`- 该方向的技能图谱：${listed}`)
	} else {
		lines.push("- 该方向的技能图谱：暂无技能点")
	}

	if (ctx.previous) {
		const parts: string[] = []
		if (ctx.previous.strengths.length > 0) parts.push(`优势：${ctx.previous.strengths.join("、")}`)
		if (ctx.previous.weaknesses.length > 0) parts.push(`待补强：${ctx.previous.weaknesses.join("、")}`)
		if (parts.length > 0) lines.push(`- 该方向上次测评：${parts.join("；")}`)
	}

	return lines
}
