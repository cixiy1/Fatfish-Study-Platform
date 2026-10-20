import type { SmtpConfig, OAuthCredentials, OAuthPlatformCredentials, LlmConfig } from "#shared/types/auth"
import { decrypt, encrypt, isEncrypted } from "../utils/crypto"
import { getDb } from "../utils/db"

/**
 * settings 表数据访问层（key-value 结构）。
 *
 * SMTP 与 OAuth 配置以 JSON 存储，敏感字段（密码、secret）加密。
 */

const KEY_SMTP = "smtp"
const KEY_OAUTH = "oauth"
const KEY_LLM = "llm"

/** 读取原始设置值 */
export function getSetting(key: string): string | null {
	const row = getDb().prepare("SELECT value FROM settings WHERE key = ?").get(key) as
		| { value: string }
		| undefined
	return row?.value ?? null
}

/** 写入设置值（upsert） */
export function setSetting(key: string, value: string): void {
	getDb()
		.prepare(
			`INSERT INTO settings (key, value, updated_at)
			 VALUES (?, ?, datetime('now'))
			 ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
		)
		.run(key, value)
}

/* -------------------------------------------------------------------------- */
/* SMTP 配置                                                                   */
/* -------------------------------------------------------------------------- */

/** 读取 SMTP 配置（解密密码）；未配置返回 null */
export function getSmtpConfig(): SmtpConfig | null {
	const raw = getSetting(KEY_SMTP)
	if (!raw) return null

	try {
		const parsed = JSON.parse(raw) as SmtpConfig
		return {
			...parsed,
			pass: decrypt(parsed.pass),
		}
	} catch {
		return null
	}
}

/** 保存 SMTP 配置（加密密码） */
export function setSmtpConfig(config: SmtpConfig): void {
	const stored: SmtpConfig = {
		...config,
		pass: encrypt(config.pass),
	}
	setSetting(KEY_SMTP, JSON.stringify(stored))
}

/** 删除 SMTP 配置 */
export function clearSmtpConfig(): void {
	getDb().prepare("DELETE FROM settings WHERE key = ?").run(KEY_SMTP)
}

/* -------------------------------------------------------------------------- */
/* OAuth 凭证                                                                  */
/* -------------------------------------------------------------------------- */

/** 解密单个平台凭证 */
function decryptPlatform(creds?: OAuthPlatformCredentials): OAuthPlatformCredentials | undefined {
	if (!creds) return undefined
	return {
		clientId: creds.clientId,
		clientSecret: decrypt(creds.clientSecret),
	}
}

/** 加密单个平台凭证 */
function encryptPlatform(creds?: OAuthPlatformCredentials): OAuthPlatformCredentials | undefined {
	if (!creds) return undefined
	return {
		clientId: creds.clientId,
		clientSecret: encrypt(creds.clientSecret),
	}
}

/** 读取 OAuth 凭证（解密 secret） */
export function getOAuthConfig(): OAuthCredentials {
	const raw = getSetting(KEY_OAUTH)
	if (!raw) return {}

	try {
		const parsed = JSON.parse(raw) as OAuthCredentials
		// 历史数据里可能残留 qq / wechat 字段，读的时候直接丢掉，只认 github
		return {
			github: decryptPlatform(parsed.github),
		}
	} catch {
		return {}
	}
}

/** 保存 OAuth 凭证（加密 secret） */
export function setOAuthConfig(config: OAuthCredentials): void {
	const stored: OAuthCredentials = {
		github: encryptPlatform(config.github),
	}
	setSetting(KEY_OAUTH, JSON.stringify(stored))
}

/** 判断某平台是否已配置凭证 */
export function hasOAuthProvider(provider: keyof OAuthCredentials): boolean {
	const config = getOAuthConfig()
	const creds = config[provider]
	return !!creds && !!(creds as OAuthPlatformCredentials | undefined)?.clientId
}

/** 掩码敏感字段用于前端展示 */
export function maskSecret(value: string): string {
	if (!value) return ""
	if (value.length <= 4) return "****"
	return `${value.slice(0, 2)}****${value.slice(-2)}`
}

/** 判断存储值是否已加密（用于脱敏展示） */
export { isEncrypted }

/* -------------------------------------------------------------------------- */
/* LLM 大模型配置                                                              */
/* -------------------------------------------------------------------------- */

/** 读取 LLM 配置（解密 apiKey）；未配置返回 null */
export function getLlmConfig(): LlmConfig | null {
	const raw = getSetting(KEY_LLM)
	if (!raw) return null

	try {
		const parsed = JSON.parse(raw) as LlmConfig
		return {
			...parsed,
			apiKey: decrypt(parsed.apiKey),
		}
	} catch {
		return null
	}
}

/** 保存 LLM 配置（加密 apiKey） */
export function setLlmConfig(config: LlmConfig): void {
	const stored: LlmConfig = {
		...config,
		apiKey: encrypt(config.apiKey),
	}
	setSetting(KEY_LLM, JSON.stringify(stored))
}

/** 删除 LLM 配置 */
export function clearLlmConfig(): void {
	getDb().prepare("DELETE FROM settings WHERE key = ?").run(KEY_LLM)
}
