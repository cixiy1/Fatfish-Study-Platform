import { isInstalled } from "../utils/app-config"

/**
 * 安装守卫（服务端）。
 *
 * 系统未安装时，拦截业务 API（放行安装接口与健康检查），
 * 前端页面跳转由 app/middleware/b.Install.global.ts 负责。
 */
export default defineEventHandler((event) => {
	if (isInstalled()) return

	const path = event.path

	// 放行：安装接口、大模型拉取（install 向导中需要）、健康检查、Nitro 内部与静态资源
	if (
		path.startsWith("/api/install/")
		|| path === "/api/admin/fetch-models"
		|| path === "/api/health"
		|| path.startsWith("/_")
		|| path.startsWith("/__")
	) {
		return
	}

	if (path.startsWith("/api/")) {
		throw createError({
			statusCode: 503,
			message: "系统尚未安装，请先访问 /install 完成初始化",
		})
	}
})
