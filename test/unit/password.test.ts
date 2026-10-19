import { describe, expect, it } from "vitest"
import { generateSecret, hashPassword, verifyPassword } from "../../server/utils/password"

describe("password", () => {
	it("哈希后可校验通过", () => {
		const hash = hashPassword("Abcd1234")
		expect(hash.startsWith("scrypt$")).toBe(true)
		expect(verifyPassword("Abcd1234", hash)).toBe(true)
	})

	it("错误密码校验失败", () => {
		const hash = hashPassword("Abcd1234")
		expect(verifyPassword("wrong-pass", hash)).toBe(false)
	})

	it("同一密码两次哈希结果不同（加盐随机）", () => {
		expect(hashPassword("Abcd1234")).not.toBe(hashPassword("Abcd1234"))
	})

	it("非法或空哈希返回 false", () => {
		expect(verifyPassword("x", "")).toBe(false)
		expect(verifyPassword("x", "plain")).toBe(false)
		expect(verifyPassword("x", "scrypt$zz$zz")).toBe(false)
	})

	it("generateSecret 返回 64 位 hex", () => {
		const secret = generateSecret()
		expect(secret).toMatch(/^[0-9a-f]{64}$/)
	})
})
