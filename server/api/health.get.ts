/**
 * 健康检查接口：GET /api/health
 *
 * 返回服务存活状态与当前时间戳，可用于探活、监控与部署校验。
 * 响应结构对应 shared/types 中的 HealthStatus。
 */
export default defineEventHandler(() => {
	return {
		status: "ok" as const,
		timestamp: new Date().toISOString(),
	}
})
