import type { H3Event } from "h3"
import { readConfig } from "./app-config"
import { decodePayload, encodePayload, sign, verify } from "./crypto"

/**
 * 会话（签名 cookie，零依赖）。
 *
 * 载荷经 HMAC-SHA256 签名后写入 httpOnly cookie，任何篡改都会导致验签失败。
 * 已替换原先「无签名 base64 明文」的开发占位实现。
 */

export interface SessionUser {
	account: string
	name: string
}

interface SessionPayload extends SessionUser {
	/** 过期时间戳（秒）；缺省表示会话 cookie，关闭浏览器即失效 */
	exp?: number
}

const COOKIE_NAME = "fsp_session"

/** 签名密钥：优先已安装配置，其次环境变量，最后开发兜底 */
function getSecret(): string {
	return (
		readConfig()?.security.sessionSecret
		?? process.env.FSP_SESSION_SECRET
		?? "fsp-dev-insecure-secret"
	)
}

function serialize(user: SessionUser, maxAge?: number): string {
	const payload: SessionPayload = { account: user.account, name: user.name }
	if (maxAge) payload.exp = Math.floor(Date.now() / 1000) + maxAge

	const encoded = encodePayload(payload)
	return `${encoded}.${sign(encoded, getSecret())}`
}

/** 读取并校验会话；签名不匹配或已过期均返回 null */
export function readSession(event: H3Event): SessionUser | null {
	const raw = getCookie(event, COOKIE_NAME)
	if (!raw) return null

	const index = raw.lastIndexOf(".")
	if (index <= 0) return null

	const encoded = raw.slice(0, index)
	const signature = raw.slice(index + 1)

	if (!verify(encoded, signature, getSecret())) return null

	const payload = decodePayload<SessionPayload>(encoded)
	if (!payload || typeof payload.account !== "string" || !payload.account) return null

	if (typeof payload.exp === "number" && payload.exp * 1000 < Date.now()) return null

	return { account: payload.account, name: String(payload.name || payload.account) }
}

export function setSession(event: H3Event, user: SessionUser, maxAge?: number): void {
	setCookie(event, COOKIE_NAME, serialize(user, maxAge), {
		httpOnly: true,
		sameSite: "lax",
		path: "/",
		// 本地是 http，正式环境走 https 才加 secure
		secure: !import.meta.dev,
		...(maxAge ? { maxAge } : {}),
	})
}

/**
 * 清除会话。命名加 User 前缀以避免与 h3 内置同名导出冲突
 * （此前构建日志出现 "Duplicated imports clearSession" 警告）。
 */
export function clearUserSession(event: H3Event): void {
	deleteCookie(event, COOKIE_NAME, { path: "/" })
}
