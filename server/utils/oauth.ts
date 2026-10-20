import { GitHub, generateState } from "arctic"
import type { H3Event } from "h3"
import type { OAuthPlatformCredentials } from "#shared/types/auth"
import { resolveSiteUrl } from "./app-config"
import { getOAuthConfig } from "../repositories/settings.repository"
import { createOAuthUser, findUserByAccount, findUserByEmail, findUserById, findUserByOauth, linkOAuthAccount, activateUser, setEmailVerifiedAt, touchLastLogin } from "../repositories/user.repository"

/**
 * 第三方登录封装。当前只接 GitHub 一家。
 *
 * 用 arctic 的 GitHub provider（内置 PKCE），回调地址必须与
 * GitHub OAuth App 里登记的 Authorization callback URL 完全一致。
 */

export interface OAuthUserResult {
	provider: "github"
	/** 平台用户唯一标识（GitHub 用户 id） */
	subject: string
	name: string
	/** 平台返回的邮箱（可能为空，调用方用占位邮箱兜底） */
	email: string | null
}

/** 生成 OAuth state（防 CSRF） */
export function generateOAuthState(): string {
	return generateState()
}

/** 构建 GitHub 回调 URL；站点地址未配置时用当前请求来源兜底 */
export function getRedirectUri(event?: H3Event): string {
	return `${resolveSiteUrl(event)}/api/auth/github/callback`
}

/** 读取 GitHub 凭证；未配置返回 null */
function getCredentials(): OAuthPlatformCredentials | null {
	const creds = getOAuthConfig().github
	if (!creds || !creds.clientId || !creds.clientSecret) return null
	return creds
}

/** 创建 GitHub OAuth 客户端 */
function createGitHubClient(event?: H3Event): GitHub | null {
	const creds = getCredentials()
	if (!creds) return null
	return new GitHub(creds.clientId, creds.clientSecret, getRedirectUri(event))
}

/** 生成 GitHub 授权 URL */
export function createGitHubAuthUrl(state: string, event?: H3Event): URL {
	const client = createGitHubClient(event)
	if (!client) throw new Error("GitHub 凭证未配置")
	return client.createAuthorizationURL(state, ["user:email"])
}

const GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token"

/** 把 GitHub 的英文错误码翻译成人能看懂的一句话 */
function explainTokenError(code: string, status: number, description?: string): string {
	// client_id 对不上时 GitHub 直接回 404 + {"error":"Not Found"}
	if (code === "Not Found") {
		return "Client ID 不存在或应用已被删除，请核对管理后台里填的 Client ID"
	}

	const map: Record<string, string> = {
		bad_verification_code: "授权码已失效或已被使用，请重新点击登录",
		incorrect_client_credentials: "Client ID 或 Client Secret 不正确，请到管理后台重新填写",
		redirect_uri_mismatch: "回调地址与 GitHub 应用里登记的 Callback URL 不一致",
		unverified_user_email: "该 GitHub 账号的主邮箱未验证",
		unsupported_grant_type: "GitHub 不支持这种授权方式",
	}
	const mapped = map[code]
	if (mapped) return mapped

	const detail = description ? `：${description}` : ""
	return `GitHub 授权失败（${code}${detail}，HTTP ${status}）`
}

/**
 * 用 code 换 access_token。
 *
 * 凭证走请求体（client_id / client_secret）而不是 HTTP Basic 头：
 * GitHub 文档对「OAuth App」和「GitHub App」都明确支持请求体写法，
 * Basic 头只在 OAuth App 场景有保证，这样两种应用类型都能登。
 */
async function exchangeCodeForToken(code: string, event?: H3Event): Promise<string> {
	const creds = getCredentials()
	if (!creds) throw new Error("GitHub 凭证未配置")

	const body = new URLSearchParams({
		client_id: creds.clientId,
		client_secret: creds.clientSecret,
		code,
		redirect_uri: getRedirectUri(event),
	})

	let res: Response
	try {
		res = await fetch(GITHUB_TOKEN_URL, {
			method: "POST",
			headers: {
				Accept: "application/json",
				"Content-Type": "application/x-www-form-urlencoded",
			},
			body,
			signal: AbortSignal.timeout(15_000),
		})
	} catch {
		throw new Error("连接 GitHub 失败，请检查服务器网络后重试")
	}

	const data = await res.json().catch(() => null) as {
		access_token?: string
		error?: string
		error_description?: string
	} | null

	if (!data) throw new Error(`GitHub 返回了无法解析的响应（HTTP ${res.status}）`)
	if (data.error) throw new Error(explainTokenError(data.error, res.status, data.error_description))
	if (!data.access_token) throw new Error(`GitHub 未返回 access_token（HTTP ${res.status}）`)
	return data.access_token
}

/** 处理 GitHub 回调：交换 token → 拉取用户资料 */
export async function handleGitHubCallback(code: string, event?: H3Event): Promise<OAuthUserResult> {
	const accessToken = await exchangeCodeForToken(code, event)

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
			// 只认已验证邮箱：这个邮箱会被用来「认领」同邮箱的本地账号，未验证的不能作数
			const primary = emails.find((e) => e.primary && e.verified) ?? emails.find((e) => e.verified)
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

/** 判断 GitHub 登录是否已配置凭证 */
export function isGitHubConfigured(): boolean {
	return getCredentials() !== null
}

/** 为无邮箱的 OAuth 用户生成占位邮箱 */
export function oauthPlaceholderEmail(provider: "github", subject: string): string {
	return `${provider}_${subject}@oauth.local.invalid`
}

/* -------------------------------------------------------------------------- */
/* OAuth 回调后的用户查找/创建                                                  */
/* -------------------------------------------------------------------------- */

/**
 * 处理 OAuth 回调结果：查找已有用户或创建新用户，返回会话用户信息。
 *
 * 账号匹配优先级（重要，别改乱）：
 * 1. `oauth_provider + oauth_subject` 命中 → 老用户，直接登录；
 * 2. 邮箱命中已有账号 → **绑定**到该账号（GitHub 已验证邮箱即邮箱归属证明）。
 *    不绑定的话，同邮箱第二次插入会撞 `users.email` 的 UNIQUE 约束，
 *    用户看到的是一句 SQL 报错（曾真实发生：`UNIQUE constraint failed: users.email`）；
 * 3. 都没命中 → 新建 `github_<id>` 账号，邮箱被占用时退到占位邮箱。
 */
export async function processOAuthUser(result: OAuthUserResult): Promise<{
	account: string
	name: string
}> {
	let user = findUserByOauth(result.provider, result.subject)

	// 2. 邮箱认领已有账号
	if (!user && result.email) {
		const byEmail = findUserByEmail(result.email)
		// 该邮箱已绑了另一个第三方身份 → 不抢占，走新建（下面会用占位邮箱）
		const boundToOther = !!byEmail?.oauth_subject && byEmail.oauth_subject !== result.subject
		if (byEmail && !boundToOther) {
			linkOAuthAccount(byEmail.id, result.provider, result.subject)
			user = findUserById(byEmail.id)
		}
	}

	// 账号名被历史数据占用但没绑第三方身份 → 认领它
	if (!user) {
		const existing = findUserByAccount(`${result.provider}_${result.subject}`)
		if (existing && !existing.oauth_subject) {
			linkOAuthAccount(existing.id, result.provider, result.subject)
			user = findUserById(existing.id)
		}
	}

	// 3. 新建账号
	if (!user) {
		const placeholder = oauthPlaceholderEmail(result.provider, result.subject)
		const base = {
			provider: result.provider,
			subject: result.subject,
			account: `${result.provider}_${result.subject}`,
			name: result.name,
		}
		try {
			user = createOAuthUser({ ...base, email: result.email ?? placeholder })
		} catch {
			// 邮箱仍冲突（并发回调 / 历史脏数据）→ 退到占位邮箱，别把 SQL 错误抛给用户
			try {
				user = createOAuthUser({ ...base, email: placeholder })
			} catch {
				throw new Error("GitHub 账号创建失败，请稍后重试或联系管理员")
			}
		}
	}

	// 状态校验：停用账号不放行；pending 说明邮箱还没验证，而第三方已验证过邮箱 → 直接激活
	if (user.status === "disabled") {
		throw new Error("该账号已被管理员禁用，无法通过 GitHub 登录")
	}
	if (user.status === "pending") {
		activateUser(user.id)
		setEmailVerifiedAt(user.id)
	}

	touchLastLogin(user.id)

	return { account: user.account, name: user.name }
}
