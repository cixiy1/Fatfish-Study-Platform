export default defineEventHandler((event) => {
	const user = readSession(event)

	if (!user) {
		throw createError({ statusCode: 401, statusMessage: "未登录" })
	}

	return user
})
