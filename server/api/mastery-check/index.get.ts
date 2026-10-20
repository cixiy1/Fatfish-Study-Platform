import { findMasteryChecksByUser } from "../../repositories/learning.repository"
import { findUserByAccount } from "../../repositories/user.repository"
import { readSession } from "../../utils/session"

/**
 * 阶段测评列表：GET /api/mastery-check
 *
 * 只回传给前端需要的字段——questions 里含 correctIndex，不能下发，
 * 否则「看看之前做过的测评」就变成作弊入口。
 */

export default defineEventHandler((event) => {
	const session = readSession(event)
	if (!session) throw createError({ statusCode: 401, message: "未登录" })

	const user = findUserByAccount(session.account)
	if (!user) throw createError({ statusCode: 401, message: "用户不存在" })

	return findMasteryChecksByUser(user.id).map((check) => ({
		id: check.id,
		pathId: check.path_id,
		status: check.status,
		score: check.score,
		questionCount: (JSON.parse(check.questions) as unknown[]).length,
		model: check.model,
		createdAt: check.created_at,
		scoredAt: check.scored_at,
		acceptedAt: check.accepted_at,
	}))
})
