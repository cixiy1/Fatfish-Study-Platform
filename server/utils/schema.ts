import type { Database } from "better-sqlite3"

/**
 * 数据库表结构与幂等迁移。
 *
 * 采用「手写幂等 SQL + schema_migrations 版本表」方案（零依赖），
 * 每次启动调用 migrate() 即可把库升级到最新版本，重复执行安全。
 */

interface Migration {
	version: number
	name: string
	sql: string
}

const MIGRATIONS: Migration[] = [
	{
		version: 1,
		name: "create_users_and_settings",
		sql: `
			CREATE TABLE IF NOT EXISTS users (
				id            INTEGER PRIMARY KEY AUTOINCREMENT,
				account       TEXT    NOT NULL UNIQUE,
				password_hash TEXT    NOT NULL,
				name          TEXT    NOT NULL,
				email         TEXT,
				role          TEXT    NOT NULL DEFAULT 'admin',
				status        TEXT    NOT NULL DEFAULT 'active',
				created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
				updated_at    TEXT    NOT NULL DEFAULT (datetime('now')),
				last_login_at TEXT
			);

			CREATE TABLE IF NOT EXISTS settings (
				key        TEXT PRIMARY KEY,
				value      TEXT NOT NULL,
				updated_at TEXT NOT NULL DEFAULT (datetime('now'))
			);
		`,
	},
	{
		version: 2,
		name: "users_rebuild_with_email_oauth_fields",
		sql: `
			UPDATE users
			SET email = account || '__legacy@local.invalid'
			WHERE email IS NULL;

			CREATE TABLE users_v2 (
				id                INTEGER PRIMARY KEY AUTOINCREMENT,
				account           TEXT    NOT NULL UNIQUE,
				password_hash     TEXT    NOT NULL,
				name              TEXT    NOT NULL,
				email             TEXT    NOT NULL UNIQUE,
				role              TEXT    NOT NULL DEFAULT 'admin',
				status            TEXT    NOT NULL DEFAULT 'active',
				email_verified_at TEXT,
				oauth_provider    TEXT,
				oauth_subject     TEXT,
				created_at        TEXT    NOT NULL DEFAULT (datetime('now')),
				updated_at        TEXT    NOT NULL DEFAULT (datetime('now')),
				last_login_at     TEXT
			);

			INSERT INTO users_v2 (id, account, password_hash, name, email, role, status, created_at, updated_at, last_login_at)
			SELECT id, account, password_hash, name, email, role, status, created_at, updated_at, last_login_at
			FROM users;

			DROP TABLE users;
			ALTER TABLE users_v2 RENAME TO users;
		`,
	},
	{
		version: 3,
		name: "create_email_verification_tokens",
		sql: `
			CREATE TABLE IF NOT EXISTS email_verification_tokens (
				id         INTEGER PRIMARY KEY AUTOINCREMENT,
				user_id    INTEGER NOT NULL,
				token      TEXT    NOT NULL UNIQUE,
				expires_at TEXT    NOT NULL,
				used_at    TEXT,
				created_at TEXT    NOT NULL DEFAULT (datetime('now')),
				FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
			);

			CREATE INDEX IF NOT EXISTS idx_email_ver_tokens_token ON email_verification_tokens(token);
			CREATE INDEX IF NOT EXISTS idx_email_ver_tokens_user ON email_verification_tokens(user_id);
		`,
	},
	{
		version: 4,
		name: "create_learning_platform_tables",
		sql: `
			CREATE TABLE IF NOT EXISTS user_profiles (
				user_id              INTEGER PRIMARY KEY,
				age                  INTEGER,
				education            TEXT,
				profession           TEXT,
				experience_years     INTEGER,
				learning_goal        TEXT,
				career_direction     TEXT,
				assessment_completed INTEGER  NOT NULL DEFAULT 0,
				profile_data         TEXT,
				created_at           TEXT   NOT NULL DEFAULT (datetime('now')),
				updated_at           TEXT   NOT NULL DEFAULT (datetime('now')),
				FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
			);

			CREATE TABLE IF NOT EXISTS positions (
				id          INTEGER PRIMARY KEY AUTOINCREMENT,
				name        TEXT    NOT NULL,
				category    TEXT    NOT NULL,
				description TEXT,
				icon        TEXT,
				created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
			);

			CREATE TABLE IF NOT EXISTS skills (
				id          INTEGER PRIMARY KEY AUTOINCREMENT,
				name        TEXT    NOT NULL,
				category    TEXT    NOT NULL,
				parent_id   INTEGER,
				level       INTEGER NOT NULL DEFAULT 0,
				description TEXT,
				created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
				FOREIGN KEY (parent_id) REFERENCES skills(id) ON DELETE CASCADE
			);

			CREATE TABLE IF NOT EXISTS position_skills (
				position_id    INTEGER NOT NULL,
				skill_id       INTEGER NOT NULL,
				required_level INTEGER NOT NULL DEFAULT 1,
				PRIMARY KEY (position_id, skill_id),
				FOREIGN KEY (position_id) REFERENCES positions(id) ON DELETE CASCADE,
				FOREIGN KEY (skill_id) REFERENCES skills(id) ON DELETE CASCADE
			);

			CREATE TABLE IF NOT EXISTS user_skills (
				user_id             INTEGER NOT NULL,
				skill_id            INTEGER NOT NULL,
				status              TEXT    NOT NULL DEFAULT 'not_started',
				self_assessed_level INTEGER NOT NULL DEFAULT 0,
				updated_at          TEXT    NOT NULL DEFAULT (datetime('now')),
				PRIMARY KEY (user_id, skill_id),
				FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
				FOREIGN KEY (skill_id) REFERENCES skills(id) ON DELETE CASCADE
			);

			CREATE TABLE IF NOT EXISTS assessments (
				id          INTEGER PRIMARY KEY AUTOINCREMENT,
				type        TEXT    NOT NULL,
				title       TEXT    NOT NULL,
				description TEXT,
				created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
			);

			CREATE TABLE IF NOT EXISTS assessment_questions (
				id            INTEGER PRIMARY KEY AUTOINCREMENT,
				assessment_id INTEGER NOT NULL,
				question      TEXT    NOT NULL,
				options       TEXT    NOT NULL,
				correct_index INTEGER,
				category      TEXT,
				sort_order    INTEGER NOT NULL DEFAULT 0,
				FOREIGN KEY (assessment_id) REFERENCES assessments(id) ON DELETE CASCADE
			);

			CREATE TABLE IF NOT EXISTS assessment_records (
				id            INTEGER PRIMARY KEY AUTOINCREMENT,
				user_id       INTEGER NOT NULL,
				assessment_id INTEGER NOT NULL,
				answers       TEXT    NOT NULL,
				score         INTEGER NOT NULL DEFAULT 0,
				result_data   TEXT,
				created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
				FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
				FOREIGN KEY (assessment_id) REFERENCES assessments(id) ON DELETE CASCADE
			);

			CREATE TABLE IF NOT EXISTS learning_resources (
				id          INTEGER PRIMARY KEY AUTOINCREMENT,
				title       TEXT    NOT NULL,
				type        TEXT    NOT NULL DEFAULT 'article',
				url         TEXT,
				skill_id    INTEGER,
				difficulty  TEXT    NOT NULL DEFAULT 'beginner',
				description TEXT,
				duration    INTEGER,
				created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
				FOREIGN KEY (skill_id) REFERENCES skills(id) ON DELETE SET NULL
			);

			CREATE TABLE IF NOT EXISTS learning_paths (
				id                INTEGER PRIMARY KEY AUTOINCREMENT,
				user_id           INTEGER NOT NULL,
				name              TEXT    NOT NULL,
				target_position_id INTEGER,
				status            TEXT    NOT NULL DEFAULT 'active',
				created_at        TEXT    NOT NULL DEFAULT (datetime('now')),
				updated_at        TEXT    NOT NULL DEFAULT (datetime('now')),
				FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
				FOREIGN KEY (target_position_id) REFERENCES positions(id) ON DELETE SET NULL
			);

			CREATE TABLE IF NOT EXISTS learning_path_items (
				id           INTEGER PRIMARY KEY AUTOINCREMENT,
				path_id      INTEGER NOT NULL,
				skill_id     INTEGER,
				resource_id  INTEGER,
				sort_order   INTEGER NOT NULL DEFAULT 0,
				status       TEXT    NOT NULL DEFAULT 'pending',
				started_at   TEXT,
				completed_at TEXT,
				FOREIGN KEY (path_id) REFERENCES learning_paths(id) ON DELETE CASCADE,
				FOREIGN KEY (skill_id) REFERENCES skills(id) ON DELETE SET NULL,
				FOREIGN KEY (resource_id) REFERENCES learning_resources(id) ON DELETE SET NULL
			);

			CREATE TABLE IF NOT EXISTS learning_records (
				id           INTEGER PRIMARY KEY AUTOINCREMENT,
				user_id      INTEGER NOT NULL,
				resource_id  INTEGER,
				path_item_id INTEGER,
				status       TEXT    NOT NULL DEFAULT 'in_progress',
				progress     INTEGER NOT NULL DEFAULT 0,
				time_spent   INTEGER NOT NULL DEFAULT 0,
				created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
				updated_at   TEXT    NOT NULL DEFAULT (datetime('now')),
				FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
				FOREIGN KEY (resource_id) REFERENCES learning_resources(id) ON DELETE SET NULL,
				FOREIGN KEY (path_item_id) REFERENCES learning_path_items(id) ON DELETE SET NULL
			);

			CREATE TABLE IF NOT EXISTS qa_records (
				id         INTEGER PRIMARY KEY AUTOINCREMENT,
				user_id    INTEGER NOT NULL,
				question   TEXT    NOT NULL,
				answer     TEXT,
				context    TEXT,
				created_at TEXT    NOT NULL DEFAULT (datetime('now')),
				FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
			);

			CREATE TABLE IF NOT EXISTS learning_reports (
				id           INTEGER PRIMARY KEY AUTOINCREMENT,
				user_id      INTEGER NOT NULL,
				type         TEXT    NOT NULL,
				period_start TEXT,
				period_end   TEXT,
				summary      TEXT,
				created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
				FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
			);

			CREATE INDEX IF NOT EXISTS idx_user_skills_user ON user_skills(user_id);
			CREATE INDEX IF NOT EXISTS idx_assessment_records_user ON assessment_records(user_id);
			CREATE INDEX IF NOT EXISTS idx_learning_paths_user ON learning_paths(user_id);
			CREATE INDEX IF NOT EXISTS idx_learning_records_user ON learning_records(user_id);
			CREATE INDEX IF NOT EXISTS idx_qa_records_user ON qa_records(user_id);
			CREATE INDEX IF NOT EXISTS idx_learning_reports_user ON learning_reports(user_id);
		`,
	},
	{
		version: 5,
		name: "create_password_reset_tokens",
		sql: `
			CREATE TABLE IF NOT EXISTS password_reset_tokens (
				id         INTEGER PRIMARY KEY AUTOINCREMENT,
				user_id    INTEGER NOT NULL,
				token      TEXT    NOT NULL UNIQUE,
				expires_at TEXT    NOT NULL,
				used_at    TEXT,
				created_at TEXT    NOT NULL DEFAULT (datetime('now')),
				FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
			);

			CREATE INDEX IF NOT EXISTS idx_pwd_reset_token ON password_reset_tokens(token);
			CREATE INDEX IF NOT EXISTS idx_pwd_reset_user ON password_reset_tokens(user_id);
		`,
	},
	{
		version: 6,
		name: "add_ai_generation_fields",
		sql: `
			-- 岗位：区分种子岗位与 AI 按需生成的方向
			ALTER TABLE positions ADD COLUMN owner_user_id INTEGER REFERENCES users(id) ON DELETE CASCADE;
			ALTER TABLE positions ADD COLUMN source TEXT NOT NULL DEFAULT 'seed';
			ALTER TABLE positions ADD COLUMN status TEXT NOT NULL DEFAULT 'active';
			ALTER TABLE positions ADD COLUMN generated_at TEXT;

			-- 岗位技能：AI 方向需要保留模型给出的学习顺序
			ALTER TABLE position_skills ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;

			-- 学习资源：补正文与生成来源
			ALTER TABLE learning_resources ADD COLUMN content TEXT;
			ALTER TABLE learning_resources ADD COLUMN summary TEXT;
			ALTER TABLE learning_resources ADD COLUMN objectives TEXT;
			ALTER TABLE learning_resources ADD COLUMN source TEXT NOT NULL DEFAULT 'seed';
			ALTER TABLE learning_resources ADD COLUMN status TEXT NOT NULL DEFAULT 'external';
			ALTER TABLE learning_resources ADD COLUMN generated_at TEXT;
			ALTER TABLE learning_resources ADD COLUMN model TEXT;

			-- 学习路径：同步生成状态
			ALTER TABLE learning_paths ADD COLUMN generation_status TEXT NOT NULL DEFAULT 'ready';
			ALTER TABLE learning_paths ADD COLUMN model TEXT;
			ALTER TABLE learning_paths ADD COLUMN generated_at TEXT;
			ALTER TABLE learning_paths ADD COLUMN error_message TEXT;

			-- 关卡：类型与预估时长
			ALTER TABLE learning_path_items ADD COLUMN item_type TEXT NOT NULL DEFAULT 'lesson';
			ALTER TABLE learning_path_items ADD COLUMN estimated_minutes INTEGER;

			-- 存量资源没有正文，按有无外链标注
			UPDATE learning_resources
			SET status = CASE WHEN url IS NOT NULL AND url <> '' THEN 'external' ELSE 'fallback' END;

			-- 存量关卡同步类型
			UPDATE learning_path_items
			SET item_type = CASE WHEN resource_id IS NULL THEN 'none' ELSE 'external' END;

			CREATE INDEX IF NOT EXISTS idx_positions_owner_status ON positions(owner_user_id, status);
			CREATE INDEX IF NOT EXISTS idx_positions_name ON positions(name);
			CREATE INDEX IF NOT EXISTS idx_resources_skill_status ON learning_resources(skill_id, status);
			CREATE INDEX IF NOT EXISTS idx_paths_user_position ON learning_paths(user_id, target_position_id);
			CREATE INDEX IF NOT EXISTS idx_path_items_path_order ON learning_path_items(path_id, sort_order);

			-- 阶段测评：模型出的题 + 待用户接受的评分
			CREATE TABLE IF NOT EXISTS mastery_checks (
				id          INTEGER PRIMARY KEY AUTOINCREMENT,
				user_id     INTEGER NOT NULL,
				path_id     INTEGER NOT NULL,
				skill_ids   TEXT    NOT NULL DEFAULT '[]',
				questions   TEXT    NOT NULL,
				answers     TEXT,
				score       INTEGER,
				result_data TEXT,
				status      TEXT    NOT NULL DEFAULT 'ready',
				model       TEXT,
				mock        INTEGER NOT NULL DEFAULT 0,
				created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
				scored_at   TEXT,
				accepted_at TEXT,
				FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
				FOREIGN KEY (path_id) REFERENCES learning_paths(id) ON DELETE CASCADE
			);

			CREATE INDEX IF NOT EXISTS idx_mastery_user ON mastery_checks(user_id, created_at DESC);
			CREATE INDEX IF NOT EXISTS idx_mastery_path ON mastery_checks(path_id);
		`,
	},
]

/** 幂等执行所有未应用的迁移 */
export function migrate(db: Database): void {
	db.exec(`
		CREATE TABLE IF NOT EXISTS schema_migrations (
			version    INTEGER PRIMARY KEY,
			name       TEXT NOT NULL,
			applied_at TEXT NOT NULL DEFAULT (datetime('now'))
		)
	`)

	const rows = db.prepare("SELECT version FROM schema_migrations").all() as { version: number }[]
	const applied = new Set(rows.map((row) => row.version))
	const record = db.prepare("INSERT INTO schema_migrations (version, name) VALUES (?, ?)")

	for (const migration of MIGRATIONS) {
		if (applied.has(migration.version)) continue

		const run = db.transaction(() => {
			db.exec(migration.sql)
			record.run(migration.version, migration.name)
		})
		run()
	}
}

/** 当前已应用的最高迁移版本 */
export function currentVersion(db: Database): number {
	const row = db.prepare("SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations").get() as {
		version: number
	}
	return row.version
}
