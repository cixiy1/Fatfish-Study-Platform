import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto"

/**
 * 密码哈希（零依赖，基于 Node 内置 crypto.scrypt）。
 *
 * 存储格式：`scrypt$<salt-hex>$<hash-hex>`。
 * scrypt 为内存硬算法，抗暴力破解能力优于 PBKDF2，且无需编译原生模块。
 */

const KEY_LENGTH = 64
const SALT_LENGTH = 16

export function hashPassword(password: string): string {
	const salt = randomBytes(SALT_LENGTH)
	const hash = scryptSync(password, salt, KEY_LENGTH)
	return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`
}

/** 校验明文密码与存储哈希是否匹配；定长比较防时序攻击 */
export function verifyPassword(password: string, stored: string): boolean {
	if (!stored) return false

	const [scheme, saltHex, hashHex] = stored.split("$")
	if (scheme !== "scrypt" || !saltHex || !hashHex) return false

	try {
		const salt = Buffer.from(saltHex, "hex")
		const expected = Buffer.from(hashHex, "hex")
		// 非合法 hex 会被解析为空 buffer，必须显式拒绝，否则空哈希会误判为匹配
		if (salt.length === 0 || expected.length === 0) return false

		const actual = scryptSync(password, salt, expected.length)
		return expected.length === actual.length && timingSafeEqual(expected, actual)
	} catch {
		return false
	}
}

/** 生成随机密钥（用于会话签名），返回 hex 字符串 */
export function generateSecret(bytes = 32): string {
	return randomBytes(bytes).toString("hex")
}
