/**
 * 安装向导相关共享类型。
 */

import type { SmtpConfig, OAuthPlatformCredentials, LlmProvider } from "./auth"

export interface InstallStatusResponse {
	installed: boolean
	installedAt: string | null
	siteName: string
}

export interface InstallDatabaseInput {
	/** SQLite 数据文件路径（相对数据目录或绝对路径） */
	file: string
}

export interface InstallAdminInput {
	account: string
	password: string
	name?: string
	email?: string
}

export interface InstallSiteInput {
	name?: string
	url?: string
}

/** 安装时可选的 SMTP 配置（preset 为 custom 时需填 host/port） */
export interface InstallSmtpInput {
	preset: SmtpConfig["preset"]
	host?: string
	port?: number
	secure?: boolean
	user: string
	pass: string
	from: string
}

/** 安装时可选的 OAuth 凭证（当前只支持 GitHub） */
export interface InstallOAuthInput {
	github?: OAuthPlatformCredentials
}

/** 安装时必须填写的大模型配置（平台的 AI 功能全部依赖它） */
export interface InstallLlmInput {
	provider: LlmProvider
	baseUrl?: string
	apiKey: string
	model: string
	maxTokens?: number
}

export interface InstallPayload {
	database: InstallDatabaseInput
	admin: InstallAdminInput
	site?: InstallSiteInput
	/** 可选 SMTP 配置，跳过则不配置邮件 */
	smtp?: InstallSmtpInput
	/** 可选 OAuth 凭证，跳过则不配置第三方登录 */
	oauth?: InstallOAuthInput
	/** 必填：大模型接口，没有它连首次引导都走不完 */
	llm: InstallLlmInput
}

export interface ConnectionTestResult {
	file: string
}
