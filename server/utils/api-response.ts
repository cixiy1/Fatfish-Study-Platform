import type { ApiResponse } from "#shared/types"

/**
 * 统一 API 响应封装。
 *
 * 所有 server/api 接口统一返回 ApiResponse 结构（code/message/data），
 * 前端可据此做一致的成功/失败判断。
 */

/** 业务错误码 → HTTP 状态码语义 */
export const ErrorCode = {
	OK: 0,
	BAD_REQUEST: 400,
	UNAUTHORIZED: 401,
	FORBIDDEN: 403,
	NOT_FOUND: 404,
	CONFLICT: 409,
	INTERNAL: 500,
	NOT_INSTALLED: 503,
} as const

export function ok<T>(data: T, message = "ok"): ApiResponse<T> {
	return { code: ErrorCode.OK, message, data }
}

export function fail(code: number, message: string): ApiResponse<null> {
	return { code, message, data: null }
}
