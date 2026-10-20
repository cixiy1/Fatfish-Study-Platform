import { createQARecord, findQARecordsByUser, findAllSkills, findAllResources } from "../../repositories/learning.repository"
import { readSession } from "../../utils/session"
import { findUserByAccount } from "../../repositories/user.repository"

/** 智能答疑：GET /api/qa（历史） POST /api/qa（提问） */
export default defineEventHandler((event) => {
	const session = readSession(event)
	if (!session) throw createError({ statusCode: 401, message: "未登录" })

	const user = findUserByAccount(session.account)
	if (!user) throw createError({ statusCode: 401, message: "用户不存在" })

	if (event.method === "POST") {
		return handleQuestion(event, user.id)
	}
	return findQARecordsByUser(user.id)
})

async function handleQuestion(event: Parameters<Parameters<typeof defineEventHandler>[0]>[0], userId: number) {
	const body = await readBody<{ question?: string }>(event).catch(() => null)
	const question = (body?.question ?? "").trim()
	if (!question) throw createError({ statusCode: 400, message: "请输入问题" })

	const skills = findAllSkills()
	const resources = findAllResources()

	const keywords = question.toLowerCase().split(/\s+/).filter((k) => k.length > 1)
	const matchedSkills = skills.filter((s) =>
		keywords.some((k) => s.name.toLowerCase().includes(k) || s.description?.toLowerCase().includes(k)),
	)
	const matchedResources = resources.filter((r) =>
		keywords.some((k) => r.title.toLowerCase().includes(k) || r.description?.toLowerCase().includes(k)),
	)

	let answer: string
	let context: string | null = null

	const DIFFICULTY: Record<string, string> = {
		beginner: "入门",
		intermediate: "进阶",
		advanced: "高级",
	}

	if (matchedSkills.length > 0 || matchedResources.length > 0) {
		const skillList = matchedSkills.slice(0, 5).map((s) => `- ${s.name}：${s.description ?? ""}`).join("\n")
		const resList = matchedResources
			.slice(0, 5)
			.map((r) => `- ${r.title}（${DIFFICULTY[r.difficulty] ?? r.difficulty}）${r.url ? ` [链接](${r.url})` : ""}`)
			.join("\n")
		answer = `匹配到以下知识点：\n\n**相关技能**\n${skillList || "- 无"}\n\n**学习资源**\n${resList || "- 无"}`
		context = JSON.stringify({ skills: matchedSkills.map((s) => s.id), resources: matchedResources.map((r) => r.id) })
	} else {
		answer = `未找到与「${question}」匹配的知识点。可以尝试：\n\n1. 使用更具体的术语，如 Vue、SQL、Python\n2. 在「技能图谱」中查找相关技能\n3. 浏览学习资源列表`
	}

	createQARecord(userId, question, answer, context)
	return { question, answer }
}
