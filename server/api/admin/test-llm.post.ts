import type { TestLlmRequest, TestLlmResponse } from "#shared/types/auth"
import { requireAdmin } from "../../utils/admin-guard"
import { getLlmConfig } from "../../repositories/settings.repository"
import { isLlmMockForced, probeLlm } from "../../utils/llm"

/**
 * 测试大模型连接：POST /api/admin/test-llm
 *
 * 走真实请求（自动区分 OpenAI 兼容 / Anthropic 协议），**禁止 mock**：
 * 这里必须把 401、超时、模型名错误等真实问题暴露给管理员，
 * 否则线上会一直以为「只是没生效」而查不出配置错。
 */
export default defineEventHandler(async (event) => {
	requireAdmin(event)

	if (isLlmMockForced()) {
		throw createError({ statusCode: 400, message: "当前处于离线模式（FSP_LLM_MOCK=1），无法测试真实连接" })
	}

	const body = await readBody<TestLlmRequest>(event).catch(() => null)
	const prompt = (body?.prompt ?? "你好，请回复测试成功").trim()

	const config = getLlmConfig()
	if (!config) {
		throw createError({ statusCode: 400, message: "大模型尚未配置，请先保存设置" })
	}

	try {
		const result = await probeLlm(config, prompt)
		const response: TestLlmResponse = {
			ok: true,
			message: `大模型连接成功（${result.model}，${result.durationMs}ms）`,
			reply: result.text || "(空回复)",
		}
		return response
	} catch (error) {
		throw createError({ statusCode: 502, message: `大模型请求失败: ${extractLlmError(error)}` })
	}
})

/** 从大模型 API 错误响应中提取可读信息 */
function extractLlmError(error: unknown): string {
	// ofetch 错误：{ data: { error: { message } } } 或 { data: { error: "msg" } }
	const data = (error as { data?: Record<string, unknown> })?.data
	if (data) {
		const err = data.error
		if (typeof err === "object" && err !== null) {
			const msg = (err as { message?: string }).message
			if (msg) return msg
		}
		if (typeof err === "string") return err
		const msg = (data as { message?: string }).message
		if (msg) return msg
	}
	if (error instanceof Error) return error.message
	return "未知错误"
}
