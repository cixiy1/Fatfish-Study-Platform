import { getDb } from "../utils/db"

/**
 * 密码重置 token 数据访问层。
 */

export interface PasswordResetToken {
	id: number
	user_id: number
	token: string
	expires_at: string
	used_at: string | null
	created_at: string
}

export function createResetToken(userId: number, token: string, expiresAt: string): void {
	getDb()
		.prepare("INSERT INTO password_reset_tokens (user_id, token, expires_at) VALUES (?, ?, ?)")
		.run(userId, token, expiresAt)
}

export function findResetToken(token: string): PasswordResetToken | null {
	return (getDb().prepare("SELECT * FROM password_reset_tokens WHERE token = ?").get(token) as PasswordResetToken | undefined) ?? null
}

export function markResetTokenUsed(id: number): void {
	getDb().prepare("UPDATE password_reset_tokens SET used_at = datetime('now') WHERE id = ?").run(id)
}

export function cleanExpiredResetTokens(userId: number): void {
	getDb().prepare("DELETE FROM password_reset_tokens WHERE user_id = ? AND used_at IS NOT NULL OR expires_at < datetime('now')").run(userId)
}
