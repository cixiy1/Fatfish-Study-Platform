/**
 * 认证相关共享类型（注册、邮件验证、OAuth、管理员配置）。
 *
 * 前后端共享，仅含纯类型定义。
 */

/** 第三方 OAuth 平台标识（只接 GitHub） */
export type OAuthProvider = "github"

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

/** OAuth 凭证集合（存 settings 表，secret 加密）。当前只接 GitHub 一家 */
export interface OAuthCredentials {
	github?: OAuthPlatformCredentials
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
export type LlmProvider = "openai" | "anthropic" | "deepseek" | "qwen" | "glm" | "maas" | "moonshot" | "custom"

/** API 兼容格式 */
export type LlmApiFormat = "openai" | "anthropic"

/** 大模型配置（存 settings 表，apiKey 加密） */
export interface LlmConfig {
	/** 提供商类型，custom 表示自定义端点 */
	provider: LlmProvider
	/** API 兼容格式（openai 用 /chat/completions，anthropic 用 /messages） */
	apiFormat: LlmApiFormat
	/** API Base URL */
	baseUrl: string
	/** API Key（加密存储） */
	apiKey: string
	/** 模型名称 */
	model: string
	/** 最大输出 token 数 */
	maxTokens: number
}

/** 大模型提供商默认配置 */
export const LLM_PROVIDER_DEFAULTS: Record<Exclude<LlmProvider, "custom">, { baseUrl: string, model: string, apiFormat: LlmApiFormat }> = {
	openai: { baseUrl: "https://api.openai.com/v1", model: "gpt-4o", apiFormat: "openai" },
	anthropic: { baseUrl: "https://api.anthropic.com/v1", model: "claude-3-5-sonnet-20241022", apiFormat: "anthropic" },
	deepseek: { baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat", apiFormat: "openai" },
	qwen: { baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", model: "qwen-plus", apiFormat: "openai" },
	glm: { baseUrl: "https://open.bigmodel.cn/api/paas/v4", model: "glm-4-plus", apiFormat: "openai" },
	maas: { baseUrl: "https://maas-api.cn-east-3.myhuaweicloud.com/v1", model: "DeepSeek-R1", apiFormat: "openai" },
	moonshot: { baseUrl: "https://api.moonshot.cn/v1", model: "moonshot-v1-8k", apiFormat: "openai" },
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
