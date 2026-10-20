import { handleGitHubCallback, processOAuthUser } from "../../../utils/oauth"
import { setSession } from "../../../utils/session"

/**
 * GitHub OAuth 回调：GET /api/auth/github/callback?code=xxx&state=xxx
 */
export default defineEventHandler(async (event) => {
	const { code, state } = getQuery(event) as { code?: string, state?: string }
	const storedState = getCookie(event, "oauth_state")
	deleteCookie(event, "oauth_state", { path: "/" })

	if (!code || !state || state !== storedState) {
		return sendRedirect(event, "/login?error=oauth_state", 302)
	}

	try {
		const result = await handleGitHubCallback(code)
		const sessionUser = await processOAuthUser(result)
		setSession(event, sessionUser)
		return sendRedirect(event, "/", 302)
	} catch (error) {
		const message = error instanceof Error ? error.message : "GitHub 登录失败"
		return sendRedirect(event, `/login?error=oauth_failed&msg=${encodeURIComponent(message)}`, 302)
	}
})
