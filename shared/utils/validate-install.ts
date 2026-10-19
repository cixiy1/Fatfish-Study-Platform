import { isBlank, isValidEmail, isStrongPassword } from "./validate"
import type { InstallSmtpInput, InstallOAuthInput, InstallLlmInput } from "../types/install"
import { SMTP_PRESETS, LLM_PROVIDER_DEFAULTS } from "../types/auth"

/**
 * 安装向导表单校验（前后端共用）。
 */

export interface ValidationResult {
	ok: boolean
	message?: string
}

const OK: ValidationResult = { ok: true }

export function validateDatabaseInput(input: { file?: string }): ValidationResult {
	if (isBlank(input.file)) {
		return { ok: false, message: "请填写数据库文件路径" }
	}
	return OK
}

export function validateAdminInput(input: {
	account?: string
	password?: string
	email?: string
}): ValidationResult {
	if (isBlank(input.account) || (input.account as string).trim().length < 3) {
		return { ok: false, message: "管理员账号至少 3 个字符" }
	}

	if (isBlank(input.password) || !isStrongPassword(input.password as string)) {
		return { ok: false, message: "密码至少 8 位，且需包含字母和数字" }
	}

	if (input.email && !isBlank(input.email) && !isValidEmail(input.email)) {
		return { ok: false, message: "邮箱格式不正确" }
	}

	return OK
}

/** 校验可选的 SMTP 配置；未提供时放行 */
export function validateSmtpInput(input: InstallSmtpInput | undefined): ValidationResult {
	if (!input) return OK

	if (isBlank(input.user)) {
		return { ok: false, message: "SMTP 用户名不能为空" }
	}
	if (isBlank(input.pass)) {
		return { ok: false, message: "SMTP 密码不能为空" }
	}
	if (isBlank(input.from) || !isValidEmail(input.from)) {
		return { ok: false, message: "发件人邮箱格式不正确" }
	}

	if (input.preset === "custom") {
		if (isBlank(input.host)) {
			return { ok: false, message: "自定义 SMTP 主机不能为空" }
		}
		if (!input.port || input.port <= 0 || input.port > 65535) {
			return { ok: false, message: "SMTP 端口无效" }
		}
	} else {
		// 预设类型校验
		if (!(input.preset in SMTP_PRESETS)) {
			return { ok: false, message: "未知的 SMTP 预设类型" }
		}
	}

	return OK
}

/** 校验可选的 OAuth 凭证；未提供时放行 */
export function validateOAuthInput(input: InstallOAuthInput | undefined): ValidationResult {
	if (!input) return OK

	const check = (platform: string, creds?: { clientId?: string, clientSecret?: string }): ValidationResult => {
		if (!creds) return OK
		if (isBlank(creds.clientId)) {
			return { ok: false, message: `${platform} Client ID 不能为空` }
		}
		if (isBlank(creds.clientSecret)) {
			return { ok: false, message: `${platform} Client Secret 不能为空` }
		}
		return OK
	}

	const r1 = check("GitHub", input.github)
	if (!r1.ok) return r1
	const r2 = check("QQ", input.qq)
	if (!r2.ok) return r2
	const r3 = check("微信", input.wechat)
	if (!r3.ok) return r3

	return OK
}

/** 校验可选的大模型配置；未提供时放行 */
export function validateLlmInput(input: InstallLlmInput | undefined): ValidationResult {
	if (!input) return OK

	if (isBlank(input.apiKey)) {
		return { ok: false, message: "大模型 API Key 不能为空" }
	}
	if (isBlank(input.model)) {
		return { ok: false, message: "模型名称不能为空" }
	}

	if (input.provider === "custom") {
		if (isBlank(input.baseUrl)) {
			return { ok: false, message: "自定义 Base URL 不能为空" }
		}
	} else {
		if (!(input.provider in LLM_PROVIDER_DEFAULTS)) {
			return { ok: false, message: "未知的大模型提供商" }
		}
	}

	return OK
}

export function validateInstallPayload(input: {
	database?: { file?: string }
	admin?: { account?: string, password?: string, email?: string }
	smtp?: InstallSmtpInput
	oauth?: InstallOAuthInput
	llm?: InstallLlmInput
}): ValidationResult {
	const db = validateDatabaseInput(input.database ?? {})
	if (!db.ok) return db

	const admin = validateAdminInput(input.admin ?? {})
	if (!admin.ok) return admin

	const smtp = validateSmtpInput(input.smtp)
	if (!smtp.ok) return smtp

	const oauth = validateOAuthInput(input.oauth)
	if (!oauth.ok) return oauth

	const llm = validateLlmInput(input.llm)
	if (!llm.ok) return llm

	return OK
}
