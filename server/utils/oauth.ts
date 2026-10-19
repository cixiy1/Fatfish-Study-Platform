import { GitHub, generateState } from "arctic"
import type { OAuthProvider, OAuthPlatformCredentials } from "#shared/types/auth"
import { readConfig } from "./app-config"
import { getOAuthConfig } from "../repositories/settings.repository"
import { createOAuthUser, findUserByOauth } from "../repositories/user.repository"

/**
 * OAuth 提供方封装。
 *
 * - GitHub：使用 arctic 的 GitHub provider
 * - QQ / 微信：手写 OAuth2 流程（arctic 不原生支持，且二者有协议变体）
 */

export interface OAuthUserResult {
	provider: OAuthProvider
	/** 平台用户唯一标识（GitHub: 用户 id，QQ: openid，微信: openid/unionid） */
	subject: string
	name: string
	/** 平台返回的邮箱（可能为空，调用方用占位邮箱兜底） */
	email: string | null
}

/** 生成 OAuth state（防 CSRF） */
export function generateOAuthState(): string {
	return generateState()
}

/** 获取站点基础 URL（用于构建 redirect_uri） */
function getSiteUrl(): string {
	const url = readConfig()?.site.url
	if (!url) {
		throw new Error("站点 URL 未配置，请在管理员后台设置站点地址后再使用第三方登录")
	}
	return url.replace(/\/$/, "")
}

/** 构建回调 URL */
export function getRedirectUri(provider: OAuthProvider): string {
	return `${getSiteUrl()}/api/auth/${provider}/callback`
}

/** 获取指定平台凭证；未配置返回 null */
function getCredentials(provider: OAuthProvider): OAuthPlatformCredentials | null {
	const config = getOAuthConfig()
	const creds = config[provider]
	if (!creds || !creds.clientId || !creds.clientSecret) return null
	return creds
}

/* -------------------------------------------------------------------------- */
/* GitHub                                                                      */
/* -------------------------------------------------------------------------- */

/** 创建 GitHub OAuth 客户端 */
function createGitHubClient(): GitHub | null {
	const creds = getCredentials("github")
	if (!creds) return null
	return new GitHub(creds.clientId, creds.clientSecret, getRedirectUri("github"))
}

/** 生成 GitHub 授权 URL */
export function createGitHubAuthUrl(state: string): URL {
	const client = createGitHubClient()
	if (!client) throw new Error("GitHub 凭证未配置")
	return client.createAuthorizationURL(state, ["user:email"])
}

/** 处理 GitHub 回调：交换 token → 拉取用户资料 */
export async function handleGitHubCallback(code: string): Promise<OAuthUserResult> {
	const client = createGitHubClient()
	if (!client) throw new Error("GitHub 凭证未配置")

	const tokens = await client.validateAuthorizationCode(code)
	const accessToken = tokens.accessToken()

	// 拉取用户资料
	const userRes = await fetch("https://api.github.com/user", {
		headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/vnd.github+json" },
	})
	if (!userRes.ok) throw new Error("获取 GitHub 用户资料失败")
	const user = await userRes.json() as {
		id: number
		login: string
		name: string | null
		email: string | null
	}

	// GitHub 可能不返回 email，需调 emails API
	let email = user.email
	if (!email) {
		const emailsRes = await fetch("https://api.github.com/user/emails", {
			headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/vnd.github+json" },
		})
		if (emailsRes.ok) {
			const emails = await emailsRes.json() as Array<{ email: string, primary: boolean, verified: boolean }>
			const primary = emails.find((e) => e.primary && e.verified) ?? emails[0]
			email = primary?.email ?? null
		}
	}

	return {
		provider: "github",
		subject: String(user.id),
		name: user.name || user.login,
		email,
	}
}

/* -------------------------------------------------------------------------- */
/* QQ 互联                                                                     */
/* -------------------------------------------------------------------------- */

const QQ_AUTHORIZE_URL = "https://graph.qq.com/oauth2.0/authorize"
const QQ_TOKEN_URL = "https://graph.qq.com/oauth2.0/token"
const QQ_ME_URL = "https://graph.qq.com/oauth2.0/me"
const QQ_USER_INFO_URL = "https://graph.qq.com/user/get_user_info"

/** 生成 QQ 授权 URL */
export function createQqAuthUrl(state: string): URL {
	const creds = getCredentials("qq")
	if (!creds) throw new Error("QQ 凭证未配置")

	const url = new URL(QQ_AUTHORIZE_URL)
	url.searchParams.set("response_type", "code")
	url.searchParams.set("client_id", creds.clientId)
	url.searchParams.set("redirect_uri", getRedirectUri("qq"))
	url.searchParams.set("state", state)
	url.searchParams.set("scope", "get_user_info")
	return url
}

/** 处理 QQ 回调 */
export async function handleQqCallback(code: string): Promise<OAuthUserResult> {
	const creds = getCredentials("qq")
	if (!creds) throw new Error("QQ 凭证未配置")

	// 交换 token（QQ 返回 application/x-www-form-urlencoded）
	// QQ token endpoint 需要拼参数到 URL
	const tokenUrl = new URL(QQ_TOKEN_URL)
	tokenUrl.searchParams.set("grant_type", "authorization_code")
	tokenUrl.searchParams.set("client_id", creds.clientId)
	tokenUrl.searchParams.set("client_secret", creds.clientSecret)
	tokenUrl.searchParams.set("code", code)
	tokenUrl.searchParams.set("redirect_uri", getRedirectUri("qq"))

	const tokenResp = await fetch(tokenUrl)
	const tokenText = await tokenResp.text()
	if (!tokenResp.ok) throw new Error(`QQ token 交换失败: ${tokenText}`)

	const tokenParams = new URLSearchParams(tokenText)
	const accessToken = tokenParams.get("access_token")
	if (!accessToken) throw new Error("QQ 未返回 access_token")

	// 获取 openid
	const meUrl = new URL(QQ_ME_URL)
	meUrl.searchParams.set("access_token", accessToken)
	const meResp = await fetch(meUrl)
	const meText = await meResp.text()
	// QQ me 返回 callback({...}); 格式
	const meMatch = meText.match(/callback\((.+)\);?/)
	if (!meMatch) throw new Error(`QQ me 响应格式异常: ${meText}`)
	const me = JSON.parse(meMatch[1]) as { client_id: string, openid: string }
	const openid = me.openid
	if (!openid) throw new Error("QQ 未返回 openid")

	// 拉取用户资料
	const userInfoUrl = new URL(QQ_USER_INFO_URL)
	userInfoUrl.searchParams.set("access_token", accessToken)
	userInfoUrl.searchParams.set("oauth_consumer_key", creds.clientId)
	userInfoUrl.searchParams.set("openid", openid)
	const userInfoResp = await fetch(userInfoUrl)
	if (!userInfoResp.ok) throw new Error("获取 QQ 用户资料失败")
	const userInfo = await userInfoResp.json() as {
		ret: number
		nickname: string
		msg: string
	}

	if (userInfo.ret !== 0) throw new Error(`QQ 用户资料错误: ${userInfo.msg}`)

	return {
		provider: "qq",
		subject: openid,
		name: userInfo.nickname,
		email: null, // QQ 互联不返回邮箱
	}
}

/* -------------------------------------------------------------------------- */
/* 微信开放平台                                                                 */
/* -------------------------------------------------------------------------- */

const WECHAT_AUTHORIZE_URL = "https://open.weixin.qq.com/connect/qrconnect"
const WECHAT_TOKEN_URL = "https://api.weixin.qq.com/sns/oauth2/access_token"
const WECHAT_USER_INFO_URL = "https://api.weixin.qq.com/sns/userinfo"

/** 生成微信授权 URL */
export function createWechatAuthUrl(state: string): URL {
	const creds = getCredentials("wechat")
	if (!creds) throw new Error("微信凭证未配置")

	const url = new URL(WECHAT_AUTHORIZE_URL)
	url.searchParams.set("appid", creds.clientId)
	url.searchParams.set("redirect_uri", getRedirectUri("wechat"))
	url.searchParams.set("response_type", "code")
	url.searchParams.set("scope", "snsapi_login")
	url.searchParams.set("state", state)
	return url
}

/** 处理微信回调 */
export async function handleWechatCallback(code: string): Promise<OAuthUserResult> {
	const creds = getCredentials("wechat")
	if (!creds) throw new Error("微信凭证未配置")

	// 交换 token
	const tokenUrl = new URL(WECHAT_TOKEN_URL)
	tokenUrl.searchParams.set("appid", creds.clientId)
	tokenUrl.searchParams.set("secret", creds.clientSecret)
	tokenUrl.searchParams.set("code", code)
	tokenUrl.searchParams.set("grant_type", "authorization_code")

	const tokenResp = await fetch(tokenUrl)
	const tokenData = await tokenResp.json() as {
		access_token?: string
		openid?: string
		unionid?: string
		errcode?: number
		errmsg?: string
	}

	if (!tokenData.access_token || !tokenData.openid) {
		throw new Error(`微信 token 交换失败: ${tokenData.errmsg ?? "未知错误"}`)
	}

	const accessToken = tokenData.access_token
	const openid = tokenData.openid
	// 优先用 unionid 作为 subject（跨应用唯一），否则用 openid
	const subject = tokenData.unionid ?? openid

	// 拉取用户资料
	const userInfoUrl = new URL(WECHAT_USER_INFO_URL)
	userInfoUrl.searchParams.set("access_token", accessToken)
	userInfoUrl.searchParams.set("openid", openid)
	const userInfoResp = await fetch(userInfoUrl)
	if (!userInfoResp.ok) throw new Error("获取微信用户资料失败")
	const userInfo = await userInfoResp.json() as {
		nickname?: string
		errcode?: number
		errmsg?: string
	}

	if (userInfo.errcode) {
		throw new Error(`微信用户资料错误: ${userInfo.errmsg ?? "未知错误"}`)
	}

	return {
		provider: "wechat",
		subject,
		name: userInfo.nickname || "微信用户",
		email: null, // 微信不返回邮箱
	}
}

/* -------------------------------------------------------------------------- */
/* 统一入口                                                                     */
/* -------------------------------------------------------------------------- */

/** 生成指定平台的授权 URL；凭证未配置返回 null */
export function createAuthUrl(provider: OAuthProvider, state: string): URL {
	switch (provider) {
		case "github":
			return createGitHubAuthUrl(state)
		case "qq":
			return createQqAuthUrl(state)
		case "wechat":
			return createWechatAuthUrl(state)
	}
}

/** 处理指定平台的回调 */
export async function handleCallback(provider: OAuthProvider, code: string): Promise<OAuthUserResult> {
	switch (provider) {
		case "github":
			return handleGitHubCallback(code)
		case "qq":
			return handleQqCallback(code)
		case "wechat":
			return handleWechatCallback(code)
	}
}

/** 判断指定平台是否已配置凭证 */
export function isProviderConfigured(provider: OAuthProvider): boolean {
	return getCredentials(provider) !== null
}

/** 为无邮箱的 OAuth 用户生成占位邮箱 */
export function oauthPlaceholderEmail(provider: OAuthProvider, subject: string): string {
	return `${provider}_${subject}@oauth.local.invalid`
}

/* -------------------------------------------------------------------------- */
/* OAuth 回调后的用户查找/创建                                                  */
/* -------------------------------------------------------------------------- */

/**
 * 处理 OAuth 回调结果：查找已有用户或创建新用户，返回会话用户信息。
 */
export async function processOAuthUser(result: OAuthUserResult): Promise<{
	account: string
	name: string
}> {
	let user = findUserByOauth(result.provider, result.subject)

	if (!user) {
		const email = result.email ?? oauthPlaceholderEmail(result.provider, result.subject)
		const account = `${result.provider}_${result.subject}`
		user = createOAuthUser({
			provider: result.provider,
			subject: result.subject,
			account,
			name: result.name,
			email,
		})
	}

	return { account: user.account, name: user.name }
}
