/**
 * 管理员权限守卫（前端）。
 *
 * 拦截 /admin 前缀路由：未登录跳登录页，非管理员跳首页。
 */
export default defineNuxtRouteMiddleware(async (to) => {
	if (!to.path.startsWith("/admin")) return

	const { resolveUser } = useAuthSession()
	const user = await resolveUser()

	if (!user) {
		const url = useRequestURL()
		const fullPath = import.meta.server ? `${url.pathname}${url.search}` : to.fullPath
		return navigateTo(`/login?redirect=${encodeURIComponent(fullPath)}`, { replace: true })
	}

	if (user.role !== "admin") {
		return navigateTo("/", { replace: true })
	}
})
