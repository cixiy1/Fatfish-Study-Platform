import { requireAdmin } from "../../utils/admin-guard"
import { readConfig, resolveSiteUrl } from "../../utils/app-config"

/**
 * 读取站点信息：GET /api/admin/site
 *
 * `url` 是配置里存的值（可能为空），`effectiveUrl` 是实际生效的地址：
 * 配置为空时会回退到本次请求的协议 + Host。
 */
export default defineEventHandler((event) => {
	requireAdmin(event)

	const config = readConfig()
	return {
		name: config?.site.name ?? "FSP",
		url: config?.site.url ?? "",
		effectiveUrl: resolveSiteUrl(event),
	}
})
