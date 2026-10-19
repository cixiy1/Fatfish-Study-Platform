export default defineEventHandler((event) => {
	clearUserSession(event)
	return { ok: true }
})
