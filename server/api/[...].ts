/**
 * /api/* 兜底：没有匹配到任何接口时返回 JSON 404。
 *
 * 否则会被 app/pages/[...slug].vue 的通配页接住，返回一份 200 的 HTML，
 * 让人误以为旧接口还活着（例如已下线的 /api/auth/qq）。
 */
export default defineEventHandler(() => {
	throw createError({
		statusCode: 404,
		statusMessage: "API Not Found",
		message: "接口不存在",
	})
})
