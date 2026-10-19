import { findLearningPathsByUser, findLearningPathItems } from "../../repositories/learning.repository"
import { readSession } from "../../utils/session"
import { findUserByAccount } from "../../repositories/user.repository"

/** 学习路径：GET /api/learning-path */
export default defineEventHandler((event) => {
	const session = readSession(event)
	if (!session) throw createError({ statusCode: 401, message: "未登录" })

	const user = findUserByAccount(session.account)
	if (!user) throw createError({ statusCode: 401, message: "用户不存在" })

	const paths = findLearningPathsByUser(user.id)
	const result = paths.map((p) => ({
		...p,
		items: findLearningPathItems(p.id),
	}))
	return result
})
