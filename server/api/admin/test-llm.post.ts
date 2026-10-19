import type { TestLlmRequest, TestLlmResponse } from "#shared/types/auth"
import { requireAdmin } from "../../utils/admin-guard"
import { getLlmConfig } from "../../repositories/settings.repository"

/**
 * 测试大模型连接：POST /api/admin/test-llm
 *
 * 使用当前保存的 LLM 配置发送一条测试消息。
 */
export default defineEventHandler(async (event) => {
	requireAdmin(event)

	const body = await readBody<TestLlmRequest>(event).catch(() => null)
	const prompt = (body?.prompt ?? "你好，请回复测试成功").trim()

	const config = getLlmConfig()
	if (!config) {
		throw createError({ statusCode: 400, message: "大模型尚未配置，请先保存设置" })
	}

	try {
		const reply = await callLlm(config, prompt)
		const response: TestLlmResponse = {
			ok: true,
			message: "大模型连接成功",
			reply,
		}
		return response
	} catch (error) {
		const message = error instanceof Error ? error.message : "请求失败"
		throw createError({ statusCode: 500, message: `大模型请求失败: ${message}` })
	}
})

/** 调用大模型 API（兼容 OpenAI Chat Completions 格式） */
async function callLlm(config: { provider: string, baseUrl: string, apiKey: string, model: string, maxTokens: number }, prompt: string): Promise<string> {
	const url = `${config.baseUrl.replace(/\/$/, "")}/chat/completions`

	const res = await $fetch<{ choices?: { message?: { content?: string } }[] }>(url, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${config.apiKey}`,
		},
		body: {
			model: config.model,
			max_tokens: config.maxTokens,
			messages: [
				{ role: "user", content: prompt },
			],
		},
	})

	return res.choices?.[0]?.message?.content ?? "(空回复)"
}
