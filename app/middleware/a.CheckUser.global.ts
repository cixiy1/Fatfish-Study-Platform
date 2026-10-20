import { GUEST_ONLY_PATHS, safeRedirect } from "~/utils/auth"

/**
 * 全局登录检查，按文件名排序最先执行。
 *
 * 默认策略：**全站拦截**（演示需要登录态，避免评委看到空数据页）。
 * 公开页面在页面内声明：definePageMeta({ auth: false })，
 * 或在 utils/auth.ts 的 GUEST_ONLY_PATHS 里登记。
 */
const DEFAULT_REQUIRE_AUTH = true

export default defineNuxtRouteMiddleware(async (to) => {
	// 内部请求（Nitro API、Vite 资源）不参与页面守卫
	if (to.path.startsWith("/api/") || to.path.startsWith("/_")) return

	const { resolveUser } = useAuthSession()
	const user = await resolveUser()
	const loggedIn = user !== null

	// 页面级声明优先于全局策略
	// 注意 guestOnly 必须排除在 requiresAuth 之外：登录页既是"游客页"又在"默认全拦"范围内，
	// 同时满足两条规则时会跳向自己，vue-router 直接抛 Infinite redirect in navigation guard。
	const guestOnly = to.meta.guestOnly ?? (GUEST_ONLY_PATHS as readonly string[]).includes(to.path)
	const requiresAuth = to.meta.auth ?? (DEFAULT_REQUIRE_AUTH && !guestOnly)

	// 已登录还去登录页 → 弹回来源页（或首页），并且不进历史栈
	if (loggedIn && guestOnly) {
		return navigateTo(safeRedirect(to.query.redirect) ?? "/", { replace: true })
	}

	// 未登录访问受保护页 → 带上原始地址去登录
	// 注意：这里手动 encodeURIComponent。交给 vue-router 的 query 序列化会把空格写成 "+"，
	// 而回读时 "+" 不会被还原成空格（实测 /account?x=a%20b 会变成 x=a+b），必须自己编码。
	if (!loggedIn && requiresAuth) {
		if (to.fullPath === "/") {
			return navigateTo("/login", { replace: true })
		}

		// SSR 下取原始 URL，避免 vue-router 重建 query 时把 %20 规范成 +
		const url = useRequestURL()
		const fullPath = import.meta.server
			? `${url.pathname}${url.search}`
			: to.fullPath

		return navigateTo(`/login?redirect=${encodeURIComponent(fullPath)}`, {
			replace: true,
		})
	}

	// 已登录但尚未制定学习计划 → 主线页面统一挡回计划引导
	// 注意：`/` 必须单独判断，不能塞进 startsWith 列表——startsWith("/") 会命中所有路径。
	const REQUIRES_LEARNING_PATH = ["/learning", "/learn", "/qa", "/reports", "/assessment", "/plan"]

	const needsLearningPath =
		to.path === "/" || REQUIRES_LEARNING_PATH.some((p) => to.path.startsWith(p))

	if (loggedIn && !user?.has_learning_path && needsLearningPath) {
		return navigateTo("/onboarding", { replace: true })
	}
})
