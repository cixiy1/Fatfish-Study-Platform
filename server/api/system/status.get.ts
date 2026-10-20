import { getLlmStatus } from "../../utils/llm-guard"

/**
 * 平台运行状态：GET /api/system/status
 *
 * 只暴露「能不能用」和少量非敏感配置（provider / model），
 * 供引导页、关卡页、后台判断是否要提示用户去配置大模型。
 */
export default defineEventHandler(() => {
	const llm = getLlmStatus()

	return {
		llm: {
			ready: llm.ready,
			configured: llm.configured,
			reason: llm.reason,
			provider: llm.provider,
			model: llm.model,
			mockForced: llm.mockForced,
		},
		/** 后台配置页，前端直接拿来当跳转目标 */
		setupPath: "/admin/llm",
	}
})
