import { findUserProfile, findAssessmentRecordsByUser, findLearningRecordsByUser, findQARecordsByUser, findLearningPathsByUser } from "../repositories/learning.repository"
import { readSession } from "../utils/session"
import { findUserByAccount } from "../repositories/user.repository"

/** 用户学习档案：GET /api/profile */
export default defineEventHandler((event) => {
	const session = readSession(event)
	if (!session) throw createError({ statusCode: 401, message: "未登录" })

	const user = findUserByAccount(session.account)
	if (!user) throw createError({ statusCode: 401, message: "用户不存在" })

	const profile = findUserProfile(user.id)
	const assessments = findAssessmentRecordsByUser(user.id)
	const learningRecords = findLearningRecordsByUser(user.id)
	const qaRecords = findQARecordsByUser(user.id)
	const paths = findLearningPathsByUser(user.id)

	return {
		user: { account: user.account, name: user.name, email: user.email, role: user.role },
		profile,
		assessmentCount: assessments.length,
		learningCount: learningRecords.length,
		qaCount: qaRecords.length,
		pathCount: paths.length,
		assessments: assessments.slice(0, 5),
		recentQA: qaRecords.slice(0, 5),
	}
})
