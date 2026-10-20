import Database from "better-sqlite3"
import { describe, expect, it } from "vitest"
import { currentVersion, migrate } from "../../server/utils/schema"

describe("schema migrate", () => {
	it("迁移建表且版本正确", () => {
		const db = new Database(":memory:")
		migrate(db)

		expect(currentVersion(db)).toBe(6)

		const tables = db
			.prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
			.all() as { name: string }[]
		const names = tables.map((table) => table.name)

		expect(names).toContain("users")
		expect(names).toContain("settings")
		expect(names).toContain("schema_migrations")
		expect(names).toContain("email_verification_tokens")
		expect(names).toContain("password_reset_tokens")
		expect(names).toContain("mastery_checks")

		db.close()
	})

	it("重复迁移幂等，不报错", () => {
		const db = new Database(":memory:")
		migrate(db)
		migrate(db)

		expect(currentVersion(db)).toBe(6)

		const count = db.prepare("SELECT COUNT(*) AS count FROM schema_migrations").get() as { count: number }
		expect(count.count).toBe(6)

		db.close()
	})

	it("v2 迁移后 users.email 为 NOT NULL UNIQUE", () => {
		const db = new Database(":memory:")
		migrate(db)

		const info = db.prepare("PRAGMA table_info(users)").all() as { name: string, notnull: number }[]
		const emailCol = info.find((col) => col.name === "email")
		expect(emailCol).toBeDefined()
		expect(emailCol!.notnull).toBe(1)

		const indexes = db.prepare("PRAGMA index_list(users)").all() as { name: string, origin: string }[]
		const uniqueIndex = indexes.find((idx) => idx.origin === "u")
		expect(uniqueIndex).toBeDefined()

		db.close()
	})

	it("v2 迁移后 users 含 email_verified_at / oauth_provider / oauth_subject 字段", () => {
		const db = new Database(":memory:")
		migrate(db)

		const info = db.prepare("PRAGMA table_info(users)").all() as { name: string }[]
		const names = info.map((col) => col.name)
		expect(names).toContain("email_verified_at")
		expect(names).toContain("oauth_provider")
		expect(names).toContain("oauth_subject")

		db.close()
	})

	it("v2 迁移将存量 NULL email 填充为占位邮箱", () => {
		const db = new Database(":memory:")
		db.exec(`
			CREATE TABLE users (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				account TEXT NOT NULL UNIQUE,
				password_hash TEXT NOT NULL,
				name TEXT NOT NULL,
				email TEXT,
				role TEXT NOT NULL DEFAULT 'admin',
				status TEXT NOT NULL DEFAULT 'active',
				created_at TEXT NOT NULL DEFAULT (datetime('now')),
				updated_at TEXT NOT NULL DEFAULT (datetime('now')),
				last_login_at TEXT
			);
			CREATE TABLE settings (
				key TEXT PRIMARY KEY,
				value TEXT NOT NULL,
				updated_at TEXT NOT NULL DEFAULT (datetime('now'))
			);
			INSERT INTO users (account, password_hash, name) VALUES ('admin', 'hash', '管理员');
		`)
		migrate(db)

		const user = db.prepare("SELECT email FROM users WHERE account = 'admin'").get() as { email: string }
		expect(user.email).toBe("admin__legacy@local.invalid")

		db.close()
	})

	it("v3 迁移创建 email_verification_tokens 表与索引", () => {
		const db = new Database(":memory:")
		migrate(db)

		const indexes = db
			.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'email_verification_tokens'")
			.all() as { name: string }[]
		const indexNames = indexes.map((idx) => idx.name)
		expect(indexNames).toContain("idx_email_ver_tokens_token")
		expect(indexNames).toContain("idx_email_ver_tokens_user")

		db.close()
	})

	it("v6 迁移新增 AI 生成字段与 mastery_checks 表", () => {
		const db = new Database(":memory:")
		migrate(db)

		const cols = (table: string) =>
			(db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((col) => col.name)

		expect(cols("positions")).toEqual(
			expect.arrayContaining(["owner_user_id", "source", "status", "generated_at"]),
		)
		expect(cols("learning_resources")).toEqual(
			expect.arrayContaining(["content", "summary", "objectives", "source", "status", "generated_at", "model"]),
		)
		expect(cols("learning_paths")).toEqual(
			expect.arrayContaining(["generation_status", "model", "generated_at", "error_message"]),
		)
		expect(cols("learning_path_items")).toEqual(
			expect.arrayContaining(["item_type", "estimated_minutes"]),
		)
		expect(cols("mastery_checks")).toEqual(
			expect.arrayContaining(["questions", "answers", "score", "result_data", "status"]),
		)

		db.close()
	})
})
