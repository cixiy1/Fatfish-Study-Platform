import { randomUUID } from "node:crypto"
import {
	findAssessmentByType,
	findUserProfile,
	insertDynamicQuestions,
} from "../../repositories/learning.repository"
import { findUserByAccount } from "../../repositories/user.repository"
import { buildContextLines, resolveAssessmentContext } from "../../utils/assessment-context"
import { chatStream } from "../../utils/llm"
import { requireLlm } from "../../utils/llm-guard"
import { readSession } from "../../utils/session"
import { openSse } from "../../utils/sse"

/**
 * 动态出题（流式）：POST /api/assessment/generate
 *
 * 根据「当前学习方向」出题：方向名称、方向描述、该方向的技能图谱与掌握状态、
 * 方向学习进度、该方向上次测评结论。
 *
 * 早期版本只读 profile.career_direction + 全量 user_skills，导致：
 * 用户新增/切换方向后题目不变（永远考第一次选的那个方向），且技能混着别的方向。
 */

interface GeneratedQuestion {
	question: string
	options: string[]
	category: string
}

interface GenerateBody {
	positionId?: number | null
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

	const body = await readBody<GenerateBody>(event).catch(() => null)
	const requested = Number(body?.positionId ?? 0)

	// 方向解析放在开流之前：越权/方向不存在要走正常 HTTP 错误
	const ctx = resolveAssessmentContext(user.id, requested > 0 ? requested : null)

	const assessment = findAssessmentByType("career")
	const profile = findUserProfile(user.id)

	const messages = [
		{
			role: "system" as const,
			content: [
				"你是能力测评设计师，为学习者量身定制测评题目。",
				"硬性要求：",
				"1. 题目必须全部围绕「本次测评的学习方向」出，只能考该方向技能图谱里的知识点。",
				"   严禁出现其他方向/其他领域的内容（例：方向是「日语 N4」就不能考编程；方向是「Java 后端」就不能考英语语法）。",
				"2. 每题 2~4 个选项，选项要具体、有区分度，不要「以上都对」。",
				"3. 题目数量 6~8 题，覆盖基础认知、实操经验、学习偏好，难度按自评水平与方向进度匹配。",
				"4. 若给了技能图谱与掌握状态，题目要能区分「已掌握」和「还未掌握」，不要出全方向无关的通用题。",
				"5. 先用自然语言说明出题思路（1~2 句，必须点明方向名），然后输出 JSON 数组，用 ```json 代码块包裹。",
			].join("\n"),
		},
		{
			role: "user" as const,
			content: [
				"学习者信息：",
				...buildContextLines(ctx),
				`- 职业：${profile?.profession ?? "未填写"}`,
				`- 学历：${profile?.education ?? "未填写"}`,
				`- 经验：${profile?.experience_years ? `${profile.experience_years} 年` : "未填写"}`,
				"",
				ctx.positionName
					? `请为「${ctx.positionName}」这个方向生成个性化测评题目。先说出题思路，然后输出 JSON：`
					: "请为这位学习者生成个性化测评题目。先说出题思路，然后输出 JSON：",
				"```json",
				'[{"question":"题目","options":["选项A","选项B","选项C"],"category":"分类"}]',
				"```",
			].join("\n"),
		},
	]

	const sse = openSse(event)
	let fullText = ""

	try {
		// 方向信息先推给前端：出题界面能立刻显示「正在为 X 方向出题」
		sse.write("context", {
			positionId: ctx.positionId,
			positionName: ctx.positionName,
			skillCount: ctx.skills.length,
		})

		for await (const chunk of chatStream({
			messages,
			temperature: 0.5,
			maxTokens: 4096,
			timeoutMs: 60_000,
			tag: `assessment-gen:${user.id}:${ctx.positionId ?? "none"}`,
			signal: sse.signal,
		})) {
			fullText += chunk
			sse.write("chunk", { text: chunk })
		}

		const questions = tryParseQuestions(fullText)

		if (questions) {
			// 动态题落库：分析时要按 batchId 取回「当时真正展示给用户的这套题」，
			// 否则只能用种子题去配对答案；position_id 记住这套题属于哪个方向。
			if (assessment) {
				const batchId = randomUUID()
				try {
					insertDynamicQuestions({
						assessmentId: assessment.id,
						userId: user.id,
						batchId,
						positionId: ctx.positionId,
						questions,
					})
					sse.write("done", {
						questions,
						batchId,
						positionId: ctx.positionId,
						positionName: ctx.positionName,
					})
					return
				} catch (storeError) {
					console.warn(`[assessment] 动态题目落库失败 user=${user.id}`, storeError)
				}
			}
			sse.write("done", { questions, positionId: ctx.positionId, positionName: ctx.positionName })
		} else {
			sse.write("error", { message: "题目生成失败，请重试" })
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : "出题失败"
		console.warn(`[assessment] generate failed user=${user.id} error=${message}`)
		sse.write("error", { message })
	} finally {
		sse.close()
	}
})
