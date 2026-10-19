import { findAssessmentByType, findAssessmentQuestions } from "../../repositories/learning.repository"

/** 获取测评问卷：GET /api/assessment/:type */
export default defineEventHandler((event) => {
	const type = getRouterParam(event, "type") ?? "career"
	const assessment = findAssessmentByType(type)
	if (!assessment) {
		throw createError({ statusCode: 404, message: "测评不存在" })
	}
	const questions = findAssessmentQuestions(assessment.id)
	return { assessment, questions }
})
