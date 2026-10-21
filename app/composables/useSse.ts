import { parseSseFrames } from "~/utils/sse-parse"

/**
 * SSE 客户端。
 *
 * 统一的流式请求与解析：
 * - 支持多行 data（旧实现只取第一行）
 * - 坏帧跳过而不是让整个流崩掉
 * - 超时从「整墙钟」改为 open（首字节）+ idle（帧间静默）双计时，
 *   长生成任务不会被固定超时误杀
 */

/** 事件处理器：键为事件名，值为接收已解析 data 的回调 */
// 各事件的 data 形状由服务端约定，调用方按事件名自己收窄，这里只能用 any 承接
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type SseHandlers = Record<string, ((data: any) => void) | undefined>

export interface ConsumeOptions {
	/** 首个字节到达前的最长等待（默认 15s）；覆盖服务不可用/未配置模型等场景 */
	openTimeoutMs?: number
	/** 两帧之间的最长静默（默认 180s）；服务端心跳会持续复位它 */
	idleTimeoutMs?: number
	/** 主动取消 */
	signal?: AbortSignal
}

const DEFAULT_OPEN_TIMEOUT_MS = 15_000
const DEFAULT_IDLE_TIMEOUT_MS = 180_000

/**
 * 消费一个 SSE 响应流。
 *
 * handlers 里未注册的事件名会被静默忽略；`error` 事件建议显式注册。
 */
export async function consumeSse(
	response: Response,
	handlers: SseHandlers,
	options: ConsumeOptions = {},
): Promise<void> {
	if (!response.ok) {
		// Nitro 的错误体里带 message，把它透出去前端才不是一句干巴巴的「请求失败: 400」
		let detail = ""
		try {
			const text = await response.text()
			try {
				const parsed = JSON.parse(text) as { message?: string, statusMessage?: string }
				detail = parsed.message || parsed.statusMessage || ""
			} catch {
				detail = text.slice(0, 200)
			}
		} catch {
			// 读不到就算了
		}
		// 把状态码挂在错误上：调用方要靠它区分「未配置大模型 503」和普通网络错误
		const error = new Error(detail ? `${detail}（HTTP ${response.status}）` : `请求失败: ${response.status}`)
		;(error as Error & { status?: number }).status = response.status
		throw error
	}	if (!response.body) {
		throw new Error("响应不支持流式读取")
	}

	const openTimeoutMs = options.openTimeoutMs ?? DEFAULT_OPEN_TIMEOUT_MS
	const idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS

	const reader = response.body.getReader()
	const decoder = new TextDecoder()
	let buffer = ""
	let received = false

	let idleReject: ((reason: Error) => void) | null = null
	let idleHandle: ReturnType<typeof setTimeout> | null = null

	/**
	 * 带超时地读一次。
	 *
	 * 首字节用 openTimeoutMs，之后每次读取用 idleTimeoutMs——
	 * 也就是说「自上次收到数据起」重新计时，服务端心跳会持续复位它，
	 * 长生成任务不会被固定墙钟误杀。
	 */
	const readOnce = async (): Promise<ReadableStreamReadResult<Uint8Array>> => {
		const ms = received ? idleTimeoutMs : openTimeoutMs
		const message = received
			? `流式响应超过 ${Math.round(idleTimeoutMs / 1000)}s 没有新数据`
			: "服务响应超时，请稍后重试"

		idleHandle = setTimeout(() => {
			idleReject?.(new Error(message))
		}, ms)

		const timeout = new Promise<never>((_, reject) => {
			idleReject = reject
		})

		try {
			return await Promise.race([reader.read(), timeout])
		} finally {
			if (idleHandle) {
				clearTimeout(idleHandle)
				idleHandle = null
			}
			idleReject = null
		}
	}

	try {
		while (true) {
			const { done, value } = await readOnce()
			if (done) break

			received = true
			buffer += decoder.decode(value, { stream: true })
			const { frames, rest } = parseSseFrames(buffer)
			buffer = rest

			for (const frame of frames) {
				const handler = handlers[frame.event]
				if (!handler) continue
				// 坏帧（data 为 null）退化为原始文本，由上层决定
				handler(frame.data ?? frame.raw)
			}
		}
	} finally {
		if (idleHandle) {
			clearTimeout(idleHandle)
			idleHandle = null
		}
		try {
			await reader.cancel()
		} catch {
			// 已读完或已断开
		}
		reader.releaseLock()
	}
}

/** 发一个 POST 并以 SSE 方式消费响应 */
export async function postSse(
	url: string,
	body: unknown,
	handlers: SseHandlers,
	options: ConsumeOptions = {},
): Promise<void> {
	const controller = new AbortController()
	const onAbort = () => controller.abort()
	options.signal?.addEventListener("abort", onAbort)

	try {
		const response = await fetch(url, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body ?? {}),
			signal: controller.signal,
		})
		await consumeSse(response, handlers, { ...options, signal: controller.signal })
	} finally {
		options.signal?.removeEventListener("abort", onAbort)
	}
}

export { parseSseFrames }
