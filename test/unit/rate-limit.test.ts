import { afterEach, describe, expect, it } from "vitest"
import { checkRateLimit, remainingQuota, resetRateLimit } from "../../server/utils/rate-limit"

describe("rate-limit", () => {
	afterEach(() => {
		resetRateLimit()
	})

	it("首次请求允许通过", () => {
		expect(checkRateLimit("ip1", 5, 60_000)).toBe(true)
	})

	it("未超阈值时持续允许", () => {
		for (let i = 0; i < 4; i++) {
			expect(checkRateLimit("ip2", 5, 60_000)).toBe(true)
		}
	})

	it("达到阈值后拒绝", () => {
		for (let i = 0; i < 5; i++) {
			expect(checkRateLimit("ip3", 5, 60_000)).toBe(true)
		}
		expect(checkRateLimit("ip3", 5, 60_000)).toBe(false)
	})

	it("不同 key 独立计数", () => {
		for (let i = 0; i < 5; i++) {
			checkRateLimit("ip-a", 5, 60_000)
		}
		expect(checkRateLimit("ip-a", 5, 60_000)).toBe(false)
		expect(checkRateLimit("ip-b", 5, 60_000)).toBe(true)
	})

	it("remainingQuota 正确反映剩余次数", () => {
		expect(remainingQuota("ip4", 5, 60_000)).toBe(5)
		checkRateLimit("ip4", 5, 60_000)
		expect(remainingQuota("ip4", 5, 60_000)).toBe(4)
		checkRateLimit("ip4", 5, 60_000)
		expect(remainingQuota("ip4", 5, 60_000)).toBe(3)
	})

	it("窗口过期后重新允许", () => {
		const windowMs = 10
		for (let i = 0; i < 5; i++) {
			checkRateLimit("ip5", 5, windowMs)
		}
		expect(checkRateLimit("ip5", 5, windowMs)).toBe(false)
		// 等待窗口过期
		return new Promise<void>((resolve) => {
			setTimeout(() => {
				expect(checkRateLimit("ip5", 5, windowMs)).toBe(true)
				resolve()
			}, 15)
		})
	})
})
