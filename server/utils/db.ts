import { mkdirSync } from "node:fs"
import { dirname, resolve } from "node:path"
import Database from "better-sqlite3"
import { readConfig, resolveDbFile } from "./app-config"
import { migrate } from "./schema"
import { seed } from "./seed"

/**
 * SQLite 连接单例（zero-dependency，复用已声明的 better-sqlite3）。
 *
 * 连接在 Nitro 进程内复用；数据库文件默认落在 data/ 目录（已被 .gitignore 忽略）。
 */

let instance: Database.Database | null = null

/** 当前数据库文件路径（便于测试与诊断） */
export function getDbFile(): string {
	return resolveDbFile(readConfig())
}

/** 获取连接单例，首次调用时创建文件目录并打开数据库 */
export function getDb(): Database.Database {
	if (instance) return instance

	const file = getDbFile()
	mkdirSync(dirname(resolve(file)), { recursive: true })

	const db = new Database(file)
	db.pragma("journal_mode = WAL")
	db.pragma("foreign_keys = ON")

	migrate(db)
	seed(db)

	instance = db
	return instance
}

/** 关闭连接（测试清理用） */
export function closeDb(): void {
	if (!instance) return
	instance.close()
	instance = null
}
