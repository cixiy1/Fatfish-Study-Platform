import { findAssessmentByType, findAssessmentQuestions, createAssessmentRecord, upsertUserProfile } from "../../../repositories/learning.repository"
import { readSession } from "../../../utils/session"
import { findUserByAccount } from "../../../repositories/user.repository"

/** 提交测评：POST /api/assessment/:type/submit */
export default defineEventHandler(async (event) => {
	const session = readSession(event)
	if (!session) throw createError({ statusCode: 401, message: "未登录" })

	const user = findUserByAccount(session.account)
	if (!user) throw createError({ statusCode: 401, message: "用户不存在" })

	const type = getRouterParam(event, "type") ?? "career"
	const assessment = findAssessmentByType(type)
	if (!assessment) throw createError({ statusCode: 404, message: "测评不存在" })

	const body = await readBody<{ answers?: number[] }>(event).catch(() => null)
	const answers = body?.answers ?? []
	const questions = findAssessmentQuestions(assessment.id)

	if (answers.length !== questions.length) {
		throw createError({ statusCode: 400, message: "答题数量不匹配" })
	}

	const score = answers.reduce((sum, ans) => sum + (ans >= 0 ? 1 : 0), 0)

	const result = analyzeCareer(questions, answers)
	createAssessmentRecord(user.id, assessment.id, answers, score, JSON.stringify(result))

	if (type === "career") {
		upsertUserProfile(user.id, {
			assessment_completed: 1,
			career_direction: result.careerDirection,
			profile_data: JSON.stringify(result),
		})
	}

	return { score, total: questions.length, result }
})

function analyzeCareer(questions: { category: string | null }[], answers: number[]): {
	careerDirection: string
	strengths: string[]
	weaknesses: string[]
	recommendation: string
} {
	const directionMap = ["前端开发", "后端开发", "数据分析", "AI 算法"]
	const directionScores = [0, 0, 0, 0]

	questions.forEach((q, i) => {
		const ans = answers[i]
		// 「方向偏好」是当前题库的分类；「职业意向」用于兼容早期数据
		if ((q.category === "方向偏好" || q.category === "职业意向") && ans >= 0 && ans < 4) {
			directionScores[ans] += 2
		}
		if (q.category === "基础水平" && ans >= 2) {
			directionScores[0] += 1; directionScores[1] += 1
		}
	})

	const maxIdx = directionScores.indexOf(Math.max(...directionScores))
	const careerDirection = directionMap[maxIdx] ?? "综合开发"

	const strengths = questions
		.filter((q, i) => q.category && answers[i] >= 0)
		.slice(0, 3)
		.map((q) => q.category ?? "综合能力")

	return {
		careerDirection,
		strengths,
		weaknesses: ["需在后续关卡中补强"],
		recommendation: `建议优先选择「${careerDirection}」方向，按关卡顺序系统学习。`,
	}
}
