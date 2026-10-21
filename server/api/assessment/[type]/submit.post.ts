import {
	createAssessmentRecord,
	findAssessmentByType,
	findAssessmentQuestions,
	upsertUserProfile,
} from "../../../repositories/learning.repository"
import type { StoredQuestion } from "../../../repositories/learning.repository"
import { findUserByAccount } from "../../../repositories/user.repository"
import { chatJson } from "../../../utils/llm"
import { asRecord, str, strArray } from "../../../utils/llm-json"
import { readSession } from "../../../utils/session"
import { countAnswered, describeAnswer, isAnswered } from "#shared/utils/assessment"
import { QUESTION_KIND_LABEL } from "#shared/types/assessment"
import type { AnswerValue } from "#shared/types/assessment"

/**
 * 提交测评：POST /api/assessment/:type/submit
 *
 * 解读交给大模型：方向、优势、短板、建议、具体学习主题都由模型根据作答给出，
 * 不再把方向写死成「前端/后端/数据分析/AI 算法」四选一。
 * 模型不可用时返回中性文案并标注 `aiGenerated=false`，不拿规则结果冒充 AI。
 */

interface AssessmentAnalysis {
	careerDirection: string
	strengths: string[]
	weaknesses: string[]
	recommendation: string
	suggestedTopics: string[]
}

function validateAnalysis(value: unknown): AssessmentAnalysis {
	const record = asRecord(value)
	return {
		careerDirection: str(record.direction ?? record.careerDirection, 2, 30, "direction"),
		strengths: strArray(record.strengths ?? [], 0, 4, 40, "strengths"),
		weaknesses: strArray(record.weaknesses ?? [], 0, 4, 40, "weaknesses"),
		recommendation: str(record.recommendation, 10, 400, "recommendation"),
		suggestedTopics: strArray(record.suggestedTopics ?? [], 0, 6, 30, "suggestedTopics"),
	}
}

/** 降级结果：只说事实，不推断方向 */
function fallbackAnalysis(questions: StoredQuestion[], answers: AnswerValue[]): AssessmentAnalysis {
	const categories = questions
		.map((item, index) => (isAnswered(item.question, answers[index] ?? null) ? item.question.category : null))
		.filter((category): category is string => Boolean(category))

	const unique = [...new Set(categories)].slice(0, 3)

	return {
		careerDirection: "待进一步确认",
		strengths: unique,
		weaknesses: [],
		recommendation: "本次未能生成 AI 解读（大模型调用失败）。你可以先设定一个具体的学习目标，系统会通过方向访谈细化成可执行的关卡。",
		suggestedTopics: [],
	}
}

export default defineEventHandler(async (event) => {
	const session = readSession(event)
	if (!session) throw createError({ statusCode: 401, message: "未登录" })

	const user = findUserByAccount(session.account)
	if (!user) throw createError({ statusCode: 401, message: "用户不存在" })

	const type = getRouterParam(event, "type") ?? "career"
	const assessment = findAssessmentByType(type)
	if (!assessment) throw createError({ statusCode: 404, message: "测评不存在" })

	const body = await readBody<{ answers?: AnswerValue[] }>(event).catch(() => null)
	const answers: AnswerValue[] = body?.answers ?? []
	const questions = findAssessmentQuestions(assessment.id)

	if (answers.length !== questions.length) {
		throw createError({ statusCode: 400, message: "答题数量不匹配" })
	}

	// 题库没有标准答案，「得分」实际是完成题数，前端文案按完成量展示
	// 多选/填空/表单/量表各有各的完成判定，不能再用 answer >= 0 统一数
	const answeredCount = countAnswered(questions.map((item) => item.question), answers)

	const answerLines = questions.map((item, index) => {
		const q = item.question
		const category = q.category ? `［${q.category}］` : ""
		const kind = QUESTION_KIND_LABEL[q.kind] ?? q.kind
		return `${index + 1}. ${category}（${kind}）${q.question} → ${describeAnswer(q, answers[index] ?? null)}`
	})

	const messages = [
		{
			role: "system" as const,
			content: [
				"你是学习顾问，根据测评作答判断学习者的偏好与基础，给出可执行的学习方向。",
				"硬性要求：",
				"1. 只依据作答内容判断，不揣测身份、年龄、性别、学历。",
				"2. 推荐方向必须是**具体的学习主题**（如「Python 数据处理」「品牌视觉设计」「日语 N4 备考」），不要写岗位名。",
				"3. 建议要具体到下一步做什么，禁止套话。",
				"4. 只输出 JSON 对象，不要 Markdown 代码块包裹。",
			].join("\n"),
		},
		{
			role: "user" as const,
			content: [
				`测评名称：${assessment.title}`,
				`学习者作答（共 ${questions.length} 题）：`,
				...answerLines,
				"",
				"请输出：",
				'{"direction":"推荐学习方向（12字内）","strengths":["2~3条优势"],"weaknesses":["1~2条待补强"],"recommendation":"80字以内，说清先学什么、为什么","suggestedTopics":["3~5个可以立刻开始学的具体主题"]}',
				"",
				"字段要求：",
				"- direction：一个具体主题，不要写「综合开发」这种模糊说法",
				"- strengths / weaknesses：每条 15 字以内，必须能从作答里找到依据",
				"- recommendation：给出先后顺序，不要只说「多加练习」",
				"- suggestedTopics：每条 12 字以内，是学习者能直接搜索的学习内容",
			].join("\n"),
		},
	]

	let analysis: AssessmentAnalysis | null = null
	let model: string | null = null
	let degradedReason: string | null = null

	try {
		const result = await chatJson<AssessmentAnalysis>({
			messages,
			temperature: 0.4,
			maxTokens: 2000,
			timeoutMs: 60_000,
			maxAttempts: 2,
			tag: `assessment:${user.id}`,
			validate: validateAnalysis,
			allowMockOnError: false,
			mock: () => fallbackAnalysis(questions, answers),
		})

		if (!result.mock) {
			analysis = result.data
			model = result.model
		}
	} catch (error) {
		degradedReason = error instanceof Error ? error.message : "大模型调用失败"
		console.warn(`[assessment] analysis failed user=${user.id} error=${degradedReason}`)
	}

	const finalAnalysis = analysis ?? fallbackAnalysis(questions, answers)
	const aiGenerated = analysis !== null

	createAssessmentRecord(
		user.id,
		assessment.id,
		answers,
		answeredCount,
		JSON.stringify({ ...finalAnalysis, aiGenerated, model, degradedReason }),
	)

	if (type === "career") {
		upsertUserProfile(user.id, {
			assessment_completed: 1,
			career_direction: finalAnalysis.careerDirection,
			profile_data: JSON.stringify(finalAnalysis),
		})
	}

	return {
		score: answeredCount,
		total: questions.length,
		result: finalAnalysis,
		aiGenerated,
		model,
		degradedReason,
	}
})
