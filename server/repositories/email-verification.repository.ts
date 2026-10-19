import { getDb } from "../utils/db"

/**
 * 邮件验证 token 数据访问层。
 */

export interface EmailVerificationTokenRecord {
	id: number
	user_id: number
	token: string
	expires_at: string
	used_at: string | null
	created_at: string
}

/** 创建验证 token */
export function createToken(input: {
	userId: number
	token: string
	expiresAt: string
}): EmailVerificationTokenRecord {
	const info = getDb()
		.prepare(
			`INSERT INTO email_verification_tokens (user_id, token, expires_at)
			 VALUES (@userId, @token, @expiresAt)`,
		)
		.run({
			userId: input.userId,
			token: input.token,
			expiresAt: input.expiresAt,
		})

	return findTokenById(Number(info.lastInsertRowid)) as EmailVerificationTokenRecord
}

/** 按 token 查找（用于验证链接） */
export function findToken(token: string): EmailVerificationTokenRecord | null {
	const row = getDb()
		.prepare("SELECT * FROM email_verification_tokens WHERE token = ?")
		.get(token) as EmailVerificationTokenRecord | undefined
	return row ?? null
}

/** 按 id 查找 */
export function findTokenById(id: number): EmailVerificationTokenRecord | null {
	const row = getDb()
		.prepare("SELECT * FROM email_verification_tokens WHERE id = ?")
		.get(id) as EmailVerificationTokenRecord | undefined
	return row ?? null
}

/** 标记 token 已使用 */
export function markUsed(id: number): void {
	getDb()
		.prepare("UPDATE email_verification_tokens SET used_at = datetime('now') WHERE id = ?")
		.run(id)
}

/** 清理某用户的所有过期未使用 token */
export function cleanExpiredByUser(userId: number): void {
	getDb()
		.prepare(
			`DELETE FROM email_verification_tokens
			 WHERE user_id = ? AND used_at IS NULL AND expires_at < datetime('now')`,
		)
		.run(userId)
}
