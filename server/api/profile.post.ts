import { upsertUserProfile } from "../repositories/learning.repository"
import { readSession } from "../utils/session"
import { findUserByAccount } from "../repositories/user.repository"

/** 更新用户画像：POST /api/profile */
export default defineEventHandler(async (event) => {
	const session = readSession(event)
	if (!session) throw createError({ statusCode: 401, message: "未登录" })

	const user = findUserByAccount(session.account)
	if (!user) throw createError({ statusCode: 401, message: "用户不存在" })

	const body = await readBody<{
		age?: number
		education?: string
		profession?: string
		experience_years?: number
		learning_goal?: string
		career_direction?: string
	}>(event).catch(() => null)

	if (!body) throw createError({ statusCode: 400, message: "请求体为空" })

	upsertUserProfile(user.id, body)
	return { ok: true }
})
