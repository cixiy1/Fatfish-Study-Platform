import type { InstallLlmInput } from "#shared/types/install"
import { LLM_PROVIDER_DEFAULTS } from "#shared/types/auth"
import { validateLlmInput } from "#shared/utils/validate-install"
import { probeLlm } from "../../utils/llm"
import { isInstalled } from "../../utils/app-config"

/**
 * 安装向导里测试大模型连通性：POST /api/install/test-llm
 *
 * 配置还没落库，所以直接拿表单值发一次真实请求。
 * 只在「尚未安装」时可用，避免变成免登录的模型探测接口。
 */
export default defineEventHandler(async (event) => {
	if (isInstalled()) {
		throw createError({ statusCode: 409, message: "系统已完成安装，请到管理后台配置" })
	}

	const body = await readBody<{ llm?: InstallLlmInput, prompt?: string }>(event).catch(() => null)
	const input = body?.llm
	if (!input) throw createError({ statusCode: 400, message: "缺少大模型配置" })

	const check = validateLlmInput(input)
	if (!check.ok) throw createError({ statusCode: 400, message: check.message ?? "配置不完整" })

	const defaults = input.provider === "custom" ? null : LLM_PROVIDER_DEFAULTS[input.provider]
	const config = {
		provider: input.provider,
		baseUrl: input.baseUrl || defaults?.baseUrl || "",
		apiKey: input.apiKey.trim(),
		model: input.model.trim(),
		maxTokens: input.maxTokens ?? 4096,
	}

	try {
		const started = Date.now()
		const result = await probeLlm(config, body?.prompt?.trim() || undefined)
		return {
			ok: true,
			message: `连接成功，模型 ${result.model} 已响应`,
			reply: result.text,
			model: result.model,
			durationMs: Date.now() - started,
		}
	} catch (error) {
		const detail = error instanceof Error ? error.message : "未知错误"
		console.warn(`[install] test-llm failed: ${detail}`)
		throw createError({
			statusCode: 502,
			message: `大模型调用失败：${detail.slice(0, 160)}`,
		})
	}
})
