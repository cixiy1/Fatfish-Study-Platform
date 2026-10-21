import { findUserByAccount } from "../repositories/user.repository"
import {
	findLearningPathItems,
	findLearningPathsByUser,
	findPositionById,
	getPlanSettings,
} from "../repositories/learning.repository"
import { getDb } from "../utils/db"
import { readSession } from "../utils/session"
import { buildTodayPlan } from "../utils/today-plan"

/** 完成一关的 XP，答辩演示用固定值，不做成长数值系统 */
const XP_PER_ITEM = 10

function pad(value: number) {
	return String(value).padStart(2, "0")
}

function formatLocalDate(date: Date) {
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/**
 * 连胜：从今天（今天没学则从昨天）往前数连续有完成记录的日期。
 * 这样"昨天学了、今天还没开始"时不会立刻断掉连胜。
 */
function calcStreak(dates: string[]): number {
	const set = new Set(dates)
	const cursor = new Date()
	if (!set.has(formatLocalDate(cursor))) {
		cursor.setDate(cursor.getDate() - 1)
	}

	let streak = 0
	while (set.has(formatLocalDate(cursor))) {
		streak += 1
		cursor.setDate(cursor.getDate() - 1)
	}
	return streak
}

/**
 * 今日学习仪表盘：GET /api/dashboard
 * 一次聚合 Header / 首页需要的所有数字，避免前端打四五个接口。
 *
 * 「今天该学哪几关」由 today-plan 的打分器决定（复习紧迫度 / 依赖前置 /
 * 掌握缺口 / 方向权重 / 剩余时长），这里只负责拼装统计数字。
 */
export default defineEventHandler((event) => {
	const session = readSession(event)
	if (!session) throw createError({ statusCode: 401, message: "未登录" })

	const user = findUserByAccount(session.account)
	if (!user) throw createError({ statusCode: 401, message: "用户不存在" })

	const paths = findLearningPathsByUser(user.id)
	const activePath = paths.find((p) => p.status === "active") ?? paths[0] ?? null
	const items = activePath ? findLearningPathItems(activePath.id) : []

	const total = items.length
	const completed = items.filter((i) => i.status === "completed").length

	// completed_at 是 UTC，转成本地日期再和"今天"比
	const todayRow = getDb()
		.prepare(`
			SELECT COUNT(*) AS c
			FROM learning_path_items i
			JOIN learning_paths p ON p.id = i.path_id
			WHERE p.user_id = ? AND i.status = 'completed'
			  AND date(i.completed_at, 'localtime') = date('now', 'localtime')
		`)
		.get(user.id) as { c: number } | undefined
	const todayDone = todayRow?.c ?? 0

	const streakRows = getDb()
		.prepare(`
			SELECT DISTINCT date(i.completed_at, 'localtime') AS d
			FROM learning_path_items i
			JOIN learning_paths p ON p.id = i.path_id
			WHERE p.user_id = ? AND i.status = 'completed' AND i.completed_at IS NOT NULL
			ORDER BY d DESC
			LIMIT 400
		`)
		.all(user.id) as { d: string }[]

	const { dailyMinutes } = getPlanSettings(user.id)

	// 今日任务：打分 + 按剩余分钟装包，可能跨方向
	const plan = buildTodayPlan(user.id)
	const first = plan.items[0] ?? null

	// 今日目标 = 已完成关数 + 还排得下的关数；关都做完时至少显示 1，避免 0/0
	const todayGoal = Math.max(1, todayDone + plan.items.length)

	// 首关所在的方向优先展示（跨方向时首页标题才不会写错方向）
	const focusPathId = first?.pathId ?? activePath?.id ?? null
	const focusPath = focusPathId != null
		? paths.find((p) => p.id === focusPathId) ?? activePath
		: activePath
	const position =
		focusPath?.target_position_id != null
			? findPositionById(focusPath.target_position_id)
			: null

	return {
		hasPath: Boolean(activePath),
		pathName: focusPath?.name ?? null,
		position: position ? { id: position.id, name: position.name } : null,
		total,
		completed,
		percent: total ? Math.round((completed / total) * 100) : 0,
		todayDone,
		todayGoal,
		dailyMinutes,
		xp: completed * XP_PER_ITEM,
		streak: calcStreak(streakRows.map((r) => r.d)),
		/** 今日任务列表（按打分从高到低，且总时长不超预算） */
		todayPlan: {
			items: plan.items,
			budgetMinutes: plan.budgetMinutes,
			spentMinutes: plan.spentMinutes,
			remainingMinutes: plan.remainingMinutes,
			considered: plan.considered,
		},
		/** 兼容旧前端/Header：等价于 todayPlan.items[0] */
		nextItem: first
			? {
					id: first.id,
					index: first.index,
					skillName: first.skillName,
					resourceTitle: first.resourceTitle,
				}
			: null,
	}
})
