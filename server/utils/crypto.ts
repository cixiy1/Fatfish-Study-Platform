import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "node:crypto"
import { readConfig } from "./app-config"

/**
 * 会话签名与对称加密工具（零依赖，基于 Node 内置 crypto）。
 *
 * - sign/verify：HMAC-SHA256 签名（会话载荷防篡改）
 * - encrypt/decrypt：AES-256-GCM 对称加密（SMTP 密码、OAuth Secret 加密存储）
 */

/** 对载荷做 HMAC-SHA256 签名，返回 base64url 字符串 */
export function sign(payload: string, secret: string): string {
	return createHmac("sha256", secret).update(payload).digest("base64url")
}

/** 校验签名是否匹配；定长比较防时序攻击 */
export function verify(payload: string, signature: string, secret: string): boolean {
	const expected = Buffer.from(sign(payload, secret))
	const actual = Buffer.from(signature)
	return expected.length === actual.length && timingSafeEqual(expected, actual)
}

/** base64url 编码（JSON → 字符串） */
export function encodePayload(data: unknown): string {
	return Buffer.from(JSON.stringify(data), "utf8").toString("base64url")
}

/** base64url 解码（字符串 → JSON）；失败返回 null */
export function decodePayload<T>(raw: string): T | null {
	try {
		return JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as T
	} catch {
		return null
	}
}

/* -------------------------------------------------------------------------- */
/* AES-256-GCM 对称加密                                                        */
/* -------------------------------------------------------------------------- */

const AES_ALGORITHM = "aes-256-gcm"
const IV_LENGTH = 12
const AUTH_TAG_LENGTH = 16
const ENCRYPT_PREFIX = "aes256gcm"

/** 获取加密密钥：复用 sessionSecret（截取/派生 32 字节用于 AES-256） */
function getEncryptionKey(): string {
	const secret = readConfig()?.security.sessionSecret
		?? process.env.FSP_SESSION_SECRET
		?? "fsp-dev-insecure-secret"
	// AES-256 需要 32 字节密钥；用 SHA256 派生确保长度正确且不泄露原 secret
	return createHmac("sha256", `encrypt:${secret}`).digest()
}

/**
 * 对称加密明文，返回 `aes256gcm$<iv-hex>$<authTag-hex>$<ciphertext-hex>` 格式字符串。
 * 空串输入返回空串（不加密空值）。
 */
export function encrypt(plaintext: string): string {
	if (!plaintext) return ""

	const key = getEncryptionKey()
	const iv = randomBytes(IV_LENGTH)
	const cipher = createCipheriv(AES_ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH })

	const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()])
	const authTag = cipher.getAuthTag()

	return `${ENCRYPT_PREFIX}$${iv.toString("hex")}$${authTag.toString("hex")}$${ciphertext.toString("hex")}`
}

/**
 * 解密 encrypt() 产生的密文。非加密串或解密失败返回空串。
 */
export function decrypt(stored: string): string {
	if (!stored || !stored.startsWith(`${ENCRYPT_PREFIX}$`)) return ""

	const parts = stored.split("$")
	if (parts.length !== 4) return ""

	const [, ivHex, authTagHex, ciphertextHex] = parts
	try {
		const key = getEncryptionKey()
		const iv = Buffer.from(ivHex, "hex")
		const authTag = Buffer.from(authTagHex, "hex")
		const ciphertext = Buffer.from(ciphertextHex, "hex")

		if (iv.length !== IV_LENGTH || authTag.length !== AUTH_TAG_LENGTH) return ""

		const decipher = createDecipheriv(AES_ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH })
		decipher.setAuthTag(authTag)

		const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()])
		return plaintext.toString("utf8")
	} catch {
		return ""
	}
}

/** 判断字符串是否为 encrypt() 产生的密文 */
export function isEncrypted(value: string): boolean {
	return !!value && value.startsWith(`${ENCRYPT_PREFIX}$`)
}
