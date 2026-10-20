import { mkdirSync } from "node:fs"
import { dirname, isAbsolute, resolve } from "node:path"
import Database from "better-sqlite3"
import {
	type AppConfig,
	getDataDir,
	isInstalled,
	readConfig,
	resolveDbFile,
	writeConfig,
} from "./app-config"
import { closeDb } from "./db"
import { generateSecret, hashPassword } from "./password"
import { migrate } from "./schema"
import { setOAuthConfig, setSmtpConfig, setLlmConfig } from "../repositories/settings.repository"
import { SMTP_PRESETS, LLM_PROVIDER_DEFAULTS } from "#shared/types/auth"
import type { InstallPayload, InstallSmtpInput, InstallLlmInput } from "#shared/types/install"

/**
 * 首次部署安装逻辑：连接测试 → 建表 → 创建管理员 → 持久化配置 → 可选保存 SMTP/OAuth。
 */

export interface InstallStatus {
	installed: boolean
	installedAt: string | null
	siteName: string
}

export function getInstallStatus(): InstallStatus {
	const config = readConfig()
	return {
		installed: config?.installed === true,
		installedAt: config?.installedAt ?? null,
		siteName: config?.site.name ?? "FSP",
	}
}

function resolveTarget(file: string): string {
	return isAbsolute(file) ? file : resolve(getDataDir(), file)
}

/**
 * 测试数据库连通性。成功返回解析后的文件路径，失败抛出异常。
 * 仅做连接与建目录校验，不写入任何应用配置。
 */
export function testDatabaseConnection(file: string): { file: string } {
	const target = resolveTarget(file)
	mkdirSync(dirname(target), { recursive: true })

	const db = new Database(target)
	try {
		db.pragma("journal_mode = WAL")
		db.prepare("SELECT 1 AS ok").get()
	} finally {
		db.close()
	}

	return { file: target }
}

/** 将安装向导的 SMTP 输入转为完整配置 */
function resolveSmtpConfig(input: InstallSmtpInput) {
	const preset = input.preset
	let host = input.host ?? ""
	let port = input.port ?? 587
	let secure = input.secure ?? false

	if (preset !== "custom" && preset in SMTP_PRESETS) {
		const p = SMTP_PRESETS[preset as Exclude<typeof preset, "custom">]
		host = p.host
		port = p.port
		secure = p.secure
	}

	return { preset, host, port, secure, user: input.user, pass: input.pass, from: input.from }
}

/** 将安装向导的 LLM 输入转为完整配置 */
function resolveLlmConfig(input: InstallLlmInput) {
	const provider = input.provider
	let baseUrl = input.baseUrl ?? ""
	let model = input.model

	if (provider !== "custom" && provider in LLM_PROVIDER_DEFAULTS) {
		const d = LLM_PROVIDER_DEFAULTS[provider as Exclude<typeof provider, "custom">]
		if (!baseUrl) baseUrl = d.baseUrl
	}

	return {
		provider,
		baseUrl,
		apiKey: input.apiKey,
		model,
		maxTokens: input.maxTokens ?? 4096,
	}
}

/** 执行安装；已安装时抛出 ALREADY_INSTALLED */
export function runInstall(payload: InstallPayload): AppConfig {
	if (isInstalled()) {
		throw new Error("ALREADY_INSTALLED")
	}

	const dbFile = payload.database.file.trim() || "fsp.db"
	const target = resolveTarget(dbFile)
	mkdirSync(dirname(target), { recursive: true })

	// 提前生成密钥，确保 writeConfig 后加密可用
	const sessionSecret = generateSecret()

	// 用独立连接完成初始化，最后重置全局单例，避免污染运行中的连接
	const db = new Database(target)
	try {
		db.pragma("journal_mode = WAL")
		db.pragma("foreign_keys = ON")
		migrate(db)

		const passwordHash = hashPassword(payload.admin.password)
		const adminEmail = payload.admin.email?.trim() || `${payload.admin.account.trim()}__legacy@local.invalid`
		db.prepare(
			`INSERT INTO users (account, password_hash, name, email, role, status, email_verified_at)
			 VALUES (?, ?, ?, ?, 'admin', 'active', datetime('now'))`,
		).run(
			payload.admin.account.trim(),
			passwordHash,
			(payload.admin.name ?? payload.admin.account).trim(),
			adminEmail,
		)
	} finally {
		db.close()
	}

	closeDb()

	const config: AppConfig = {
		installed: true,
		installedAt: new Date().toISOString(),
		site: {
			name: payload.site?.name?.trim() || "FSP",
			url: payload.site?.url?.trim() || "",
		},
		database: { type: "sqlite", file: dbFile },
		security: { sessionSecret },
		admin: { account: payload.admin.account.trim() },
	}
	writeConfig(config)

	// 配置已写入，此时 settings.repository 的加密可正常工作
	if (payload.smtp) {
		setSmtpConfig(resolveSmtpConfig(payload.smtp))
	}
	if (payload.oauth) {
		setOAuthConfig(payload.oauth)
	}
	// 必填：没有大模型，平台装完也走不完首次引导
	setLlmConfig(resolveLlmConfig(payload.llm))

	return config
}

/** 当前数据库文件绝对路径（诊断用） */
export function currentDbFile(): string {
	return resolveDbFile(readConfig())
}
