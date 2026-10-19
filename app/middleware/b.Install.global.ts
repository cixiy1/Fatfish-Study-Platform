import type { InstallStatusResponse } from "#shared/types/install"

/**
 * 安装守卫（前端路由）。
 *
 * 前缀 b. 确保在 a.CheckUser.global.ts 之后执行。
 * - 未安装：除 /install 外的页面一律重定向到 /install
 * - 已安装：访问 /install 重定向回首页，防止重复初始化
 */
export default defineNuxtRouteMiddleware(async (to) => {
	const { fetchStatus } = useInstall()
	const status = await fetchStatus().catch((): InstallStatusResponse | null => null)
	if (!status) return

	if (!status.installed && to.path !== "/install") {
		return navigateTo("/install", { replace: true })
	}

	if (status.installed && to.path === "/install") {
		return navigateTo("/", { replace: true })
	}
})
