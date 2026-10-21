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
import { normalizeQuestion } from "#shared/utils/assessment"
import type { AssessmentQuestion } from "#shared/types/assessment"

/**
 * 动态出题（流式）：POST /api/assessment/generate
 *
 * 根据「当前学习方向」出题：方向名称、方向描述、该方向的技能图谱与掌握状态、
 * 方向学习进度、该方向上次测评结论。
 *
 * 早期版本只读 profile.career_direction + 全量 user_skills，导致：
 * 用户新增/切换方向后题目不变（永远考第一次选的那个方向），且技能混着别的方向。
 *
 * 题型也不止单选：单选/多选/填空/表单/自评量表/开放题按配比混合，
 * 只为让模型输出结构化的题，不再是「一串四选一」。
 */

/** 各题型的出题模板：既是给模型的范例，也是它照着填的骨架 */
const QUESTION_TEMPLATES = [
	'{"kind":"single","question":"单选题干","options":["选项A","选项B","选项C","选项D"],"category":"知识点分类","hint":"这题想验证什么"}',
	'{"kind":"multi","question":"多选题干：下面哪些你实际用过？","options":["A","B","C","D"],"category":"实操经验"}',
	'{"kind":"blank","question":"题干里用 [[1]] [[2]] 标出要填的位置，句子要读得通","blanks":[{"label":"第 1 空","placeholder":"提示词"}],"category":"术语记忆"}',
	'{"kind":"form","question":"补充一下你的学习条件","fields":[{"key":"minutes","label":"每周能投入的时间","type":"number","unit":" 小时","placeholder":"例如 6"},{"key":"tools","label":"常用的工具/环境","type":"text","placeholder":"例如 VS Code"},{"key":"level","label":"当前阶段","type":"select","options":["刚入门","能跟着教程做","能独立做项目"]}],"category":"学习条件"}',
	'{"kind":"scale","question":"你能独立完成一个完整的小项目吗？","scale":{"min":1,"max":5,"minLabel":"完全没做过","maxLabel":"能独立完成"},"category":"自评"}',
	'{"kind":"text","question":"最近一次卡住你的是什么？","placeholder":"一句话即可","category":"开放题"}',
].join("\n")

/**
 * 从模型输出里抽出题目数组并逐题规范化。
 *
 * 只认第一个 `[` 到最后一个 `]` 之间的内容：模型常在数组前后写一段思路，
 * 也可能裹在 ```json 里。合法性由 normalizeQuestion 逐题把关，坏题丢弃。
 */
function tryParseQuestions(text: string): AssessmentQuestion[] | null {
	try {
		const start = text.indexOf("[")
		const end = text.lastIndexOf("]")
		if (start < 0 || end <= start) return null
		const raw = JSON.parse(text.slice(start, end + 1)) as unknown[]
		if (!Array.isArray(raw)) return null
		const questions = raw
			.map((item) => normalizeQuestion(item))
			.filter((item): item is AssessmentQuestion => item !== null)
		return questions.length >= 3 ? questions : null
	} catch {
		return null
	}
}

interface GenerateBody {
	positionId?: number | null
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
				"2. 题目数量 6~8 题，**必须混合多种题型**，不能全是选择题：",
				"   - 单选（single）：2~3 题，考具体知识点",
				"   - 多选（multi）：必须 1~2 题（不能没有），考「用过哪些工具 / 踩过哪些坑」，选项 4 个左右",
				"   - 填空（blank）：1~2 题，考术语、语法结构、命令、属性名这类必须写对的东西",
				"   - 表单（form）：1 题，收集学习条件（可投入时间、已有基础、常用工具），字段 2~3 个",
				"   - 自评量表（scale）：1 题，1~5 分，两端语义要贴合本方向",
				"   - 开放题（text）：最多 1 题，问「最近卡在哪」这类真实困难",
				"3. 题型字段要求：",
				"   - 选择题选项 2~4 个，具体、有区分度，不要「以上都对」；category 必填",
				"   - 填空题题干里**用 [[1]] [[2]] 标出每个空的位置**，句子本身要读得通，空的数量与 blanks 数组一致（1~3 个）",
				"   - 表单字段 type 只能是 text / number / select；select 必须给 options；可加 unit（如「 小时」）",
				"   - 量表用 min 1、max 5，minLabel / maxLabel 写两端的具体含义，不要写「低/高」",
				"4. 难度按自评水平与方向进度匹配；若给了技能图谱与掌握状态，题目要能区分「已掌握」和「还未掌握」。",
				"5. 每题可加 hint（一句话说明出题意图），不要写答案。",
				"6. 先用自然语言说明出题思路（1~2 句，必须点明方向名），然后输出 JSON 数组，用 ```json 代码块包裹。",
				"",
				"题型模板（照抄字段名，替换内容）：",
				QUESTION_TEMPLATES,
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
					? `请为「${ctx.positionName}」这个方向生成个性化测评题目，题型要混合、不要清一色选择题。先说出题思路，然后输出 JSON 数组：`
					: "请为这位学习者生成个性化测评题目，题型要混合、不要清一色选择题。先说出题思路，然后输出 JSON 数组：",
				"```json",
				"[",
				`  ${QUESTION_TEMPLATES.split("\n").join(",\n  ")}`,
				"]",
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
			// 8 题里含表单/多选，JSON 体积比纯单选题大一圈，4096 会被截断
			maxTokens: 6144,
			timeoutMs: 90_000,
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
