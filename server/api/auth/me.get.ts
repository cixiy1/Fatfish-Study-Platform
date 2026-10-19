import { findUserByAccount } from "../../repositories/user.repository"
import { findUserProfile, findLearningPathsByUser } from "../../repositories/learning.repository"

/**
 * 当前登录用户：GET /api/auth/me
 *
 * 返回基础信息 + 学习方向状态（career_direction / assessment_completed / has_learning_path）。
 */
export default defineEventHandler((event) => {
	const sessionUser = readSession(event)

	if (!sessionUser) {
		throw createError({ statusCode: 401, message: "未登录" })
	}

	const user = findUserByAccount(sessionUser.account)
	if (!user) {
		throw createError({ statusCode: 401, message: "用户不存在" })
	}

	const profile = findUserProfile(user.id)
	const paths = findLearningPathsByUser(user.id)
	const hasLearningPath = paths.length > 0

	return {
		account: sessionUser.account,
		name: sessionUser.name,
		role: user.role,
		email: user.email,
		status: user.status,
		career_direction: profile?.career_direction ?? null,
		assessment_completed: profile?.assessment_completed ?? 0,
		has_learning_path: hasLearningPath,
	}
})
