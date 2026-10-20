import { describe, expect, it } from "vitest"
import { parseSseFrames } from "../../app/utils/sse-parse"

describe("parseSseFrames", () => {
	it("解析常规事件帧", () => {
		const { frames, rest } = parseSseFrames('event: chunk\ndata: {"text":"你好"}\n\n')
		expect(frames).toHaveLength(1)
		expect(frames[0]!.event).toBe("chunk")
		expect(frames[0]!.data).toEqual({ text: "你好" })
		expect(rest).toBe("")
	})

	it("data 多行时用 \\n 拼接（旧实现只取第一行会静默截断）", () => {
		const { frames } = parseSseFrames('event: done\ndata: {"a":\ndata: 1}\n\n')
		expect(frames).toHaveLength(1)
		expect(frames[0]!.data).toEqual({ a: 1 })
	})

	it("event 缺省时降级为 message", () => {
		const { frames } = parseSseFrames('data: {"x":1}\n\n')
		expect(frames[0]!.event).toBe("message")
	})

	it("忽略心跳注释帧", () => {
		const { frames } = parseSseFrames(": ping\n\nevent: chunk\ndata: {\"t\":\"a\"}\n\n")
		expect(frames).toHaveLength(1)
		expect(frames[0]!.event).toBe("chunk")
	})

	it("末尾不完整的帧留在 rest 里等下一次拼接", () => {
		const { frames, rest } = parseSseFrames('event: chunk\ndata: {"t":"a"}\n\nevent: chunk\ndata: {"t":')
		expect(frames).toHaveLength(1)
		expect(rest).toBe('event: chunk\ndata: {"t":')
	})

	it("坏 JSON 不炸，data 为 null 且保留原文", () => {
		const { frames } = parseSseFrames("event: chunk\ndata: 这不是JSON\n\n")
		expect(frames).toHaveLength(1)
		expect(frames[0]!.data).toBeNull()
		expect(frames[0]!.raw).toBe("这不是JSON")
	})

	it("兼容 CRLF 换行", () => {
		const { frames } = parseSseFrames('event: chunk\r\ndata: {"t":"a"}\r\n\r\n')
		expect(frames).toHaveLength(1)
		expect(frames[0]!.data).toEqual({ t: "a" })
	})

	it("去掉单个前导空格（SSE 规范）", () => {
		const { frames } = parseSseFrames('event: chunk\ndata:  {"t":"a"}\n\n')
		expect(frames[0]!.data).toEqual({ t: "a" })
	})
})
