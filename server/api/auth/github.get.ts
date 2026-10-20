import { isInstalled } from "../../utils/app-config"
import { createGitHubAuthUrl, generateOAuthState, isGitHubConfigured } from "../../utils/oauth"

/**
 * GitHub OAuth 发起：GET /api/auth/github
 *
 * 凭证未配置时返回 501；已配置时重定向到 GitHub 授权页。
 */
export default defineEventHandler((event) => {
	if (!isInstalled()) {
		throw createError({ statusCode: 503, message: "系统尚未安装，请先访问 /install 完成初始化" })
	}

	if (!isGitHubConfigured()) {
		throw createError({ statusCode: 501, message: "GitHub 登录尚未配置" })
	}

	const state = generateOAuthState()
	setCookie(event, "oauth_state", state, {
		httpOnly: true,
		sameSite: "lax",
		maxAge: 600,
		path: "/",
		secure: !import.meta.dev,
	})

	const url = createGitHubAuthUrl(state, event)
	return sendRedirect(event, url.toString(), 302)
})
