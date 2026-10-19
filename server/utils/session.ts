import type { H3Event } from "h3"

export interface SessionUser {
	account: string
	name: string
}

const COOKIE_NAME = "fsp_session"

/**
 * 开发占位会话：payload 只是 base64url 的明文 JSON，**没有签名**，
 * 谁都能伪造。正式上线必须换成签名 JWT 或服务端 session store（Redis / DB）。
 */
function encode(user: SessionUser) {
	return Buffer.from(JSON.stringify(user), "utf8").toString("base64url")
}

export function readSession(event: H3Event): SessionUser | null {
	const raw = getCookie(event, COOKIE_NAME)
	if (!raw) return null

	try {
		const data = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"))
		if (!data || typeof data.account !== "string" || !data.account) return null
		return { account: data.account, name: String(data.name || data.account) }
	} catch {
		// 伪造 / 旧格式一律当未登录
		return null
	}
}

export function setSession(event: H3Event, user: SessionUser, maxAge?: number) {
	setCookie(event, COOKIE_NAME, encode(user), {
		httpOnly: true,
		sameSite: "lax",
		path: "/",
		// 本地是 http，正式环境走 https 才加 secure
		secure: !import.meta.dev,
		...(maxAge ? { maxAge } : {}),
	})
}

export function clearSession(event: H3Event) {
	deleteCookie(event, COOKIE_NAME, { path: "/" })
}
