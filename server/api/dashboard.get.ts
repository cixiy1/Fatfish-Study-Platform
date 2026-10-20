import { findUserByAccount } from "../repositories/user.repository"
import {
	findAllResources,
	findAllSkills,
	findLearningPathItems,
	findLearningPathsByUser,
	findPositionById,
	getPlanSettings,
} from "../repositories/learning.repository"
import { getDb } from "../utils/db"
import { readSession } from "../utils/session"

/** 一关的预估时长（分钟），用于把每日目标换算成关卡数 */
const MINUTES_PER_ITEM = 10
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
 */
export default defineEventHandler((event) => {
	const session = readSession(event)
	if (!session) throw createError({ statusCode: 401, message: "未登录" })

	const user = findUserByAccount(session.account)
	if (!user) throw createError({ statusCode: 401, message: "用户不存在" })

	const paths = findLearningPathsByUser(user.id)
	const activePath = paths.find((p) => p.status === "active") ?? paths[0] ?? null
	const items = activePath ? findLearningPathItems(activePath.id) : []

	const skillNames = new Map(findAllSkills().map((s) => [s.id, s.name]))
	const resourceTitles = new Map(findAllResources().map((r) => [r.id, r.title]))

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
			WHERE p.user_id = ? AND i.completed_at IS NOT NULL
			ORDER BY d DESC
			LIMIT 400
		`)
		.all(user.id) as { d: string }[]

	const { dailyMinutes } = getPlanSettings(user.id)
	const todayGoal = Math.max(1, Math.round(dailyMinutes / MINUTES_PER_ITEM))

	// 下一关 = 第一个未完成的 item（按 sort_order 已排序）
	const nextIndex = items.findIndex((i) => i.status !== "completed")
	const nextRaw = nextIndex >= 0 ? items[nextIndex] : null

	const position =
		activePath?.target_position_id != null
			? findPositionById(activePath.target_position_id)
			: null

	return {
		hasPath: Boolean(activePath),
		pathName: activePath?.name ?? null,
		position: position ? { id: position.id, name: position.name } : null,
		total,
		completed,
		percent: total ? Math.round((completed / total) * 100) : 0,
		todayDone,
		todayGoal,
		dailyMinutes,
		xp: completed * XP_PER_ITEM,
		streak: calcStreak(streakRows.map((r) => r.d)),
		nextItem: nextRaw
			? {
					id: nextRaw.id,
					index: nextIndex + 1,
					skillName: nextRaw.skill_id ? (skillNames.get(nextRaw.skill_id) ?? "未命名技能") : "学习资源",
					resourceTitle: nextRaw.resource_id ? (resourceTitles.get(nextRaw.resource_id) ?? null) : null,
				}
			: null,
	}
})
