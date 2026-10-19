/**
 * 前后端共享校验函数。
 *
 * shared/ 下的代码同时运行于客户端与服务端，因此只能使用纯逻辑，
 * 不得访问 window、document（客户端专有）或 process、fs（服务端专有）。
 */

/** 校验邮箱格式 */
export function isValidEmail(value: string): boolean {
	return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

/** 判断字符串是否为空或纯空白 */
export function isBlank(value: string | null | undefined): boolean {
	return value == null || value.trim().length === 0
}

/** 校验密码强度：至少 8 位，且同时包含字母与数字 */
export function isStrongPassword(value: string): boolean {
	return /^(?=.*[A-Za-z])(?=.*\d).{8,}$/.test(value)
}
