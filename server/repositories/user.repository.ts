import type { OAuthProvider } from "#shared/types/auth"
import { getDb } from "../utils/db"

/**
 * 用户数据访问层。
 *
 * 所有 SQL 集中在此，便于替换实现与单元测试。
 */

export interface UserRecord {
	id: number
	account: string
	password_hash: string
	name: string
	email: string
	role: string
	status: string
	email_verified_at: string | null
	oauth_provider: string | null
	oauth_subject: string | null
	created_at: string
	updated_at: string
	last_login_at: string | null
}

export function findUserByAccount(account: string): UserRecord | null {
	const row = getDb().prepare("SELECT * FROM users WHERE account = ?").get(account)
	return (row as UserRecord | undefined) ?? null
}

export function findUserByEmail(email: string): UserRecord | null {
	const row = getDb().prepare("SELECT * FROM users WHERE email = ?").get(email)
	return (row as UserRecord | undefined) ?? null
}

export function findUserById(id: number): UserRecord | null {
	const row = getDb().prepare("SELECT * FROM users WHERE id = ?").get(id)
	return (row as UserRecord | undefined) ?? null
}

/** 按 OAuth 提供方与主体标识查找用户（用于 OAuth 回调匹配） */
export function findUserByOauth(provider: OAuthProvider, subject: string): UserRecord | null {
	const row = getDb()
		.prepare("SELECT * FROM users WHERE oauth_provider = ? AND oauth_subject = ?")
		.get(provider, subject)
	return (row as UserRecord | undefined) ?? null
}

/** 创建注册用户（status 默认 pending，需邮件验证后激活） */
export function createUser(input: {
	account: string
	passwordHash: string
	name: string
	email: string
	role?: string
	status?: string
}): UserRecord {
	const info = getDb()
		.prepare(
			`INSERT INTO users (account, password_hash, name, email, role, status)
			 VALUES (@account, @passwordHash, @name, @email, @role, @status)`,
		)
		.run({
			account: input.account,
			passwordHash: input.passwordHash,
			name: input.name,
			email: input.email,
			role: input.role ?? "user",
			status: input.status ?? "pending",
		})

	return findUserById(Number(info.lastInsertRowid)) as UserRecord
}

/** 创建 OAuth 用户（status=active，无需邮件验证） */
export function createOAuthUser(input: {
	provider: OAuthProvider
	subject: string
	account: string
	name: string
	email: string
}): UserRecord {
	const info = getDb()
		.prepare(
			`INSERT INTO users (account, password_hash, name, email, role, status, email_verified_at, oauth_provider, oauth_subject)
			 VALUES (@account, '', @name, @email, 'user', 'active', datetime('now'), @provider, @subject)`,
		)
		.run({
			account: input.account,
			name: input.name,
			email: input.email,
			provider: input.provider,
			subject: input.subject,
		})

	return findUserById(Number(info.lastInsertRowid)) as UserRecord
}

/** 激活用户（status → active） */
export function activateUser(id: number): void {
	getDb()
		.prepare("UPDATE users SET status = 'active', updated_at = datetime('now') WHERE id = ?")
		.run(id)
}

/** 设置邮箱验证时间 */
export function setEmailVerifiedAt(id: number): void {
	getDb()
		.prepare("UPDATE users SET email_verified_at = datetime('now'), updated_at = datetime('now') WHERE id = ?")
		.run(id)
}

export function touchLastLogin(id: number): void {
	getDb().prepare("UPDATE users SET last_login_at = datetime('now') WHERE id = ?").run(id)
}

export function countUsers(): number {
	const row = getDb().prepare("SELECT COUNT(*) AS count FROM users").get() as { count: number }
	return row.count
}

/** 分页查询所有用户（按创建时间倒序） */
export function findAllUsers(limit = 100, offset = 0): UserRecord[] {
	return getDb()
		.prepare("SELECT * FROM users ORDER BY created_at DESC LIMIT ? OFFSET ?")
		.all(limit, offset) as UserRecord[]
}

/** 更新用户状态 */
export function updateUserStatus(id: number, status: string): void {
	getDb()
		.prepare("UPDATE users SET status = ?, updated_at = datetime('now') WHERE id = ?")
		.run(status, id)
}

/** 更新用户密码 */
export function updateUserPassword(id: number, passwordHash: string): void {
	getDb()
		.prepare("UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?")
		.run(passwordHash, id)
}
