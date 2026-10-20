import { findAllPositions } from "../../repositories/learning.repository"
import { findUserByAccount } from "../../repositories/user.repository"
import { readSession } from "../../utils/session"

/**
 * 岗位列表：GET /api/positions
 *
 * 未登录只返回种子岗位；登录后额外返回本人的 AI 生成方向（其他人的不可见）。
 */
export default defineEventHandler((event) => {
	const session = readSession(event)
	const user = session ? findUserByAccount(session.account) : null
	return findAllPositions(user?.id ?? null)
})
