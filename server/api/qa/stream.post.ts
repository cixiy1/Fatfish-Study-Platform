import {
	createQARecord,
	findAllSkills,
	findPathItemForUser,
	findQARecordsByUser,
	findResourceById,
} from "../../repositories/learning.repository"
import { findUserByAccount } from "../../repositories/user.repository"
import { chatStream } from "../../utils/llm"
import { requireLlm } from "../../utils/llm-guard"
import {
	activePositionIds,
	buildFallbackAnswer,
	buildQaMessages,
	collectLearningContext,
	MAX_EXCERPT_LENGTH,
	MAX_QUESTION_LENGTH,
	searchKnowledge,
} from "../../utils/qa-context"
import { readSession } from "../../utils/session"
import { openSse } from "../../utils/sse"

/**
 * 智能答疑（流式）：POST /api/qa/stream
 *
 * 事件：chunk（文本片段）→ done（完整答案 + 引用来源）→ error
 *
 * 额外支持 `pathItemId`：从单关页追问时带上，把该关卡的正文节选塞进上下文，
 * 否则模型不知道用户问的「这里」是哪里。
 */

export default defineEventHandler(async (event) => {
	const session = readSession(event)
	if (!session) throw createError({ statusCode: 401, message: "未登录" })

	const user = findUserByAccount(session.account)
	if (!user) throw createError({ statusCode: 401, message: "用户不存在" })

	requireLlm()

	const body = await readBody<{ question?: string, pathItemId?: number }>(event).catch(() => null)
	const question = (body?.question ?? "").trim()

	if (!question) throw createError({ statusCode: 400, message: "请输入问题" })
	if (question.length > MAX_QUESTION_LENGTH) {
		throw createError({ statusCode: 400, message: `问题长度不能超过 ${MAX_QUESTION_LENGTH} 字` })
	}

	const skillNameById = new Map(findAllSkills().map((skill) => [skill.id, skill.name]))
	const context = collectLearningContext(user.id, skillNameById)
	const search = searchKnowledge(question, activePositionIds(user.id))
	const history = findQARecordsByUser(user.id, 2)

	// 单关追问：把当前关卡正文带上
	let lesson: { title: string, excerpt: string } | null = null
	let pathItemId: number | null = null
	if (body?.pathItemId) {
		const item = findPathItemForUser(Number(body.pathItemId), user.id)
		if (item?.resource_id) {
			const resource = findResourceById(item.resource_id)
			if (resource) {
				lesson = {
					title: resource.title,
					excerpt: (resource.content ?? resource.summary ?? "")
						.replace(/\s+/g, " ")
						.slice(0, MAX_EXCERPT_LENGTH),
				}
				pathItemId = item.id
			}
		}
	}

	const sse = openSse(event)
	let fullText = ""

	try {
		for await (const chunk of chatStream({
			messages: buildQaMessages({ question, context, search, history, lesson }),
			temperature: 0.3,
			maxTokens: 2500,
			timeoutMs: 60_000,
			tag: `qa-stream:${user.id}`,
			signal: sse.signal,
		})) {
			fullText += chunk
			sse.write("chunk", { text: chunk })
		}

		const answer = fullText.trim()

		if (!answer) {
			// 模型给了空答案：退回关键词检索，并且明确标注不是模型生成
			const fallback = buildFallbackAnswer(question, search)
			sse.write("chunk", { text: fallback })
			createQARecord(user.id, question, fallback, JSON.stringify({ source: "fallback", reason: "empty-stream" }))
			sse.write("done", { question, answer: fallback, source: "fallback", model: null })
			return
		}

		createQARecord(user.id, question, answer, JSON.stringify({
			source: "llm",
			model: null,
			skills: search.matchedSkills.map((skill) => skill.id),
			resources: search.matchedResources.map((resource) => resource.id),
			pathItemId,
		}))

		sse.write("done", {
			question,
			answer,
			source: "llm",
			references: {
				skills: search.matchedSkills.map((skill) => ({ id: skill.id, name: skill.name })),
				resources: search.matchedResources.map((resource) => ({ id: resource.id, title: resource.title })),
				lesson: lesson?.title ?? null,
			},
		})
	} catch (error) {
		const message = error instanceof Error ? error.message : "答疑失败"
		console.warn(`[qa] stream failed user=${user.id} error=${message}`)
		sse.write("error", { message })
	} finally {
		sse.close()
	}
})
