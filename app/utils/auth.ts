/**
 * 游客专属页面：已登录用户访问时会被弹回站内。
 * 新增注册/找回密码页时在这里登记即可。
 */
export const GUEST_ONLY_PATHS = [
	"/login",
	"/register",
	"/install",
	"/forgot-password",
	"/reset-password",
] as const

/**
 * 校验回跳地址，避免开放重定向（`//evil.com`、`https://evil.com` 这类都要挡掉）。
 * 只接受站内绝对路径，且不允许跳回登录页自身造成死循环。
 */
export function safeRedirect(raw: unknown): string | null {
	const value = Array.isArray(raw) ? raw[0] : raw
	if (typeof value !== "string" || value.length === 0) return null
	// 必须以单个 "/" 开头："/x" 合法，"//host" 是协议相对地址，要拒绝
	if (!value.startsWith("/") || value.startsWith("//")) return null

	const path = value.split(/[?#]/)[0] ?? ""
	if ((GUEST_ONLY_PATHS as readonly string[]).includes(path)) return null

	return value
}
