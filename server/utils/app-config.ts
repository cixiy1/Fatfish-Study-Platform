import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, isAbsolute, resolve } from "node:path"
import { getRequestURL, type H3Event } from "h3"

/**
 * 应用配置持久化。
 *
 * 首次部署时由 /install 向导写入 `data/config.json`，重启后由本项目读取。
 * 敏感字段（会话密钥等）落在此文件，注意不要提交到 git（data/ 已忽略）。
 */

export interface DatabaseConfig {
	/** 当前仅支持 sqlite；后续扩展 mysql/postgres 时在此加枚举 */
	type: "sqlite"
	/** SQLite 数据文件路径（相对数据目录或绝对路径） */
	file: string
}

export interface AppConfig {
	installed: boolean
	installedAt: string | null
	site: {
		name: string
		url: string
	}
	database: DatabaseConfig
	security: {
		sessionSecret: string
	}
	admin: {
		account: string
	}
}

const CONFIG_FILE = "config.json"

/** 数据目录：优先环境变量 FSP_DATA_DIR，默认项目根下 data/ */
export function getDataDir(): string {
	const configured = process.env.FSP_DATA_DIR
	if (configured && configured.trim()) {
		return isAbsolute(configured) ? configured : resolve(process.cwd(), configured)
	}
	return resolve(process.cwd(), "data")
}

export function getConfigPath(): string {
	return resolve(getDataDir(), CONFIG_FILE)
}

export function readConfig(): AppConfig | null {
	const file = getConfigPath()
	if (!existsSync(file)) return null

	try {
		const parsed = JSON.parse(readFileSync(file, "utf8")) as AppConfig
		if (!parsed || typeof parsed !== "object") return null
		return parsed
	} catch {
		// 配置损坏时视为未安装，交由 /install 重新初始化
		return null
	}
}

export function writeConfig(config: AppConfig): void {
	const file = getConfigPath()
	mkdirSync(dirname(file), { recursive: true })
	writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`, "utf8")
}

export function isInstalled(): boolean {
	return readConfig()?.installed === true
}

/** 解析 SQLite 文件绝对路径 */
export function resolveDbFile(config: AppConfig | null = readConfig()): string {
	const file = config?.database.file ?? "fsp.db"
	return isAbsolute(file) ? file : resolve(getDataDir(), file)
}

/** 去掉首尾空白与结尾斜杠，避免拼出 `//api/...` 这类地址 */
export function normalizeSiteUrl(raw: string): string {
	return raw.trim().replace(/\/+$/, "")
}

/**
 * 解析站点对外地址，用于 OAuth 回调与邮件里的链接。
 *
 * 取址顺序：配置项 → 环境变量 FSP_SITE_URL → 当前请求的协议 + Host。
 * 安装时若没填站点地址，就靠请求来源兜底，而不是直接报错让功能不可用。
 */
export function resolveSiteUrl(event?: H3Event): string {
	const configured = readConfig()?.site.url
	if (configured && configured.trim()) return normalizeSiteUrl(configured)

	const fromEnv = process.env.FSP_SITE_URL
	if (fromEnv && fromEnv.trim()) return normalizeSiteUrl(fromEnv)

	if (event) {
		const url = getRequestURL(event)
		return `${url.protocol}//${url.host}`
	}

	throw new Error("站点地址未配置：请在管理后台填写站点地址")
}

/** 更新站点信息（名称 / 地址），地址允许清空，清空后回退到请求来源 */
export function updateSiteConfig(patch: { name?: string, url?: string }): AppConfig {
	const config = readConfig()
	if (!config) throw new Error("NOT_INSTALLED")

	const nextName = patch.name === undefined ? config.site.name : patch.name.trim()
	const nextUrl = patch.url === undefined ? config.site.url : normalizeSiteUrl(patch.url)

	const next: AppConfig = {
		...config,
		site: {
			name: nextName || "FSP",
			url: nextUrl,
		},
	}
	writeConfig(next)
	return next
}
