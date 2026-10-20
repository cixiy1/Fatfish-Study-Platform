/**
 * LLM 响应的纯函数工具：JSON 抽取、字段校验、重试判定。
 *
 * 单独成文件是为了让单元测试不必接触数据库与网络。
 */

/** 模型输出不符合约定格式 */
export class LlmFormatError extends Error {
	constructor(message: string) {
		super(message)
		this.name = "LlmFormatError"
	}
}

/** 可重试的 HTTP 状态码（429 限流、5xx 服务端问题） */
const RETRYABLE_STATUS = new Set([408, 409, 425, 429, 500, 502, 503, 504, 529])

/** 超时、连接失败、限流与服务端错误可重试；4xx 参数/鉴权问题不重试 */
export function isRetryableError(error: unknown): boolean {
	const e = error as {
		statusCode?: number
		status?: number
		name?: string
		cause?: { name?: string, code?: string }
	}

	const status = e?.statusCode ?? e?.status
	if (typeof status === "number") return RETRYABLE_STATUS.has(status)

	const name = e?.name ?? e?.cause?.name
	return name === "TimeoutError"
		|| name === "AbortError"
		|| name === "FetchError"
		|| e?.cause?.code === "ECONNRESET"
		|| e?.cause?.code === "ETIMEDOUT"
}

/** 指数退避 + 抖动，上限 3 秒 */
export function backoffMs(attempt: number): number {
	return Math.min(400 * 2 ** attempt, 3000) + Math.floor(Math.random() * 200)
}

/**
 * 从模型输出里抽 JSON。
 *
 * 模型经常在 JSON 前后加解释或 Markdown 围栏，不能直接 JSON.parse 整段。
 */
export function extractJson(text: string): unknown {
	const source = text ?? ""
	const fenced = source.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1] ?? source
	const start = fenced.indexOf("{")
	const end = fenced.lastIndexOf("}")

	if (start < 0 || end <= start) {
		throw new LlmFormatError("响应中没有 JSON 对象")
	}

	try {
		return JSON.parse(fenced.slice(start, end + 1)) as unknown
	} catch {
		throw new LlmFormatError("JSON 解析失败")
	}
}

/* -------------------------------------------------------------------------- */
/* 字段校验（手写，不引 zod）                                                   */
/* -------------------------------------------------------------------------- */

export function asRecord(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new LlmFormatError("结果不是对象")
	}
	return value as Record<string, unknown>
}

/** 取字符串并校验长度（trim 后） */
export function str(value: unknown, min: number, max: number, field = "字段"): string {
	if (typeof value !== "string") throw new LlmFormatError(`${field} 不是字符串`)
	const trimmed = value.trim()
	if (trimmed.length < min) throw new LlmFormatError(`${field} 过短`)
	return trimmed.length > max ? trimmed.slice(0, max) : trimmed
}

/** 取字符串数组，去重、去空、限制条数 */
export function strArray(value: unknown, min: number, max: number, maxLength = 200, field = "字段"): string[] {
	if (!Array.isArray(value)) throw new LlmFormatError(`${field} 不是数组`)
	const list = [...new Set(
		value
			.filter((item): item is string => typeof item === "string")
			.map((item) => item.trim())
			.filter((item) => item.length > 0)
			.map((item) => (item.length > maxLength ? item.slice(0, maxLength) : item)),
	)]

	if (list.length < min) throw new LlmFormatError(`${field} 数量不足`)
	return list.slice(0, max)
}

/** 取整数并夹到区间内 */
export function clampInt(value: unknown, min: number, max: number, fallback: number): number {
	const num = Number(value)
	if (!Number.isFinite(num)) return fallback
	return Math.min(max, Math.max(min, Math.round(num)))
}

/** 取枚举值，非法时返回 fallback */
export function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
	return typeof value === "string" && (allowed as readonly string[]).includes(value)
		? (value as T)
		: fallback
}
