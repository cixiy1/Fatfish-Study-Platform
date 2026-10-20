import {
	findAllSkills,
	findAssessmentRecordsByUser,
	findUserProfile,
	findUserSkills,
	parseProfileData,
} from "../../repositories/learning.repository"
import { findUserByAccount } from "../../repositories/user.repository"
import { chatStream } from "../../utils/llm"
import { requireLlm } from "../../utils/llm-guard"
import { readSession } from "../../utils/session"

/**
 * 动态出题（流式）：POST /api/assessment/generate
 *
 * 根据用户画像（学习目标、职业方向、已有技能、测评历史），
 * 让大模型生成个性化的能力测评题目。
 * 边输出边推送 SSE，完成后推送题目列表。
 */

interface GeneratedQuestion {
	question: string
	options: string[]
	category: string
}

function sseWrite(event: string, data: unknown): string {
	return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}

function tryParseQuestions(text: string): GeneratedQuestion[] | null {
	try {
		const start = text.indexOf("[")
		const end = text.lastIndexOf("]")
		if (start < 0 || end <= start) return null
		const raw = JSON.parse(text.slice(start, end + 1)) as unknown[]
		const questions: GeneratedQuestion[] = []
		for (const item of raw) {
			if (!item || typeof item !== "object") continue
			const r = item as Record<string, unknown>
			const question = typeof r.question === "string" ? r.question.trim() : ""
			const options = Array.isArray(r.options)
				? r.options.filter((o): o is string => typeof o === "string" && o.trim().length > 0).map((o) => o.trim())
				: []
			const category = typeof r.category === "string" ? r.category.trim() : "综合"
			if (question.length >= 5 && options.length >= 2 && options.length <= 5) {
				questions.push({ question, options, category })
			}
		}
		return questions.length >= 3 ? questions : null
	} catch {
		return null
	}
}

export default defineEventHandler(async (event) => {
	const session = readSession(event)
	if (!session) throw createError({ statusCode: 401, message: "未登录" })

	const user = findUserByAccount(session.account)
	if (!user) throw createError({ statusCode: 401, message: "用户不存在" })

	requireLlm()

	const profile = findUserProfile(user.id)
	const profileData = parseProfileData(profile?.profile_data ?? null)
	const userSkills = findUserSkills(user.id)
	const allSkills = findAllSkills()
	const assessmentRecords = findAssessmentRecordsByUser(user.id)

	const skillNames = userSkills.length > 0
		? userSkills.map((us) => {
			const skill = allSkills.find((s) => s.id === us.skill_id)
			return skill ? `${skill.name}（${us.status}）` : null
		}).filter(Boolean).join("、")
		: "暂无已记录的技能"

	const goal = profile?.learning_goal
		?? (profileData.aiDirection as { profile?: { goal?: string | null } })?.profile?.goal
		?? "未设定"
	const direction = profile?.career_direction ?? "未设定"
	const profession = profile?.profession ?? "未填写"
	const education = profile?.education ?? "未填写"
	const experience = profile?.experience_years ? `${profile.experience_years} 年` : "未填写"

	const lastAssessment = assessmentRecords[0]?.result_data?.slice(0, 200) ?? "无"

	const messages = [
		{
			role: "system" as const,
			content: [
				"你是能力测评设计师，为学习者量身定制测评题目。",
				"要求：",
				"1. 题目要基于学习者的目标、方向和已有技能，不要出无关的题。",
				"2. 每题 2~4 个选项，选项要具体、有区分度，不要「以上都对」。",
				"3. 题目数量 6~8 题，覆盖基础认知、实操经验、学习偏好。",
				"4. 先用自然语言说明出题思路（1~2 句），然后输出 JSON 数组，用 ```json 代码块包裹。",
			].join("\n"),
		},
		{
			role: "user" as const,
			content: [
				"学习者信息：",
				`- 学习目标：${goal}`,
				`- 职业方向：${direction}`,
				`- 职业：${profession}`,
				`- 学历：${education}`,
				`- 经验：${experience}`,
				`- 已有技能：${skillNames}`,
				`- 上次测评：${lastAssessment}`,
				"",
				"请为这位学习者生成个性化测评题目。先说出题思路，然后输出 JSON：",
				"```json",
				'[{"question":"题目","options":["选项A","选项B","选项C"],"category":"分类"}]',
				"```",
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
			temperature: 0.5,
			maxTokens: 4096,
			timeoutMs: 60_000,
			tag: `assessment-gen:${user.id}`,
		})) {
			fullText += chunk
			res.write(sseWrite("chunk", { text: chunk }))
		}

		const questions = tryParseQuestions(fullText)

		if (questions) {
			res.write(sseWrite("done", { questions }))
		} else {
			res.write(sseWrite("error", { message: "题目生成失败，请重试" }))
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : "出题失败"
		console.warn(`[assessment] generate failed user=${user.id} error=${message}`)
		res.write(sseWrite("error", { message }))
	} finally {
		res.end()
	}
})
