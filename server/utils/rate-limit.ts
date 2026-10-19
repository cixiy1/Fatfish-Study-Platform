/**
 * 进程内限流（零依赖，单实例生效）。
 *
 * 基于 Map<key, timestamps[]> 的滑动窗口计数。
 * 适用于注册防刷等场景；多实例部署时仅各自生效（可接受，复杂限流留后续）。
 */

const store = new Map<string, number[]>()

/**
 * 检查是否允许请求。
 * @param key 限流标识（如客户端 IP）
 * @param limit 窗口内最大允许次数
 * @param windowMs 窗口大小（毫秒）
 * @returns true 表示允许，false 表示超限
 */
export function checkRateLimit(key: string, limit = 5, windowMs = 60_000): boolean {
	const now = Date.now()
	const timestamps = store.get(key) ?? []
	const valid = timestamps.filter((t) => now - t < windowMs)

	if (valid.length >= limit) {
		store.set(key, valid)
		return false
	}

	valid.push(now)
	store.set(key, valid)
	return true
}

/** 获取某 key 剩余可用次数（诊断用） */
export function remainingQuota(key: string, limit = 5, windowMs = 60_000): number {
	const now = Date.now()
	const timestamps = store.get(key) ?? []
	const valid = timestamps.filter((t) => now - t < windowMs)
	return Math.max(0, limit - valid.length)
}

/** 清空所有限流记录（测试用） */
export function resetRateLimit(): void {
	store.clear()
}
