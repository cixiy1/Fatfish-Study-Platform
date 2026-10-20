import {
	createQARecord,
	findAllSkills,
	findQARecordsByUser,
} from "../../repositories/learning.repository"
import { findUserByAccount } from "../../repositories/user.repository"
import { chat } from "../../utils/llm"
import {
	activePositionIds,
	buildFallbackAnswer,
	buildQaMessages,
	collectLearningContext,
	MAX_QUESTION_LENGTH,
	searchKnowledge,
} from "../../utils/qa-context"
import { readSession } from "../../utils/session"

/**
 * 智能答疑（非流式）：GET /api/qa（历史） POST /api/qa（提问）
 *
 * 流式版本见 qa/stream.post.ts——两个端点共用 qa-context 装配上下文，
 * 保证「问同一个问题」不会因为走不同接口而得到两套 prompt。
 */

export default defineEventHandler(async (event) => {
	const session = readSession(event)
	if (!session) throw createError({ statusCode: 401, message: "未登录" })

	const user = findUserByAccount(session.account)
	if (!user) throw createError({ statusCode: 401, message: "用户不存在" })

	if (event.method === "POST") {
		return handleQuestion(event, user.id, user.name)
	}
	return findQARecordsByUser(user.id)
})

async function handleQuestion(
	event: Parameters<Parameters<typeof defineEventHandler>[0]>[0],
	userId: number,
	userName: string,
) {
	const body = await readBody<{ question?: string }>(event).catch(() => null)
	const question = (body?.question ?? "").trim()

	if (!question) throw createError({ statusCode: 400, message: "请输入问题" })
	if (question.length > MAX_QUESTION_LENGTH) {
		throw createError({ statusCode: 400, message: `问题长度不能超过 ${MAX_QUESTION_LENGTH} 字` })
	}

	const skillNameById = new Map(findAllSkills().map((skill) => [skill.id, skill.name]))
	const context = collectLearningContext(userId, skillNameById)
	const search = searchKnowledge(question, activePositionIds(userId))
	const history = findQARecordsByUser(userId, 2)

	let answer = ""
	let source: "llm" | "fallback" = "llm"
	let model: string | null = null

	try {
		const result = await chat({
			messages: buildQaMessages({ question, context, search, history }),
			temperature: 0.3,
			maxTokens: 2500,
			timeoutMs: 60_000,
			retries: 1,
			tag: `qa:${userId}`,
			allowMockOnError: false,
		})

		if (result.mock || !result.text.trim()) throw new Error("模型未返回内容")

		answer = result.text.trim()
		model = result.model
	} catch (error) {
		const reason = error instanceof Error ? error.message : "大模型调用失败"
		console.warn(`[qa] llm failed user=${userId} error=${reason}`)
		source = "fallback"
		answer = buildFallbackAnswer(question, search)
	}

	const recordContext = JSON.stringify({
		source,
		model,
		skills: search.matchedSkills.map((skill) => skill.id),
		resources: search.matchedResources.map((resource) => resource.id),
		asker: userName,
	})

	createQARecord(userId, question, answer, recordContext)
	return { question, answer, source, model }
}
