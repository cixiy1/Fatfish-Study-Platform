/**
 * SSE（Server-Sent Events）会话封装。
 *
 * 统一处理流式响应的头、心跳、断连与写保护，避免每个端点各写一遍
 * （此前 sseWrite 在 3 个端点里复制粘贴，且都缺反代缓冲头和断连处理）。
 */

/** 心跳间隔（毫秒）：既防反代超时断连，也让前端确认连接仍活着 */
const DEFAULT_HEARTBEAT_MS = 15_000

export interface SseSession {
	/** 发一个事件；连接已断开或已结束时静默丢弃 */
	write(event: string, data: unknown): void
	/** 结束流（幂等）：清心跳、end 响应 */
	close(): void
	/** 客户端是否已断开 */
	readonly closed: boolean
	/** 断连信号，透传给 chatStream 等长任务，让上游请求真的中止 */
	readonly signal: AbortSignal
}

/** 把事件序列化成 SSE 帧（纯函数，便于单测） */
export function formatSseFrame(event: string, data: unknown): string {
	return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}

/** 纯注释帧：心跳与首帧 flush 用，前端解析时应忽略 */
function commentFrame(comment: string): string {
	return `: ${comment}\n\n`
}

/**
 * 开启一个 SSE 会话。
 *
 * 注意：调用后 HTTP 状态码即已确定，**不能再抛 createError**，
 * 所有异常必须翻译成 `error` 事件，并在 finally 里无条件 close()。
 */
export function openSse(event: H3Event, options: { heartbeatMs?: number } = {}): SseSession {
	const res = event.node.res
	const req = event.node.req

	setResponseHeader(event, "Content-Type", "text/event-stream; charset=utf-8")
	setResponseHeader(event, "Cache-Control", "no-cache, no-transform")
	setResponseHeader(event, "Connection", "keep-alive")
	// Nginx 等反向代理默认会缓冲响应，不加这行流式会退化成「一次性返回」
	setResponseHeader(event, "X-Accel-Buffering", "no")

	const controller = new AbortController()
	const heartbeatMs = options.heartbeatMs ?? DEFAULT_HEARTBEAT_MS
	let closed = false
	let timer: NodeJS.Timeout | null = null

	const markClosed = () => {
		if (closed) return
		closed = true
		if (timer) {
			clearInterval(timer)
			timer = null
		}
		controller.abort()
	}

	req.on("close", markClosed)

	// 先推一个注释帧，强制把响应头刷下去：
	// 部分中间层要等到有第一个字节才发头，否则前端会一直 pending
	res.write(commentFrame("ok"))

	timer = setInterval(() => {
		if (closed || res.writableEnded) return
		// 心跳失败说明连接已死，顺手收摊
		try {
			res.write(commentFrame("ping"))
		} catch {
			markClosed()
		}
	}, heartbeatMs)

	return {
		write(event_: string, data: unknown) {
			if (closed || res.writableEnded) return
			try {
				res.write(formatSseFrame(event_, data))
			} catch {
				// 写失败（EPIPE 等）不能让整个 Nitro 进程挂掉
				markClosed()
			}
		},
		close() {
			if (res.writableEnded) {
				markClosed()
				return
			}
			markClosed()
			try {
				res.end()
			} catch {
				// 已断开，忽略
			}
		},
		get closed() {
			return closed
		},
		signal: controller.signal,
	}
}
