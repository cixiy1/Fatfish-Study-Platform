/**
 * 请求日志中间件。
 *
 * Nitro 服务端中间件按注册顺序执行，处理函数直接返回即放行，
 * 无需（也不能）手动调用 next()。仅开发环境输出，避免生产刷日志。
 */
export default defineEventHandler((event) => {
	if (!import.meta.dev) return

	const { method } = event
	const { pathname } = getRequestURL(event)

	console.info(`[${new Date().toISOString()}] ${method} ${pathname}`)
})
