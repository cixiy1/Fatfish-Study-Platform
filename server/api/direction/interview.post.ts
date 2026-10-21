import type { DirectionInterviewResponse } from "#shared/types/direction"
import { findUserByAccount } from "../../repositories/user.repository"
import {
	MAX_TURNS,
	askTurn,
	buildCatalog,
	buildMessages,
	countUserTurns,
	mockDirections,
	sanitizeHistory,
	settleTurn,
	signSelection,
	validateTurn,
} from "../../utils/direction-interview"
import { chatJson } from "../../utils/llm"
import { LlmFormatError } from "../../utils/llm-json"
import { requireLlm } from "../../utils/llm-guard"
import { checkRateLimit } from "../../utils/rate-limit"
import { readSession } from "../../utils/session"

/**
 * 学习方向访谈（一次性返回）：POST /api/direction/interview
 *
 * 前端默认走 `interview.stream.post.ts` 的流式版本；这个端点保留给
 * 自动化测试、旧客户端以及流式中断时的兜底重试。
 * 提示词、题型兜底与轮次策略都在 utils/direction-interview.ts 里共用。
 */
export default defineEventHandler(async (event): Promise<DirectionInterviewResponse> => {
	const session = readSession(event)
	if (!session) throw createError({ statusCode: 401, message: "未登录" })

	const user = findUserByAccount(session.account)
	if (!user) throw createError({ statusCode: 401, message: "用户不存在" })

	if (!checkRateLimit(`direction:${user.id}`, 30, 60_000)) {
		throw createError({ statusCode: 429, message: "问得太快了，稍等一下再继续" })
	}

	// 访谈完全由模型驱动：没配大模型就别装作在聊，直接让前端去配置
	requireLlm()

	const body = await readBody<{ history?: unknown }>(event).catch(() => null)
	const history = sanitizeHistory(body?.history)
	const userTurns = countUserTurns(history)

	const { text: catalogText, catalog } = buildCatalog()

	const ask = async (forceDone = false) => chatJson<ReturnType<typeof validateTurn>>({
		messages: buildMessages(history, catalogText, forceDone),
		temperature: 0.5,
		// 思考型模型光推理就要几千 token，给 900 会直接空输出
		maxTokens: 6000,
		timeoutMs: 15_000,
		retries: 1,
		maxAttempts: 2,
		tag: "direction:interview",
		// 大模型是强依赖：调用失败就报错，不能拿演示追问糊弄用户
		allowMockOnError: false,
		validate: (payload) => validateTurn(payload, catalog),
		mock: () => {
			if (userTurns === 0) {
				return askTurn({
					kind: "text",
					question: "你最近最想学会的一件事是什么？说说具体点。",
					placeholder: "例如：能用吉他弹唱一首完整的歌",
					category: "目标",
				}, { goal: null, level: null, timeBudget: null, preference: null })
			}
			if (userTurns === 1) {
				return askTurn({
					kind: "scale",
					question: "你在这方面目前的基础大概到哪一步？",
					scale: { min: 1, max: 5, minLabel: "完全没接触", maxLabel: "能独立做出东西" },
					category: "基础",
				}, { goal: "学会一项新技能", level: null, timeBudget: null, preference: null })
			}
			return {
				done: true,
				profile: {
					goal: "学会一项新技能",
					level: "看过教程但没动手",
					timeBudget: "每周 6~10 小时",
					preference: "项目驱动",
					summary: "想入门一项新技能、有自学基础、每周可投入 6~10 小时、偏好项目实战",
				},
				directions: mockDirections(user.id),
			}
		},
	})

	/** 把模型的失败翻译成前端能显示的提示，别让 500 直接糊到用户脸上 */
	const askSafe = async (forceDone = false) => {
		try {
			return await ask(forceDone)
		} catch (error) {
			if (error instanceof LlmFormatError) {
				console.warn(`[direction] 格式不合格：${error.message}`)
				throw createError({ statusCode: 502, message: "模型没有按约定给出下一步问题，请重试" })
			}
			const detail = error instanceof Error ? error.message : "未知错误"
			console.error(`[direction] 模型调用失败：${detail}`)
			throw createError({
				statusCode: 502,
				message: "大模型调用失败，请确认 API Key 有效、额度充足后重试",
			})
		}
	}

	let result = await askSafe()

	// 轮次到顶：强制收口，不允许再问
	if (userTurns >= MAX_TURNS && !result.data.done) {
		result = await askSafe(true)
		if (!result.data.done) throw createError({ statusCode: 502, message: "模型未能给出方向，请重试" })
	}

	const turn = settleTurn(result.data, userTurns)
	const turnIndex = userTurns + (turn.done ? 0 : 1)

	if (!turn.done) {
		return {
			done: false,
			turn: turnIndex,
			ask: turn.ask,
			question: turn.question,
			options: turn.options,
			profile: turn.profile,
			mock: result.mock,
			model: result.model,
		}
	}

	const directions = turn.directions ?? []

	return {
		done: true,
		turn: turnIndex,
		profile: turn.profile,
		directions,
		selectionToken: signSelection(user.id, turn.profile, directions),
		mock: result.mock,
		model: result.model,
	}
})
