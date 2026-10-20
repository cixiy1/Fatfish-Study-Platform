import { findUserByAccount } from "../repositories/user.repository"
import { setDailyMinutes } from "../repositories/learning.repository"
import { readSession } from "../utils/session"

/**
 * 保存学习计划设置：POST /api/plan
 * 目前只持久化每日学习时长，存在 user_profiles.profile_data（JSON），不动表结构。
 */
export default defineEventHandler(async (event) => {
	const session = readSession(event)
	if (!session) throw createError({ statusCode: 401, message: "未登录" })

	const user = findUserByAccount(session.account)
	if (!user) throw createError({ statusCode: 401, message: "用户不存在" })

	const body = await readBody<{ dailyMinutes?: number }>(event).catch(() => null)
	const raw = Number(body?.dailyMinutes)

	if (!Number.isFinite(raw) || raw < 5 || raw > 240) {
		throw createError({ statusCode: 400, message: "每日学习时长需在 5~240 分钟之间" })
	}

	const dailyMinutes = Math.round(raw)
	setDailyMinutes(user.id, dailyMinutes)

	return { ok: true, dailyMinutes }
})
