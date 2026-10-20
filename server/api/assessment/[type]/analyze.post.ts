import {
	createAssessmentRecord,
	findAssessmentByType,
	findAssessmentQuestions,
	findAllSkills,
	upsertUserProfile,
	upsertUserSkill,
} from "../../../repositories/learning.repository"
import { findUserByAccount } from "../../../repositories/user.repository"
import { chatStream } from "../../../utils/llm"
import { requireLlm } from "../../../utils/llm-guard"
import { readSession } from "../../../utils/session"

/**
 * 测评分析（流式）：POST /api/assessment/:type/analyze
 *
 * 提交作答后，大模型边分析边推送 SSE 事件：
 * - event: chunk   → 文本片段，前端逐步渲染
 * - event: done    → 最终解析出的 JSON 结果
 * - event: error   → 出错了
 *
 * 分析完成后联动更新技能图谱：根据模型判断的 strengths/weaknesses
 * 匹配技能库中的技能，自动标记掌握状态。
 */

interface AnalysisResult {
	careerDirection: string
	strengths: string[]
	weaknesses: string[]
	recommendation: string
	suggestedTopics: string[]
}

function sseWrite(event: string, data: unknown): string {
	return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}

function tryParseAnalysis(text: string): AnalysisResult | null {
	try {
		const start = text.indexOf("{")
		const end = text.lastIndexOf("}")
		if (start < 0 || end <= start) return null
		const raw = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>
		return {
			careerDirection: typeof raw.direction === "string" ? raw.direction
				: typeof raw.careerDirection === "string" ? raw.careerDirection
				: "待确认",
			strengths: Array.isArray(raw.strengths) ? raw.strengths.filter((s): s is string => typeof s === "string") : [],
			weaknesses: Array.isArray(raw.weaknesses) ? raw.weaknesses.filter((s): s is string => typeof s === "string") : [],
			recommendation: typeof raw.recommendation === "string" ? raw.recommendation : "",
			suggestedTopics: Array.isArray(raw.suggestedTopics) ? raw.suggestedTopics.filter((s): s is string => typeof s === "string") : [],
		}
	} catch {
		return null
	}
}

/** 根据分析结果联动更新技能状态 */
function linkSkillsToAssessment(userId: number, result: AnalysisResult): void {
	const allSkills = findAllSkills()
	const mastered = new Set<string>()
	const weak = new Set<string>()

	for (const s of result.strengths) {
		const lower = s.toLowerCase()
		for (const skill of allSkills) {
			if (lower.includes(skill.name.toLowerCase()) || skill.name.toLowerCase().includes(lower)) {
				mastered.add(skill.name)
			}
		}
	}
	for (const w of result.weaknesses) {
		const lower = w.toLowerCase()
		for (const skill of allSkills) {
			if (lower.includes(skill.name.toLowerCase()) || skill.name.toLowerCase().includes(lower)) {
				weak.add(skill.name)
			}
		}
	}

	for (const skill of allSkills) {
		if (mastered.has(skill.name)) {
			upsertUserSkill(userId, skill.id, "mastered", skill.level)
		} else if (weak.has(skill.name)) {
			upsertUserSkill(userId, skill.id, "not_started", skill.level)
		}
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

	requireLlm()

	const body = await readBody<{ answers?: number[] }>(event).catch(() => null)
	const answers = body?.answers ?? []
	const questions = findAssessmentQuestions(assessment.id)

	if (answers.length !== questions.length) {
		throw createError({ statusCode: 400, message: "答题数量不匹配" })
	}

	const answeredCount = answers.reduce((sum, a) => sum + (a >= 0 ? 1 : 0), 0)

	const answerLines = questions.map((q, i) => {
		const picked = answers[i]
		const option = picked >= 0 ? q.options[picked] ?? "未作答" : "未作答"
		const category = q.category ? `［${q.category}］` : ""
		return `${i + 1}. ${category}${q.question} → ${option}`
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
				"4. 先用自然语言简要分析（2~3 句），然后输出 JSON 对象，用 ```json 代码块包裹。",
			].join("\n"),
		},
		{
			role: "user" as const,
			content: [
				`测评名称：${assessment.title}`,
				`学习者作答（共 ${questions.length} 题）：`,
				...answerLines,
				"",
				"请先简要分析作答情况，然后输出 JSON：",
				"```json",
				'{"direction":"推荐学习方向（12字内）","strengths":["2~3条优势"],"weaknesses":["1~2条待补强"],"recommendation":"80字以内，说清先学什么、为什么","suggestedTopics":["3~5个可以立刻开始学的具体主题"]}',
				"```",
				"",
				"字段要求：",
				"- direction：一个具体主题，不要写「综合开发」这种模糊说法",
				"- strengths / weaknesses：每条 15 字以内，必须能从作答里找到依据",
				"- recommendation：给出先后顺序，不要只说「多加练习」",
				"- suggestedTopics：每条 12 字以内，是学习者能直接搜索的学习内容",
			].join("\n"),
		},
	]

	setResponseHeader(event, "Content-Type", "text/event-stream")
	setResponseHeader(event, "Cache-Control", "no-cache")
	setResponseHeader(event, "Connection", "keep-alive")

	const res = event.node.res
	let fullText = ""

	try {
		for await (const chunk of chatStream({
			messages,
			temperature: 0.4,
			maxTokens: 4096,
			timeoutMs: 60_000,
			tag: `assessment-stream:${user.id}`,
		})) {
			fullText += chunk
			res.write(sseWrite("chunk", { text: chunk }))
		}

		const parsed = tryParseAnalysis(fullText)

		if (parsed) {
			createAssessmentRecord(
				user.id,
				assessment.id,
				answers,
				answeredCount,
				JSON.stringify({ ...parsed, aiGenerated: true }),
			)

			if (type === "career") {
				upsertUserProfile(user.id, {
					assessment_completed: 1,
					career_direction: parsed.careerDirection,
					profile_data: JSON.stringify(parsed),
				})
			}

			linkSkillsToAssessment(user.id, parsed)

			res.write(sseWrite("done", {
				score: answeredCount,
				total: questions.length,
				result: parsed,
				aiGenerated: true,
			}))
		} else {
			res.write(sseWrite("done", {
				score: answeredCount,
				total: questions.length,
				result: {
					careerDirection: "待确认",
					strengths: [],
					weaknesses: [],
					recommendation: fullText.slice(0, 400) || "模型未返回有效分析结果",
					suggestedTopics: [],
				},
				aiGenerated: false,
				rawText: fullText.slice(0, 1000),
			}))
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : "分析失败"
		console.warn(`[assessment] stream failed user=${user.id} error=${message}`)
		res.write(sseWrite("error", { message }))
	} finally {
		res.end()
	}
})
