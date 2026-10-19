export default defineEventHandler((event) => {
	clearSession(event)
	return { ok: true }
})
