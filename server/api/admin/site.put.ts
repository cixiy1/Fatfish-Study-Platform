import { requireAdmin } from "../../utils/admin-guard"
import { updateSiteConfig } from "../../utils/app-config"

interface UpdateSiteBody {
	name?: string
	url?: string
}

/**
 * 更新站点信息：PUT /api/admin/site
 *
 * 站点地址决定 OAuth 回调地址与邮件里的链接，必须是可访问的绝对地址。
 * 允许留空：留空时运行时回退到请求来源，但生产环境建议显式填写。
 */
export default defineEventHandler(async (event) => {
	requireAdmin(event)

	const body = await readBody<UpdateSiteBody>(event).catch(() => null)
	if (!body) {
		throw createError({ statusCode: 400, message: "请求体不能为空" })
	}

	const url = (body.url ?? "").trim()
	if (url) {
		let parsed: URL
		try {
			parsed = new URL(url)
		} catch {
			throw createError({ statusCode: 400, message: "站点地址格式不正确，需形如 https://example.com" })
		}
		if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
			throw createError({ statusCode: 400, message: "站点地址必须以 http:// 或 https:// 开头" })
		}
	}

	if (body.name !== undefined && !body.name.trim()) {
		throw createError({ statusCode: 400, message: "站点名称不能为空" })
	}

	const config = updateSiteConfig({ name: body.name, url })

	return {
		ok: true,
		message: "站点设置已保存",
		site: { name: config.site.name, url: config.site.url },
	}
})
