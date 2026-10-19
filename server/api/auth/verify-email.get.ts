import { activateUser, findUserById, setEmailVerifiedAt } from "../../repositories/user.repository"
import { findToken, markUsed } from "../../repositories/email-verification.repository"
import { setSession } from "../../utils/session"

/**
 * 邮箱验证：GET /api/auth/verify-email?token=xxx
 *
 * 流程：校验 token → 激活用户 → 自动登录 → 重定向首页
 * 失败时重定向到登录页并带 error 参数。
 */
export default defineEventHandler(async (event) => {
	const token = getQuery(event).token as string | undefined

	if (!token) {
		return sendRedirect(event, "/login?error=invalid_token", 302)
	}

	const tokenRecord = findToken(token)
	if (!tokenRecord) {
		return sendRedirect(event, "/login?error=invalid_token", 302)
	}

	// 已使用
	if (tokenRecord.used_at) {
		return sendRedirect(event, "/login?error=token_used", 302)
	}

	// 已过期
	if (new Date(tokenRecord.expires_at).getTime() < Date.now()) {
		return sendRedirect(event, "/login?error=token_expired", 302)
	}

	const user = findUserById(tokenRecord.user_id)
	if (!user) {
		return sendRedirect(event, "/login?error=user_not_found", 302)
	}

	// 激活用户并标记验证时间
	activateUser(user.id)
	setEmailVerifiedAt(user.id)
	markUsed(tokenRecord.id)

	// 自动登录
	setSession(event, { account: user.account, name: user.name })

	return sendRedirect(event, "/?verified=1", 302)
})
