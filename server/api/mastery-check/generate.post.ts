import {
	createMasteryCheck,
	findAllSkills,
	findLearningPathById,
	findLearningPathItems,
} from "../../repositories/learning.repository"
import { findUserByAccount } from "../../repositories/user.repository"
import { chatJson } from "../../utils/llm"
import { asRecord, LlmFormatError, str, strArray } from "../../utils/llm-json"
import { requireLlm } from "../../utils/llm-guard"
import { readSession } from "../../utils/session"

/**
 * 生成阶段测评：POST /api/mastery-check/generate  { pathId }
 *
 * 只考「已经学完的关卡」——没学过的拿来考只会得到随机答案，
 * 据此判定掌握度没有意义，还会把路径越排越乱。
 */

const MAX_SKILLS = 5
const MAX_QUESTIONS = 8

interface GeneratedQuestion {
	skillName: string
	question: string
	options: string[]
	correctIndex: number
}

interface GeneratePayload {
	questions?: unknown
}

function validateQuestions(value: unknown, allowedSkills: Set<string>): GeneratedQuestion[] {
	const record = asRecord(value)
	const raw = Array.isArray(record.questions) ? record.questions : []
	if (raw.length === 0) throw new LlmFormatError("questions 为空")

	const questions: GeneratedQuestion[] = []
	for (const item of raw.slice(0, MAX_QUESTIONS)) {
		const entry = asRecord(item)
		const skillName = str(entry.skillName, 1, 40, "skillName")
		// 模型自创的技能名一律丢弃：后续要靠它回写掌握度
		if (!allowedSkills.has(skillName)) continue

		const options = strArray(entry.options ?? [], 2, 4, 60, "options")
		if (options.length < 2) continue

		const rawIndex = typeof entry.correctIndex === "number"
			? entry.correctIndex
			: Number.parseInt(String(entry.correctIndex ?? ""), 10)
		const correctIndex = Number.isInteger(rawIndex) ? Math.min(Math.max(rawIndex, 0), options.length - 1) : 0

		questions.push({
			skillName,
			question: str(entry.question, 4, 120, "question"),
			options,
			correctIndex,
		})
	}

	if (questions.length === 0) throw new LlmFormatError("没有可用的题目")
	return questions
}

export default defineEventHandler(async (event) => {
	const session = readSession(event)
	if (!session) throw createError({ statusCode: 401, message: "未登录" })

	const user = findUserByAccount(session.account)
	if (!user) throw createError({ statusCode: 401, message: "用户不存在" })

	requireLlm()

	const body = await readBody<{ pathId?: number }>(event).catch(() => null)
	const pathId = Number(body?.pathId)
	if (!Number.isInteger(pathId) || pathId <= 0) {
		throw createError({ statusCode: 400, message: "缺少 pathId" })
	}

	const path = findLearningPathById(pathId, user.id)
	if (!path) throw createError({ statusCode: 404, message: "学习路径不存在" })

	const items = findLearningPathItems(pathId)
	const completed = items.filter((item) => item.status === "completed" && item.skill_id)
	if (completed.length === 0) {
		throw createError({ statusCode: 400, message: "还没有已完成的关卡，学完至少一关再来测评" })
	}

	const skillNameById = new Map(findAllSkills().map((skill) => [skill.id, skill.name]))
	// 取最近完成的若干个：太早的关卡已经不能代表当前水平
	const targetSkillIds = completed
		.slice(-MAX_SKILLS)
		.map((item) => item.skill_id as number)

	const targetSkills = targetSkillIds
		.map((id) => ({ id, name: skillNameById.get(id) ?? null }))
		.filter((row): row is { id: number, name: string } => Boolean(row.name))

	if (targetSkills.length === 0) {
		throw createError({ statusCode: 400, message: "已完成的关卡没有关联技能点" })
	}

	const allowedSkills = new Set(targetSkills.map((skill) => skill.name))
	const skillList = targetSkills.map((skill, index) => `${index + 1}. ${skill.name}`).join("\n")

	const messages = [
		{
			role: "system" as const,
			content: [
				"你要为学习者出一套「阶段掌握度测评」的选择题，检验他是否真的掌握了刚学过的技能点。",
				"硬性要求：",
				"1. 每个技能点至少 1 题，题目必须是**能动手做或能判断对错**的具体问题，不要考名词解释。",
				"2. 每题 4 个选项，只有 1 个正确，干扰项要像真的（常见误解、易混写法）。",
				"3. skillName 必须与给定的技能名完全一致。",
				"4. 题目与选项用简体中文；外语例句只能是学习路径对应的那一门外语，不能夹杂其他语种。",
				"5. 只输出 JSON 对象，不要 Markdown 代码块。",
			].join("\n"),
		},
		{
			role: "user" as const,
			content: [
				`学习路径：${path.name}`,
				"",
				"刚学完的技能点：",
				skillList,
				"",
				`请出 ${Math.min(MAX_QUESTIONS, Math.max(targetSkills.length, 4))} 道题，输出：`,
				'{"questions":[{"skillName":"技能名","question":"题干","options":["A","B","C","D"],"correctIndex":0}]}',
				"",
				"correctIndex 是正确选项在 options 里的下标（从 0 开始）。",
			].join("\n"),
		},
	]

	const result = await chatJson<GeneratePayload>({
		messages,
		temperature: 0.4,
		maxTokens: 4096,
		timeoutMs: 90_000,
		maxAttempts: 2,
		tag: `mastery-gen:${user.id}:${pathId}`,
		validate: (value) => ({ questions: validateQuestions(value, allowedSkills) }),
		allowMockOnError: false,
		mock: () => ({ questions: [] }),
	})

	if (result.mock) {
		throw createError({ statusCode: 502, message: "大模型未返回可用的测评题目" })
	}

	const questions = result.data.questions as GeneratedQuestion[]
	const checkId = createMasteryCheck({
		userId: user.id,
		pathId,
		skillIds: targetSkills.map((skill) => skill.id),
		questions,
		model: result.model ?? "unknown",
		mock: false,
	})

	return {
		checkId,
		pathId,
		skills: targetSkills.map((skill) => ({ id: skill.id, name: skill.name })),
		questions: questions.map((question, index) => ({
			index,
			skillName: question.skillName,
			question: question.question,
			options: question.options,
		})),
	}
})
