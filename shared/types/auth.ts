/**
 * 认证相关共享类型（注册、邮件验证、OAuth、管理员配置）。
 *
 * 前后端共享，仅含纯类型定义。
 */

/** 第三方 OAuth 平台标识 */
export type OAuthProvider = "github" | "qq" | "wechat"

/** 注册请求体 */
export interface RegisterPayload {
	account: string
	email: string
	password: string
	/** 可选昵称，为空时默认取 account */
	name?: string
}

/** 注册成功响应体 */
export interface RegisterResponse {
	user: {
		account: string
		name: string
	}
}

/** 邮件验证结果 */
export interface VerifyEmailResult {
	ok: boolean
	message: string
}

/** SMTP 预设类型 */
export type SmtpPreset = "gmail" | "qq" | "163" | "custom"

/** SMTP 预设配置 */
export interface SmtpPresetConfig {
	host: string
	port: number
	secure: boolean
}

/** SMTP 完整配置（存 settings 表，密码加密） */
export interface SmtpConfig {
	/** 预设类型，custom 表示全自填 */
	preset: SmtpPreset
	host: string
	port: number
	/** 是否使用 TLS 直连（465 端口通常 true，587 用 STARTTLS） */
	secure: boolean
	/** SMTP 登录用户名 */
	user: string
	/** SMTP 登录密码（加密存储） */
	pass: string
	/** 发件人地址 */
	from: string
}

/** SMTP 预设映射 */
export const SMTP_PRESETS: Record<Exclude<SmtpPreset, "custom">, SmtpPresetConfig> = {
	gmail: { host: "smtp.gmail.com", port: 587, secure: false },
	qq: { host: "smtp.qq.com", port: 587, secure: false },
	"163": { host: "smtp.163.com", port: 587, secure: false },
}

/** 单个 OAuth 平台凭证 */
export interface OAuthPlatformCredentials {
	clientId: string
	clientSecret: string
}

/** OAuth 凭证集合（存 settings 表，secret 加密） */
export interface OAuthCredentials {
	github?: OAuthPlatformCredentials
	qq?: OAuthPlatformCredentials
	wechat?: OAuthPlatformCredentials
}

/** 管理员后台配置（敏感字段脱敏后返回前端） */
export interface AdminSettings {
	smtp: SmtpConfig | null
	oauth: OAuthCredentials
	llm: LlmConfig | null
}

/** 管理员后台配置响应（敏感字段掩码） */
export interface AdminSettingsResponse {
	smtp: (Omit<SmtpConfig, "pass"> & { pass: string | null }) | null
	oauth: {
		github?: (Omit<OAuthPlatformCredentials, "clientSecret"> & { clientSecret: string | null })
		qq?: (Omit<OAuthPlatformCredentials, "clientSecret"> & { clientSecret: string | null })
		wechat?: (Omit<OAuthPlatformCredentials, "clientSecret"> & { clientSecret: string | null })
	}
	llm: (Omit<LlmConfig, "apiKey"> & { apiKey: string | null }) | null
}

/** SMTP 测试请求 */
export interface TestSmtpRequest {
	to: string
}

/** SMTP 测试响应 */
export interface TestSmtpResponse {
	ok: boolean
	message: string
}

/** 大模型提供商 */
export type LlmProvider = "openai" | "anthropic" | "custom"

/** 大模型配置（存 settings 表，apiKey 加密） */
export interface LlmConfig {
	/** 提供商类型，custom 表示兼容 OpenAI 格式的自定义端点 */
	provider: LlmProvider
	/** API Base URL（openai 默认 https://api.openai.com/v1，anthropic 默认 https://api.anthropic.com/v1） */
	baseUrl: string
	/** API Key（加密存储） */
	apiKey: string
	/** 模型名称（如 gpt-4o、claude-3-5-sonnet-20241022） */
	model: string
	/** 最大输出 token 数 */
	maxTokens: number
}

/** 大模型提供商默认配置 */
export const LLM_PROVIDER_DEFAULTS: Record<Exclude<LlmProvider, "custom">, { baseUrl: string, model: string }> = {
	openai: { baseUrl: "https://api.openai.com/v1", model: "gpt-4o" },
	anthropic: { baseUrl: "https://api.anthropic.com/v1", model: "claude-3-5-sonnet-20241022" },
}

/** 大模型测试请求 */
export interface TestLlmRequest {
	prompt?: string
}

/** 大模型测试响应 */
export interface TestLlmResponse {
	ok: boolean
	message: string
	reply?: string
}
