export interface AuthUser {
	account: string
	name: string
}

/**
 * 登录态的唯一来源。
 *
 * 设计要点：
 * - cookie 是 httpOnly 的，前端读不到，所以客户端只认 `/api/auth/me` 的结果；
 * - 结果缓存在 `useState` 里，SSR 渲染完会随 payload 传给客户端，hydration 后不会再打一次；
 * - 服务端没有会话 cookie 时直接短路，不做内部请求。
 */
export function useAuthSession() {
	const user = useState<AuthUser | null>("auth:user", () => null)
	const resolved = useState<boolean>("auth:resolved", () => false)
	const pending = useState<boolean>("auth:pending", () => false)

	const isLoggedIn = computed(() => user.value !== null)

	/** 是否带着会话 cookie（httpOnly 不影响服务端读取请求头） */
	function hasSessionCookie() {
		const raw = useRequestHeaders(["cookie"]).cookie ?? ""
		return raw.split(";").some((part) => part.trim().startsWith("fsp_session="))
	}

	async function fetchMe(): Promise<AuthUser | null> {
		// SSR 下必须用 useRequestFetch 才会转发原始请求的 cookie
		const fetcher = import.meta.server ? useRequestFetch() : $fetch
		try {
			return await fetcher<AuthUser>("/api/auth/me")
		} catch {
			// 401 / 网络异常统一视为未登录
			return null
		}
	}

	/**
	 * 解析当前登录态。中间件每次导航都会调，靠 resolved 缓存避免重复请求。
	 * @param force 强制重新校验（例如登录后需要刷新用户信息）
	 */
	async function resolveUser(force = false): Promise<AuthUser | null> {
		if (!force && resolved.value) return user.value

		if (import.meta.server && !hasSessionCookie()) {
			user.value = null
			resolved.value = true
			return null
		}

		if (pending.value) return user.value

		pending.value = true
		try {
			user.value = await fetchMe()
		} finally {
			pending.value = false
			resolved.value = true
		}

		return user.value
	}

	async function login(account: string, password: string, remember = true) {
		const data = await $fetch<{ user: AuthUser }>("/api/auth/login", {
			method: "POST",
			body: { account, password, remember },
		})
		user.value = data.user
		resolved.value = true
		return data.user
	}

	async function logout(redirect = "/login") {
		await $fetch("/api/auth/logout", { method: "POST" }).catch(() => {
			// 退出失败也要清本地态，否则页面会卡在"已登录"
		})
		user.value = null
		resolved.value = true
		await navigateTo(redirect, { replace: true })
	}

	return {
		user,
		isLoggedIn,
		resolveUser,
		login,
		logout,
	}
}
