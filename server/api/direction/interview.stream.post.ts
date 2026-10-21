import type { DirectionInterviewResponse } from "#shared/types/direction"
import { findUserByAccount } from "../../repositories/user.repository"
import {
	MAX_TURNS,
	buildCatalog,
	buildMessages,
	countUserTurns,
	readPartialQuestion,
	sanitizeHistory,
	settleTurn,
	signSelection,
	validateTurn,
} from "../../utils/direction-interview"
import { chatStream } from "../../utils/llm"
import { extractJson, LlmFormatError } from "../../utils/llm-json"
import { requireLlm } from "../../utils/llm-guard"
import { checkRateLimit } from "../../utils/rate-limit"
import { readSession } from "../../utils/session"
import { openSse } from "../../utils/sse"

/**
 * 学习方向访谈（流式）：POST /api/direction/interview.stream
 *
 * 模型出一个问题要几秒到十几秒。之前界面只能转圈 + 一条永远跑太快的进度条，
 * 用户不知道到底在等什么。这里把模型正在撰写的题干逐字推给前端：
 *   stage  → 还没开始写（前端显示思考态）
 *   delta  → 题干增量（前端逐字追加）
 *   reset  → 格式不合格要重试，前端清空已显示的文字
 *   question → 完整结果（与旧接口同构，前端直接渲染成题目卡片）
 *   error  → 失败原因
 */
export default defineEventHandler(async (event) => {
	const session = readSession(event)
	if (!session) throw createError({ statusCode: 401, message: "未登录" })

	const user = findUserByAccount(session.account)
	if (!user) throw createError({ statusCode: 401, message: "用户不存在" })

	if (!checkRateLimit(`direction:${user.id}`, 30, 60_000)) {
		throw createError({ statusCode: 429, message: "问得太快了，稍等一下再继续" })
	}

	requireLlm()

	const body = await readBody<{ history?: unknown }>(event).catch(() => null)
	const history = sanitizeHistory(body?.history)
	const userTurns = countUserTurns(history)

	const { text: catalogText, catalog } = buildCatalog()
	const forceDone = userTurns >= MAX_TURNS

	const sse = openSse(event)

	try {
		sse.write("stage", { phase: "thinking", turn: userTurns + 1 })

		let turn: ReturnType<typeof validateTurn> | null = null
		let model = ""

		// 模型偶发输出不合法 JSON：重试一次，并让前端把已显示的半截题干清掉
		for (let attempt = 0; attempt < 2 && !turn; attempt++) {
			if (attempt > 0) sse.write("reset", { reason: "retry" })

			let fullText = ""
			let streamed = ""

			const iterator = chatStream({
				messages: buildMessages(history, catalogText, forceDone),
				temperature: 0.5,
				// 题目本身很短，但思考型模型会先推理几千 token
				maxTokens: 6000,
				timeoutMs: 60_000,
				tag: `direction:interview:stream:${user.id}`,
				signal: sse.signal,
			})

			let next = await iterator.next()
			while (!next.done) {
				fullText += next.value
				const question = readPartialQuestion(fullText)
				// 只在「同一段题干继续变长」时推送，避免模型重写时前端出现两份文字
				if (question.length > streamed.length && question.startsWith(streamed)) {
					sse.write("delta", { text: question.slice(streamed.length) })
					streamed = question
				}
				next = await iterator.next()
			}

			model = (next.value as { model?: string } | undefined)?.model ?? model
			try {
				turn = validateTurn(extractJson(fullText), catalog)
			} catch (error) {
				const detail = error instanceof Error ? error.message : "未知错误"
				console.warn(`[direction:stream] 第 ${attempt + 1} 次解析失败：${detail}`)
				if (attempt === 1) {
					throw error instanceof LlmFormatError
						? createError({ statusCode: 502, message: "模型没有按约定给出下一步问题，请重试" })
						: error
				}
			}
		}

		if (!turn) throw createError({ statusCode: 502, message: "模型没有给出下一步问题，请重试" })

		const settled = settleTurn(turn, userTurns)
		const turnIndex = userTurns + (settled.done ? 0 : 1)

		if (!settled.done) {
			const response: DirectionInterviewResponse = {
				done: false,
				turn: turnIndex,
				ask: settled.ask,
				question: settled.question,
				options: settled.options,
				profile: settled.profile,
				mock: false,
				model,
			}
			sse.write("question", response)
			return
		}

		const directions = settled.directions ?? []
		const response: DirectionInterviewResponse = {
			done: true,
			turn: turnIndex,
			profile: settled.profile,
			directions,
			selectionToken: signSelection(user.id, settled.profile, directions),
			mock: false,
			model,
		}
		sse.write("question", response)
	} catch (error) {
		const status = (error as { statusCode?: number }).statusCode
		const message = error instanceof Error ? error.message : "生成问题失败，请重试"
		console.warn(`[direction:stream] failed user=${user.id} ${message}`)
		sse.write("error", { status: status ?? 502, message })
	} finally {
		sse.close()
	}
})
