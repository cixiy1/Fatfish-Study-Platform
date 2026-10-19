import { requireAdmin } from "../../utils/admin-guard"
import { findAllUsers, countUsers } from "../../repositories/user.repository"

/**
 * 用户列表：GET /api/admin/users
 *
 * 返回所有用户（不含密码哈希），按创建时间倒序。
 */
export default defineEventHandler((event) => {
	requireAdmin(event)

	const query = getQuery(event)
	const limit = Math.min(Math.max(Number(query.limit) || 100, 1), 500)
	const offset = Math.max(Number(query.offset) || 0, 0)

	const users = findAllUsers(limit, offset).map((u) => ({
		id: u.id,
		account: u.account,
		name: u.name,
		email: u.email,
		role: u.role,
		status: u.status,
		emailVerifiedAt: u.email_verified_at,
		oauthProvider: u.oauth_provider,
		createdAt: u.created_at,
		lastLoginAt: u.last_login_at,
	}))

	return {
		users,
		total: countUsers(),
		limit,
		offset,
	}
})
