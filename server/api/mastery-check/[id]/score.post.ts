import {
	findAllSkills,
	findMasteryCheckById,
	updateMasteryCheckScored,
} from "../../../repositories/learning.repository"
import { findUserByAccount } from "../../../repositories/user.repository"
import { chatJson } from "../../../utils/llm"
import { asRecord, LlmFormatError, str } from "../../../utils/llm-json"
import { requireLlm } from "../../../utils/llm-guard"
import { readSession } from "../../../utils/session"

/**
 * 阶段测评判分：POST /api/mastery-check/:id/score  { answers: number[] }
 *
 * 判分逻辑分两层：
 * - 对错由 correctIndex 决定（确定性，不交给模型，避免同一份答案两次判出两个分）；
 * - 「算不算掌握」交给模型综合判断（选择题可能对也可能蒙对，模型可以结合错的是不是关键点）。
 * 模型拿不到结论时退化为「对一半算掌握」的规则，并如实标注 ruleBased。
 */

interface StoredQuestion {
	skillName?: string
	question?: string
	options?: string[]
	correctIndex?: number
}

interface SkillVerdict {
	skillName: string
	mastered: boolean
	reason: string
}

interface VerdictPayload {
	feedback?: unknown
	perSkill?: unknown
}

function validateVerdict(value: unknown, allowed: Set<string>): { feedback: string, perSkill: SkillVerdict[] } {
	const record = asRecord(value)
	const feedback = str(record.feedback, 4, 400, "feedback")

	const raw = Array.isArray(record.perSkill) ? record.perSkill : []
	const perSkill: SkillVerdict[] = []
	const seen = new Set<string>()
	for (const item of raw) {
		const entry = asRecord(item)
		const name = str(entry.skillName, 1, 40, "perSkill.skillName")
		if (!allowed.has(name) || seen.has(name)) continue
		seen.add(name)
		perSkill.push({
			skillName: name,
			mastered: entry.mastered === true,
			reason: typeof entry.reason === "string" ? entry.reason.trim().slice(0, 80) : "",
		})
	}

	if (perSkill.length === 0) throw new LlmFormatError("perSkill 为空")
	return { feedback, perSkill }
}

export default defineEventHandler(async (event) => {
	const session = readSession(event)
	if (!session) throw createError({ statusCode: 401, message: "未登录" })

	const user = findUserByAccount(session.account)
	if (!user) throw createError({ statusCode: 401, message: "用户不存在" })

	requireLlm()

	const checkId = Number(getRouterParam(event, "id"))
	const check = findMasteryCheckById(checkId, user.id)
	if (!check) throw createError({ statusCode: 404, message: "测评不存在" })

	if (check.status !== "ready") {
		throw createError({ statusCode: 409, message: "这份测评已经判过分了" })
	}

	const body = await readBody<{ answers?: number[] }>(event).catch(() => null)
	const answers = Array.isArray(body?.answers) ? body!.answers! : []

	const questions = JSON.parse(check.questions) as StoredQuestion[]
	if (answers.length !== questions.length) {
		throw createError({ statusCode: 400, message: "答题数量不匹配" })
	}

	// 对错由 correctIndex 决定，不给模型发挥空间
	let score = 0
	const detail = questions.map((question, index) => {
		const picked = Number(answers[index])
		const correct = Number.isInteger(picked) && picked === Number(question.correctIndex)
		if (correct) score += 1
		return {
			skillName: question.skillName ?? "",
			question: question.question ?? "",
			picked: Number.isInteger(picked) ? picked : -1,
			correctIndex: Number(question.correctIndex ?? 0),
			correct,
		}
	})

	const skillNames = new Set(detail.map((row) => row.skillName).filter(Boolean))

	let feedback = ""
	let verdicts: SkillVerdict[] = []
	let ruleBased = false
	let model: string | null = null

	try {
		const result = await chatJson<VerdictPayload>({
			messages: [
				{
					role: "system" as const,
					content: [
						"你要判断学习者是否真的掌握了若干技能点。",
						"依据是他刚做完的测评作答（含每题对错）。",
						"判断规则：",
						"1. 关键题答错就算没掌握；只错边缘细节可以给掌握但要在 reason 里点出来。",
						"2. 不要因为他整体分高就把所有技能都判成掌握。",
						"3. skillName 必须与给定列表完全一致。",
						"4. 只输出 JSON 对象，不要 Markdown 代码块。",
					].join("\n"),
				},
				{
					role: "user" as const,
					content: [
						`得分：${score}/${questions.length}`,
						"",
						"作答明细：",
						...detail.map((row, index) =>
							`${index + 1}. ［${row.skillName}］${row.question} → 选 ${row.picked >= 0 ? row.picked : "未作答"}（正确 ${row.correctIndex}）${row.correct ? "✔" : "✘"}`
						),
						"",
						"技能点列表：",
						[...skillNames].map((name, index) => `${index + 1}. ${name}`).join("\n"),
						"",
						"请输出：",
						'{"feedback":"2~3句整体点评（要具体，点名错在哪）","perSkill":[{"skillName":"技能名","mastered":true,"reason":"20字内依据"}]}',
					].join("\n"),
				},
			],
			temperature: 0.3,
			maxTokens: 2048,
			timeoutMs: 60_000,
			maxAttempts: 2,
			tag: `mastery-score:${user.id}:${checkId}`,
			validate: (value) => validateVerdict(value, skillNames),
			allowMockOnError: false,
			mock: () => ({ feedback: "", perSkill: [] }),
		})

		if (result.mock) throw new Error("模型未返回结论")

		feedback = result.data.feedback as string
		verdicts = result.data.perSkill as SkillVerdict[]
		model = result.model
	} catch (error) {
		// 退化规则：一个技能点答对一半以上算掌握
		const reason = error instanceof Error ? error.message : "模型调用失败"
		console.warn(`[mastery-check] verdict failed check=${checkId} error=${reason}`)
		ruleBased = true
		verdicts = [...skillNames].map((name) => {
			const rows = detail.filter((row) => row.skillName === name)
			const correct = rows.filter((row) => row.correct).length
			return {
				skillName: name,
				mastered: rows.length > 0 && correct * 2 >= rows.length,
				reason: `该技能点 ${correct}/${rows.length} 题答对（模型不可用，按规则判定）`,
			}
		})
		feedback = `得分 ${score}/${questions.length}。${score * 2 >= questions.length ? "整体答得不错，" : "还有不少漏洞，"}${ruleBased ? "本次大模型不可用，掌握度按答对比例判定。" : ""}`
	}

	// 技能名 → id：落库要写 user_skills，只有名字不够
	const skillIdByName = new Map<string, number>()
	for (const skill of findAllSkills()) skillIdByName.set(skill.name, skill.id)

	const perSkill = verdicts.map((verdict) => ({
		skillId: skillIdByName.get(verdict.skillName) ?? null,
		name: verdict.skillName,
		mastered: verdict.mastered,
		reason: verdict.reason,
	}))

	updateMasteryCheckScored(checkId, answers, score, JSON.stringify({
		feedback,
		perSkill,
		model,
		ruleBased,
	}))

	return {
		checkId,
		score,
		total: questions.length,
		feedback,
		ruleBased,
		model,
		perSkill,
	}
})
