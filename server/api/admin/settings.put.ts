import type { SmtpConfig, OAuthCredentials, SmtpPreset, LlmConfig, LlmProvider } from "#shared/types/auth"
import { SMTP_PRESETS, LLM_PROVIDER_DEFAULTS } from "#shared/types/auth"
import { requireAdmin } from "../../utils/admin-guard"
import {
	clearSmtpConfig,
	getOAuthConfig,
	getSmtpConfig,
	setOAuthConfig,
	setSmtpConfig,
	getLlmConfig,
	setLlmConfig,
	clearLlmConfig,
} from "../../repositories/settings.repository"

interface UpdateSettingsBody {
	smtp?: (Partial<SmtpConfig> & { preset: SmtpPreset }) | null
	oauth?: Partial<OAuthCredentials> | null
	llm?: (Partial<LlmConfig> & { provider: LlmProvider }) | null
}

/** 根据 preset 解析 host/port/secure（custom 时用传入值） */
function resolveSmtpFields(input: Partial<SmtpConfig> & { preset: SmtpPreset }): SmtpConfig | null {
	const preset = input.preset
	let host = input.host ?? ""
	let port = input.port ?? 587
	let secure = input.secure ?? false

	if (preset !== "custom" && preset in SMTP_PRESETS) {
		const p = SMTP_PRESETS[preset as Exclude<SmtpPreset, "custom">]
		host = p.host
		port = p.port
		secure = p.secure
	}

	const user = (input.user ?? "").trim()
	if (!user) return null

	// 发件人留空时直接用登录账号（QQ/163 要求两者一致，这样最省事）
	const from = (input.from ?? "").trim() || user

	// 密码：前端传 null/undefined 表示不改，从原配置读取
	const existing = getSmtpConfig()
	const pass = input.pass ?? existing?.pass ?? ""
	if (!pass) return null

	return { preset, host, port, secure, user, pass, from }
}

/** 合并 OAuth 凭证：前端传 null secret 表示不改，从原配置读取 */
function mergeOAuthCredentials(input: Partial<OAuthCredentials>): OAuthCredentials {
	const existing = getOAuthConfig()
	const result: OAuthCredentials = {}

	const incoming = input.github
	if (incoming && incoming.clientId) {
		const secret = incoming.clientSecret ?? existing.github?.clientSecret ?? ""
		result.github = { clientId: incoming.clientId, clientSecret: secret }
	}

	return result
}

/** 根据 provider 解析 baseUrl 和 apiFormat（非 custom 时用默认值） */
function resolveLlmFields(input: Partial<LlmConfig> & { provider: LlmProvider }): LlmConfig | null {
	const provider = input.provider
	let baseUrl = input.baseUrl ?? ""
	let model = input.model ?? ""
	let apiFormat = input.apiFormat ?? "openai"

	if (provider !== "custom" && provider in LLM_PROVIDER_DEFAULTS) {
		const d = LLM_PROVIDER_DEFAULTS[provider as Exclude<LlmProvider, "custom">]
		if (!baseUrl) baseUrl = d.baseUrl
		apiFormat = d.apiFormat
	}

	if (!model) return null

	// API Key：前端传 null/undefined 表示不改，从原配置读取
	const existing = getLlmConfig()
	const apiKey = input.apiKey ?? existing?.apiKey ?? ""
	if (!apiKey) return null

	return {
		provider,
		apiFormat,
		baseUrl,
		apiKey,
		model,
		maxTokens: input.maxTokens ?? 16384,
	}
}

/**
 * 管理员更新配置：PUT /api/admin/settings
 *
 * - smtp === undefined：不修改；null：清除；对象：更新
 * - oauth === undefined：不修改；null：清除；对象：更新
 * - 密码/secret 传 null 表示不改，保留原值
 */
export default defineEventHandler(async (event) => {
	requireAdmin(event)

	const body = await readBody<UpdateSettingsBody>(event).catch(() => null)
	if (!body) {
		throw createError({ statusCode: 400, message: "请求体不能为空" })
	}

	if (body.smtp !== undefined) {
		if (body.smtp === null) {
			clearSmtpConfig()
		} else {
			const smtpConfig = resolveSmtpFields(body.smtp)
			if (!smtpConfig) {
				throw createError({ statusCode: 400, message: "SMTP 配置不完整" })
			}
			setSmtpConfig(smtpConfig)
		}
	}

	if (body.oauth !== undefined) {
		if (body.oauth === null) {
			setOAuthConfig({})
		} else {
			const oauthConfig = mergeOAuthCredentials(body.oauth)
			setOAuthConfig(oauthConfig)
		}
	}

	if (body.llm !== undefined) {
		if (body.llm === null) {
			clearLlmConfig()
		} else {
			const llmConfig = resolveLlmFields(body.llm)
			if (!llmConfig) {
				throw createError({ statusCode: 400, message: "大模型配置不完整" })
			}
			setLlmConfig(llmConfig)
		}
	}

	return { ok: true, message: "配置已更新" }
})
