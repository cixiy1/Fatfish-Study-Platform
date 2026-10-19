interface LoginBody {
	account?: string
	password?: string
	remember?: boolean
}

export default defineEventHandler(async (event) => {
	const body = await readBody<LoginBody>(event).catch(() => null)

	const account = (body?.account ?? "").trim()
	const password = body?.password ?? ""

	if (!account || !password) {
		throw createError({ statusCode: 400, statusMessage: "账号和密码不能为空" })
	}

	// 生产环境必须替换成真实校验（查库 + 密码哈希比对），这里直接拒绝，避免占位逻辑被带上线
	if (!import.meta.dev) {
		throw createError({
			statusCode: 501,
			statusMessage: "登录接口尚未接入真实鉴权",
		})
	}

	// ---- 以下为开发期占位：任意非空账号密码都放行 ----
	const user = { account, name: account }

	// 记住我 = 7 天，不勾选则用会话 cookie（关浏览器即失效）
	setSession(event, user, body?.remember ? 60 * 60 * 24 * 7 : undefined)

	return { user }
})
