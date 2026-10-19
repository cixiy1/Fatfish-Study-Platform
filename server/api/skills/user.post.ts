import { upsertUserSkill } from "../../repositories/learning.repository"
import { readSession } from "../../utils/session"
import { findUserByAccount } from "../../repositories/user.repository"

/** 更新用户技能状态：POST /api/skills/user */
export default defineEventHandler(async (event) => {
	const session = readSession(event)
	if (!session) throw createError({ statusCode: 401, message: "未登录" })

	const user = findUserByAccount(session.account)
	if (!user) throw createError({ statusCode: 401, message: "用户不存在" })

	const body = await readBody<{ skill_id?: number, status?: string, level?: number }>(event).catch(() => null)
	const skillId = body?.skill_id
	const status = body?.status
	const level = body?.level ?? 0

	if (!skillId || !status || !["mastered", "learning", "not_started"].includes(status)) {
		throw createError({ statusCode: 400, message: "参数不合法" })
	}

	upsertUserSkill(user.id, skillId, status, level)
	return { ok: true }
})
