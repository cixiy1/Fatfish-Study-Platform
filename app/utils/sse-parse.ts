/**
 * SSE 帧解析（纯函数，便于单测）。
 *
 * 按 SSE 规范：一个帧由若干 `field: value` 行组成，以空行结束；
 * `data` 可以出现多行，需用 \n 拼接——早期实现用 `/^data: (.+)$/m`
 * 只取第一行，一旦服务端发多行 payload 就会静默截断。
 */

export interface SseFrame {
	/** 事件名；缺省为 message */
	event: string
	/** 已解析的 data 载荷；无法解析时为 null */
	data: unknown
	/** data 的原始文本（JSON 解析失败时仍保留，便于上层自行处理） */
	raw: string
}

export interface SseParseResult {
	frames: SseFrame[]
	/** 末尾不完整的残余内容，需留给下一次拼接 */
	rest: string
}

const DEFAULT_EVENT = "message"

/**
 * 解析缓冲区里的完整帧。
 *
 * 以空行（`\n\n`，兼容 `\r\n\r\n`）切分；以 `:` 开头的是注释/心跳，忽略。
 * JSON 解析失败不会中断整个流，该帧的 data 为 null、raw 保留原文。
 */
export function parseSseFrames(buffer: string): SseParseResult {
	const frames: SseFrame[] = []

	// 统一换行符，避免服务端用 \r\n 时切不开
	const normalized = buffer.replace(/\r\n/g, "\n")
	const blocks = normalized.split("\n\n")
	// 最后一段可能还没收完，留到下次
	const rest = blocks.pop() ?? ""

	for (const block of blocks) {
		if (!block.trim()) continue

		const dataLines: string[] = []
		let eventName = DEFAULT_EVENT

		for (const line of block.split("\n")) {
			if (!line) continue
			// 注释帧（心跳 `: ping`）
			if (line.startsWith(":")) continue

			const separator = line.indexOf(":")
			if (separator === -1) continue

			const field = line.slice(0, separator).trim()
			// 规范里 `field:value` 的单个前导空格要去掉
			let value = line.slice(separator + 1)
			if (value.startsWith(" ")) value = value.slice(1)

			if (field === "data") {
				dataLines.push(value)
			} else if (field === "event") {
				eventName = value || DEFAULT_EVENT
			}
			// 其余字段（id / retry）当前用不到，忽略
		}

		if (dataLines.length === 0) continue

		const raw = dataLines.join("\n")
		let data: unknown = null
		try {
			data = JSON.parse(raw)
		} catch {
			data = null
		}

		frames.push({ event: eventName, data, raw })
	}

	return { frames, rest }
}
