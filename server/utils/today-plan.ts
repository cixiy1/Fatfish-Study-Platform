import { getDb } from "./db"
import {
	findAllResources,
	findAllSkills,
	findLearningPathItems,
	findLearningPathsByUser,
	findUserProfile,
	findUserSkills,
	getPlanSettings,
	parseProfileData,
} from "../repositories/learning.repository"

/**
 * 今日学习任务调度。
 *
 * 早期实现是「取活跃路径里第一个未完成的关卡」，等于线性游标：
 * 复习关被排到队尾、多方向只看一条、不会按剩余时长凑满今日目标。
 * 这里改成给每个未完成关卡打分再按时间预算装包，
 * 让「今天学什么」取决于遗忘紧迫度、依赖前置、掌握缺口和方向权重。
 */

/** 关卡没有预估时长时的兜底（分钟） */
const DEFAULT_ITEM_MINUTES = 10
/** 一天最多排几关，防止 120 分钟目标排出一屏 */
const MAX_ITEMS_PER_DAY = 6
/** 遗忘曲线的半衰参照天数：距上次完成 7 天时紧迫度约 0.5 */
const REVIEW_HALF_LIFE_DAYS = 7

/**
 * 权重总和 100：
 * 复习紧迫 35 + 依赖前置 25 + 掌握缺口 20 + 方向权重 10 + 进行中 5 + 时长匹配 5
 */
const W = {
	review: 35,
	dependency: 25,
	mastery: 20,
	direction: 10,
	inProgress: 5,
	timeFit: 5,
}

export interface TodayPlanItem {
	/** learning_path_items.id，前端跳 /learn/:id 用 */
	id: number
	pathId: number
	pathName: string
	/** 在该路径里的序号（1-based） */
	index: number
	pathTotal: number
	skillId: number | null
	skillName: string
	resourceTitle: string | null
	/** 预计耗时（分钟） */
	minutes: number
	status: string
	isReview: boolean
	isPrimaryPath: boolean
	/** 0~100，便于调试与答辩讲排序依据 */
	score: number
	/** 直接展示给用户的一句话理由 */
	reason: string
}

export interface TodayPlan {
	items: TodayPlanItem[]
	/** 今日每日目标（分钟） */
	budgetMinutes: number
	/** 今天已经学掉的分钟数 */
	spentMinutes: number
	/** 预算剩余 */
	remainingMinutes: number
	/** 参与打分的候选关卡数 */
	considered: number
}

interface ScoredCandidate extends TodayPlanItem {
	baseScore: number
}

function clamp01(value: number): number {
	if (!Number.isFinite(value)) return 0
	return Math.min(1, Math.max(0, value))
}

function todaySpentMinutes(userId: number): number {
	const row = getDb()
		.prepare(`
			SELECT COALESCE(SUM(COALESCE(i.estimated_minutes, ?)), 0) AS m
			FROM learning_path_items i
			JOIN learning_paths p ON p.id = i.path_id
			WHERE p.user_id = ? AND i.status = 'completed'
			  AND date(i.completed_at, 'localtime') = date('now', 'localtime')
		`)
		.get(DEFAULT_ITEM_MINUTES, userId) as { m: number } | undefined
	return row?.m ?? 0
}

/** 每个技能最近一次学完的时间（跨该用户所有路径），算复习紧迫度用 */
function lastCompletedBySkill(userId: number): Map<number, number> {
	// 不过滤 status：复习关被重开后仍是 pending，但 completed_at 保留着「上次学完」的时间，
	// 正是判断「隔了多久、该不该复习」的依据。
	const rows = getDb()
		.prepare(`
			SELECT i.skill_id AS sid, MAX(i.completed_at) AS at
			FROM learning_path_items i
			JOIN learning_paths p ON p.id = i.path_id
			WHERE p.user_id = ? AND i.skill_id IS NOT NULL
			  AND i.completed_at IS NOT NULL
			GROUP BY i.skill_id
		`)
		.all(userId) as { sid: number, at: string }[]

	const map = new Map<number, number>()
	const now = Date.now()
	for (const row of rows) {
		// completed_at 是 UTC，SQLite 没有时区后缀，补上 Z 再解析
		const at = Date.parse(`${row.at.replace(" ", "T")}Z`)
		if (Number.isNaN(at)) continue
		map.set(row.sid, Math.max(0, (now - at) / 86_400_000))
	}
	return map
}

/**
 * 生成今日任务列表。
 *
 * 顺序固定为：先按打分排序，再按剩余时间预算贪心装包，
 * 保证「排进来的都能在今天的剩余时间里做完」。
 */
export function buildTodayPlan(userId: number): TodayPlan {
	const { dailyMinutes } = getPlanSettings(userId)
	const budgetMinutes = Math.max(10, dailyMinutes)
	const spentMinutes = todaySpentMinutes(userId)
	const remainingMinutes = Math.max(0, budgetMinutes - spentMinutes)

	const profileData = parseProfileData(findUserProfile(userId)?.profile_data ?? null)
	const primaryPositionId = (profileData.aiDirection as { positionId?: number } | undefined)?.positionId ?? null

	const skillNames = new Map(findAllSkills().map((s) => [s.id, s.name]))
	const allResources = findAllResources()
	const resourceTitles = new Map(allResources.map((r) => [r.id, r.title]))
	const resourceMinutes = new Map(allResources.map((r) => [r.id, r.duration ?? null]))
	const mastery = new Map(findUserSkills(userId).map((s) => [s.skill_id, s.status]))
	const lastDone = lastCompletedBySkill(userId)

	const paths = findLearningPathsByUser(userId).filter((p) => p.status !== "archived")
	const candidates: ScoredCandidate[] = []

	for (const path of paths) {
		const items = findLearningPathItems(path.id)
		const pathTotal = items.length
		const isPrimaryPath = primaryPositionId != null && path.target_position_id === primaryPositionId

		// 依赖前置：走到第 i 关时，前面已经完成了几关
		let completedBefore = 0

		items.forEach((item, i) => {
			if (item.status === "completed") {
				completedBefore += 1
				return
			}

			const skillId = item.skill_id
			const skillName = skillId ? (skillNames.get(skillId) ?? "未命名技能") : "学习资源"
			const minutes = item.estimated_minutes
				?? (item.resource_id ? resourceMinutes.get(item.resource_id) ?? null : null)
				?? DEFAULT_ITEM_MINUTES

			// 1. 复习紧迫度：距上次完成越久越该复习（0~1，7 天约 0.5）
			const daysSince = skillId ? lastDone.get(skillId) ?? null : null
			const isReview = item.item_type === "review"
			let review = 0
			if (daysSince != null) {
				review = clamp01(daysSince / (daysSince + REVIEW_HALF_LIFE_DAYS))
			} else if (isReview) {
				// 标了复习但查不到完成记录（历史数据），给个中等优先级
				review = 0.5
			}
			if (isReview) review = clamp01(review + 0.15)

			// 2. 依赖前置：前面全完成才是 1，跳关会被压分
			const dependency = i === 0 ? 1 : clamp01(completedBefore / i)

			// 3. 掌握缺口：已掌握的低分（允许靠后快速过），没记录的满分
			const status = skillId ? mastery.get(skillId) : undefined
			const masteryGap = status === "mastered" ? 0.1 : status === "in_progress" ? 0.75 : 1

			// 4. 方向权重：主方向优先，其他在学方向次之
			const direction = primaryPositionId == null || isPrimaryPath ? 1 : 0.6

			// 5. 进行中：上次学到一半的关，接着做完比开新关划算
			const inProgress = item.status === "in_progress" ? 1 : 0

			const baseScore = W.review * review
				+ W.dependency * dependency
				+ W.mastery * masteryGap
				+ W.direction * direction
				+ W.inProgress * inProgress

			candidates.push({
				id: item.id,
				pathId: path.id,
				pathName: path.name,
				index: i + 1,
				pathTotal,
				skillId,
				skillName,
				resourceTitle: item.resource_id ? (resourceTitles.get(item.resource_id) ?? null) : null,
				minutes,
				status: item.status,
				isReview,
				isPrimaryPath,
				score: Math.round(baseScore),
				baseScore,
				reason: buildReason({
					isReview,
					daysSince,
					inProgress: item.status === "in_progress",
					masteryGap,
					index: i + 1,
					missingBefore: i - completedBefore,
					skillName,
				}),
			})
		})
	}

	// 高分优先，同分按路径先后 + 关卡序号，保证结果稳定（刷新不会跳来跳去）
	candidates.sort((a, b) => {
		if (b.baseScore !== a.baseScore) return b.baseScore - a.baseScore
		if (a.pathId !== b.pathId) return a.pathId - b.pathId
		return a.index - b.index
	})

	// 贪心装包：能在剩余预算里做完的优先排；一关都没排上时兜底排第一关
	const picked: TodayPlanItem[] = []
	let left = remainingMinutes

	for (const cand of candidates) {
		if (picked.length >= MAX_ITEMS_PER_DAY) break
		const fits = cand.minutes <= left
		if (!fits && picked.length > 0) continue
		const timeFit = clamp01(left / Math.max(1, cand.minutes))
		const { baseScore, ...rest } = cand
		picked.push({
			...rest,
			score: Math.round(baseScore + W.timeFit * (fits ? 1 : timeFit)),
		})
		left = Math.max(0, left - cand.minutes)
	}

	return {
		items: picked,
		budgetMinutes,
		spentMinutes,
		remainingMinutes,
		considered: candidates.length,
	}
}

function buildReason(input: {
	isReview: boolean
	daysSince: number | null
	inProgress: boolean
	masteryGap: number
	index: number
	missingBefore: number
	skillName: string
}): string {
	if (input.isReview && input.daysSince != null) {
		return `「${input.skillName}」距上次学习 ${Math.round(input.daysSince)} 天，先巩固再往下走`
	}
	if (input.inProgress) return "上次学到一半，接着做完"
	if (input.masteryGap <= 0.2) return "测评显示已掌握，快速过一遍就够"
	if (input.missingBefore > 0) return `前置还有 ${input.missingBefore} 关没完成，可以先补上`
	return `主线第 ${input.index} 关`
}
