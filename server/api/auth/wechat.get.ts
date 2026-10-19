import { isInstalled } from "../../utils/app-config"
import { createAuthUrl, generateOAuthState, isProviderConfigured } from "../../utils/oauth"

/**
 * 微信 OAuth 发起：GET /api/auth/wechat
 *
 * 凭证未配置时返回 501；已配置时重定向到微信扫码授权页。
 */
export default defineEventHandler((event) => {
	if (!isInstalled()) {
		throw createError({ statusCode: 503, message: "系统尚未安装，请先访问 /install 完成初始化" })
	}

	if (!isProviderConfigured("wechat")) {
		throw createError({ statusCode: 501, message: "微信登录尚未配置" })
	}

	const state = generateOAuthState()
	setCookie(event, "oauth_state", state, {
		httpOnly: true,
		sameSite: "lax",
		maxAge: 600,
		path: "/",
		secure: !import.meta.dev,
	})

	const url = createAuthUrl("wechat", state)
	return sendRedirect(event, url.toString(), 302)
})
