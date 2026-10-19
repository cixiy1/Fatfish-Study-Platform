import { describe, expect, it } from "vitest"
import { decodePayload, decrypt, encrypt, encodePayload, isEncrypted, sign, verify } from "../../server/utils/crypto"

describe("crypto", () => {
	const secret = "test-secret"

	it("签名可被验签通过", () => {
		const signature = sign("hello", secret)
		expect(verify("hello", signature, secret)).toBe(true)
	})

	it("篡改载荷导致验签失败", () => {
		const signature = sign("hello", secret)
		expect(verify("hello2", signature, secret)).toBe(false)
	})

	it("错误密钥导致验签失败", () => {
		const signature = sign("hello", secret)
		expect(verify("hello", signature, "other-secret")).toBe(false)
	})

	it("encode/decode 往返一致", () => {
		const data = { account: "admin", name: "管理员" }
		expect(decodePayload(encodePayload(data))).toEqual(data)
	})

	it("decode 非法输入返回 null", () => {
		expect(decodePayload("!!!not-json!!!")).toBeNull()
	})
})

describe("crypto encrypt/decrypt (AES-256-GCM)", () => {
	it("加密后可正确解密", () => {
		const plaintext = "my-smtp-password-123"
		const ciphertext = encrypt(plaintext)
		expect(ciphertext).not.toBe(plaintext)
		expect(decrypt(ciphertext)).toBe(plaintext)
	})

	it("加密结果以 aes256gcm$ 前缀", () => {
		const ciphertext = encrypt("test")
		expect(ciphertext.startsWith("aes256gcm$")).toBe(true)
		expect(isEncrypted(ciphertext)).toBe(true)
	})

	it("空串输入返回空串", () => {
		expect(encrypt("")).toBe("")
		expect(decrypt("")).toBe("")
	})

	it("不同明文产生不同密文", () => {
		const c1 = encrypt("password1")
		const c2 = encrypt("password2")
		expect(c1).not.toBe(c2)
	})

	it("相同明文两次加密产生不同密文（随机 IV）", () => {
		const c1 = encrypt("same-password")
		const c2 = encrypt("same-password")
		expect(c1).not.toBe(c2)
		expect(decrypt(c1)).toBe("same-password")
		expect(decrypt(c2)).toBe("same-password")
	})

	it("解密非法密文返回空串", () => {
		expect(decrypt("aes256gcm$invalid$data$here")).toBe("")
		expect(decrypt("not-encrypted")).toBe("")
		expect(decrypt("aes256gcm$")).toBe("")
	})

	it("中文内容加解密往返一致", () => {
		const plaintext = "密码密码🔑"
		expect(decrypt(encrypt(plaintext))).toBe(plaintext)
	})

	it("isEncrypted 正确识别加密串", () => {
		expect(isEncrypted(encrypt("test"))).toBe(true)
		expect(isEncrypted("plain-text")).toBe(false)
		expect(isEncrypted("")).toBe(false)
	})
})
