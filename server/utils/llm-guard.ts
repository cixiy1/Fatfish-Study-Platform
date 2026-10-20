import type { LlmConfig } from "#shared/types/auth"
import { createError } from "h3"
import { getLlmConfig, getSetting } from "../repositories/settings.repository"

/**
 * 大模型的就绪状态与守卫。
 *
 * 本项目把大模型当**强依赖**：AI 访谈、方向推荐、整套关卡资料、测评解读
 * 全部只能由模型产出。没配置时宁可明确拒绝，也不返回模板/演示数据，
 * 否则用户看到的是「假的 AI」，比报错更糟。
 */

export type LlmUnavailableReason = "not-configured" | "key-unreadable" | "incomplete"

export interface LlmStatus {
	/** 能否直接调用 */
	ready: boolean
	/** settings 表里有没有 llm 这一行 */
	configured: boolean
	reason: LlmUnavailableReason | null
	provider: string | null
	model: string | null
	baseUrl: string | null
	/** 是否被 FSP_LLM_MOCK=1 强制为离线 mock（仅单测用） */
	mockForced: boolean
}

/** 当前大模型是否可用（只读数据库，不发起请求） */
export function getLlmStatus(): LlmStatus {
	const mockForced = process.env.FSP_LLM_MOCK === "1"
	const raw = getSetting("llm")

	if (!raw) {
		return {
			ready: mockForced,
			configured: false,
			reason: mockForced ? null : "not-configured",
			provider: null,
			model: null,
			baseUrl: null,
			mockForced,
		}
	}

	const config = getLlmConfig()

	// 有密文却解不出来：sessionSecret 被换过，需要重新保存一次
	if (!config || !config.apiKey) {
		return {
			ready: mockForced,
			configured: true,
			reason: mockForced ? null : "key-unreadable",
			provider: config?.provider ?? null,
			model: config?.model ?? null,
			baseUrl: config?.baseUrl ?? null,
			mockForced,
		}
	}

	const complete = Boolean(config.baseUrl && config.model)

	return {
		ready: complete || mockForced,
		configured: true,
		reason: complete ? null : "incomplete",
		provider: config.provider,
		model: config.model || null,
		baseUrl: config.baseUrl || null,
		mockForced,
	}
}

/** 把未就绪原因翻译成一句能指导操作的话 */
export function describeLlmProblem(status: LlmStatus): string {
	switch (status.reason) {
		case "not-configured":
			return "未配置大模型接口，无法生成学习方向与关卡资料。请在「管理后台 → 大模型配置」填写 API Key。"
		case "key-unreadable":
			return "API Key 无法解密（站点密钥已变更），请到「管理后台 → 大模型配置」重新保存。"
		case "incomplete":
			return "配置不完整：Base URL 或模型名称为空，请补全后重试。"
		default:
			return "大模型接口不可用，请到「管理后台 → 大模型配置」检查。"
	}
}

/**
 * 业务接口的前置守卫：未就绪直接抛 503。
 *
 * 返回解密后的配置，调用方拿不到就说明已抛错，不用再判空。
 */
export function requireLlm(): LlmConfig {
	const status = getLlmStatus()
	const config = status.ready ? getLlmConfig() : null

	if (status.ready && config) return config

	throw createError({
		statusCode: 503,
		statusMessage: "LLM_NOT_CONFIGURED",
		message: describeLlmProblem(status),
		data: {
			code: "LLM_NOT_CONFIGURED",
			reason: status.reason,
			configured: status.configured,
		},
	})
}
