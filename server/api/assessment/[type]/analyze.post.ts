import {
	createAssessmentRecord,
	findAssessmentByType,
	findAssessmentQuestions,
	findQuestionsByBatch,
	mergeProfileData,
	upsertUserProfile,
	upsertUserSkill,
} from "../../../repositories/learning.repository"
import { findUserByAccount } from "../../../repositories/user.repository"
import { buildContextLines, resolveAssessmentContext } from "../../../utils/assessment-context"
import { chatStream } from "../../../utils/llm"
import { requireLlm } from "../../../utils/llm-guard"
import { readSession } from "../../../utils/session"
import { openSse } from "../../../utils/sse"
import { applySkillLinks, mapConclusionToSkills } from "../../../utils/skill-link"
import type { SkillLink } from "../../../utils/skill-link"
import type { AssessmentContext } from "../../../utils/assessment-context"

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
/**
 * 兜底联动：字符串子串匹配。
 *
 * 只在 LLM 语义映射（mapConclusionToSkills）失败时兜底。
 * 匹配范围限定在**本次测评方向**的技能（ctx.skills），
 * 此前用 findAllSkills() 全库匹配，测完 Java 会把日语方向的同名/近名技能也标掉。
 *
 * 注意是**单向**包含 + 长度保护：早期版本用双向 includes，
 * 「学习能力强」这种长句会把名为「学习」的技能误判成已掌握。
 */
function linkSkillsByKeyword(userId: number, result: AnalysisResult, ctx: AssessmentContext): void {
	const mastered = new Set<string>()
	const weak = new Set<string>()

	const match = (text: string, bucket: Set<string>) => {
		const lower = text.toLowerCase()
		for (const skill of ctx.skills) {
			const name = skill.name.toLowerCase()
			// 只有当「结论短语」不比技能名长太多时才认，避免长句误吞短技能名
			if (lower.length > name.length + 2) continue
			if (lower.includes(name) || name.includes(lower)) {
				bucket.add(skill.name)
			}
		}
	}

	for (const s of result.strengths) match(s, mastered)
	for (const w of result.weaknesses) match(w, weak)

	for (const skill of ctx.skills) {
		if (mastered.has(skill.name)) {
			upsertUserSkill(userId, skill.id, "mastered", skill.level)
		} else if (weak.has(skill.name)) {
			upsertUserSkill(userId, skill.id, "not_started", skill.level)
		}
	}
}

/**
 * 把测评结论映射到技能图谱。
 *
 * 候选集严格取「本次测评方向的技能」，上限 12 个。
 * 此前取 profile_data.aiDirection.positionId —— 那是首次选定的方向，
 * 用户在别的方向做测评时，结论会被写到第一个方向的技能上。
 */
async function linkSkillsFromConclusion(
	userId: number,
	result: AnalysisResult,
	ctx: AssessmentContext,
): Promise<SkillLink[]> {
	try {
		const candidates = ctx.skills.slice(0, 12).map((skill) => ({
			id: skill.id,
			name: skill.name,
			description: null,
			level: skill.level,
		}))

		if (candidates.length === 0) return []

		const links = await mapConclusionToSkills({
			strengths: result.strengths,
			weaknesses: result.weaknesses,
			suggestedTopics: result.suggestedTopics,
			recommendation: result.recommendation,
			candidates,
		})

		if (links.length === 0) return []

		const levelById = new Map(candidates.map((skill) => [skill.id, skill.level]))
		applySkillLinks(userId, links, levelById)
		console.info(`[assessment] 联动技能图谱 user=${userId} 命中 ${links.length} 项`)
		return links
	} catch (error) {
		// 联动只是增益，失败不影响测评结论本身
		console.warn("[assessment] 技能联动失败", error instanceof Error ? error.message : error)
		return []
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

	const body = await readBody<{ answers?: number[], batchId?: string, positionId?: number | null }>(event).catch(() => null)
	const answers = body?.answers ?? []

	// 优先按 batchId 取「当时真正展示给用户的那套动态题」；
	// 没传（旧前端/种子题场景）才退回种子题库。
	// 此前一律读种子题：模型出 6~8 题时要么数量对不上直接 400，
	// 要么数量碰巧一致但「DB 第 i 题 + 前端第 i 个答案」错位，结论不可信。
	const questions = body?.batchId
		? findQuestionsByBatch(body.batchId, user.id)
		: findAssessmentQuestions(assessment.id)

	if (questions.length === 0) {
		throw createError({ statusCode: 400, message: "测评题目不存在，请重新生成" })
	}

	if (answers.length !== questions.length) {
		throw createError({ statusCode: 400, message: "答题数量不匹配" })
	}

	// 判定方向以「出题时那个方向」为准：用户在答题过程中可能切过方向，
	// 用当前方向会把结论写到没测过的方向上。前端显式传的 positionId 只是兜底。
	const batchPositionId = body?.batchId
		? (questions[0] as { position_id?: number | null }).position_id ?? null
		: null
	const requested = Number(body?.positionId ?? 0)
	const ctx = resolveAssessmentContext(
		user.id,
		batchPositionId ?? (requested > 0 ? requested : null),
	)

	const answeredCount = answers.reduce((sum, a) => sum + (a >= 0 ? 1 : 0), 0)

	const answerLines = questions.map((q, i) => {
		const picked = answers[i]
		const option = picked >= 0 ? q.options[picked] ?? "未作答" : "未作答"
		const category = q.category ? `［${q.category}］` : ""
		return `${i + 1}. ${category}${q.question} → ${option}`
	})

	const directionName = ctx.positionName ?? "未指定方向"

	const messages = [
		{
			role: "system" as const,
			content: [
				`你是学习顾问，正在分析一次「${directionName}」方向的测评作答。`,
				"硬性要求：",
				"1. 只依据作答内容判断，不揣测身份、年龄、性别、学历。",
				`2. 结论必须落在「${directionName}」这个方向上：strengths / weaknesses 尽量使用该方向技能图谱里的技能名，`,
				"   不得引入其他方向、其他领域的内容（方向是日语就别评价编程能力）。",
				"3. 推荐方向必须是**具体的学习主题**（如「Python 数据处理」「品牌视觉设计」「日语 N4 备考」），不要写岗位名。",
				"4. 建议要具体到下一步做什么，禁止套话。",
				"5. 先用自然语言简要分析（2~3 句），然后输出 JSON 对象，用 ```json 代码块包裹。",
			].join("\n"),
		},
		{
			role: "user" as const,
			content: [
				`测评名称：${assessment.title}`,
				"本次测评的方向上下文：",
				...buildContextLines(ctx),
				"",
				`学习者作答（共 ${questions.length} 题）：`,
				...answerLines,
				"",
				"请先简要分析作答情况，然后输出 JSON：",
				"```json",
				'{"direction":"推荐学习方向（12字内）","strengths":["2~3条优势"],"weaknesses":["1~2条待补强"],"recommendation":"80字以内，说清先学什么、为什么","suggestedTopics":["3~5个可以立刻开始学的具体主题"]}',
				"```",
				"",
				"字段要求：",
				`- direction：若方向已明确就写该方向下的具体主题（如「${directionName} · 语法基础」），不要写「综合开发」这种模糊说法`,
				"- strengths / weaknesses：每条 15 字以内，必须能从作答里找到依据",
				"- recommendation：给出先后顺序，不要只说「多加练习」",
				"- suggestedTopics：每条 12 字以内，是学习者能直接搜索的学习内容",
			].join("\n"),
		},
	]

	const sse = openSse(event)
	let fullText = ""

	try {
		for await (const chunk of chatStream({
			messages,
			temperature: 0.4,
			maxTokens: 8192,
			timeoutMs: 60_000,
			tag: `assessment-stream:${user.id}`,
			signal: sse.signal,
		})) {
			fullText += chunk
			sse.write("chunk", { text: chunk })
		}

		const parsed = tryParseAnalysis(fullText)

		if (parsed) {
			createAssessmentRecord(
				user.id,
				assessment.id,
				answers,
				answeredCount,
				JSON.stringify({ ...parsed, aiGenerated: true, positionId: ctx.positionId }),
				ctx.positionId,
			)

			if (type === "career") {
				// 注意：profile_data 必须走 merge，不能整体覆盖——
				// 否则会把 dailyMinutes / aiDirection 这些既有键冲掉
				if (!ctx.positionId) {
					// 只有「还没选方向」时，测评推荐才配当主方向；
					// 已经有方向了再去覆盖，会把用户的主方向改成一个没建过路径的主题
					upsertUserProfile(user.id, {
						assessment_completed: 1,
						career_direction: parsed.careerDirection,
					})
				} else {
					upsertUserProfile(user.id, { assessment_completed: 1 })
				}
				mergeProfileData(user.id, {
					lastAssessment: {
						...parsed,
						positionId: ctx.positionId,
						positionName: ctx.positionName,
						at: new Date().toISOString(),
					},
					suggestedTopics: parsed.suggestedTopics,
				})
			}

			// 测评结论 → 技能图谱：优先让模型做语义映射，失败再退化为关键词匹配
			// 候选集限定在本次方向，避免结论被写到别的方向技能上
			const linked = await linkSkillsFromConclusion(user.id, parsed, ctx)
			if (linked.length === 0) {
				linkSkillsByKeyword(user.id, parsed, ctx)
			}

			// 结果页直接跳到「本次测评的方向」图谱页
			sse.write("done", {
				score: answeredCount,
				total: questions.length,
				result: parsed,
				aiGenerated: true,
				linked,
				positionId: ctx.positionId,
				positionName: ctx.positionName,
			})
		} else {
			sse.write("done", {
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
				positionId: ctx.positionId,
				positionName: ctx.positionName,
				rawText: fullText.slice(0, 1000),
			})
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : "分析失败"
		console.warn(`[assessment] stream failed user=${user.id} error=${message}`)
		sse.write("error", { message })
	} finally {
		sse.close()
	}
})
