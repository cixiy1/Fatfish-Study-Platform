/**
 * 前后端共享类型定义。
 *
 * Nuxt 4 的 shared/ 目录对 app/（客户端）与 server/（服务端）双向可见，
 * 适合存放纯类型与纯函数。仅前端使用的类型（如 PageMeta 扩展）请放 app/types/。
 */

/** 统一 API 响应结构 */
export interface ApiResponse<T = unknown> {
	code: number
	message: string
	data: T
}

/** 分页结果 */
export interface Paginated<T> {
	items: T[]
	total: number
	page: number
	pageSize: number
}

/** 健康检查响应，对应 server/api/health.get.ts */
export interface HealthStatus {
	status: "ok" | "error"
	timestamp: string
}
