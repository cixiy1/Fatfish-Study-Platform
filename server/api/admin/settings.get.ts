import type { AdminSettingsResponse } from "#shared/types/auth"
import { requireAdmin } from "../../utils/admin-guard"
import { getOAuthConfig, getSmtpConfig, getLlmConfig } from "../../repositories/settings.repository"

/**
 * 管理员读取配置：GET /api/admin/settings
 *
 * 敏感字段（SMTP 密码、OAuth Secret、LLM API Key）返回 null 表示已设置但隐藏。
 */
export default defineEventHandler((event) => {
	requireAdmin(event)

	const smtp = getSmtpConfig()
	const oauth = getOAuthConfig()
	const llm = getLlmConfig()

	const response: AdminSettingsResponse = {
		smtp: smtp
			? {
					preset: smtp.preset,
					host: smtp.host,
					port: smtp.port,
					secure: smtp.secure,
					user: smtp.user,
					pass: null,
					from: smtp.from,
				}
			: null,
		oauth: {
			github: oauth.github
				? { clientId: oauth.github.clientId, clientSecret: null }
				: undefined,
		},
		llm: llm
			? {
					provider: llm.provider,
					apiFormat: llm.apiFormat,
					baseUrl: llm.baseUrl,
					apiKey: null,
					model: llm.model,
					maxTokens: llm.maxTokens,
				}
			: null,
	}

	return response
})
