import { createLearningReport, findAssessmentRecordsByUser, findUserSkills, findLearningRecordsByUser, findLearningPathsByUser, findAllSkills } from "../../repositories/learning.repository"
import { readSession } from "../../utils/session"
import { findUserByAccount } from "../../repositories/user.repository"

/** 生成学习报告：POST /api/reports/generate */
export default defineEventHandler((event) => {
	const session = readSession(event)
	if (!session) throw createError({ statusCode: 401, message: "未登录" })

	const user = findUserByAccount(session.account)
	if (!user) throw createError({ statusCode: 401, message: "用户不存在" })

	const assessments = findAssessmentRecordsByUser(user.id)
	const userSkills = findUserSkills(user.id)
	const learningRecords = findLearningRecordsByUser(user.id)
	const paths = findLearningPathsByUser(user.id)
	const allSkills = findAllSkills()

	const masteredCount = userSkills.filter((s) => s.status === "mastered").length
	const learningCount = userSkills.filter((s) => s.status === "learning").length
	const totalSkills = allSkills.length

	const summary = {
		generatedAt: new Date().toISOString(),
		overview: {
			totalAssessments: assessments.length,
			masteredSkills: masteredCount,
			learningSkills: learningCount,
			totalSkills,
			masteryRate: totalSkills > 0 ? Math.round((masteredCount / totalSkills) * 100) : 0,
			learningRecords: learningRecords.length,
			learningPaths: paths.length,
		},
		skillBreakdown: {
			frontend: userSkills.filter((s) => allSkills.find((sk) => sk.id === s.skill_id)?.category === "前端").length,
			backend: userSkills.filter((s) => allSkills.find((sk) => sk.id === s.skill_id)?.category === "后端").length,
			data: userSkills.filter((s) => allSkills.find((sk) => sk.id === s.skill_id)?.category === "数据").length,
			ai: userSkills.filter((s) => allSkills.find((sk) => sk.id === s.skill_id)?.category === "AI").length,
			manufacturing: userSkills.filter((s) => allSkills.find((sk) => sk.id === s.skill_id)?.category === "制造").length,
		},
		recentAssessments: assessments.slice(0, 3).map((a) => ({ score: a.score, date: a.created_at })),
		recommendation: masteredCount < 3
			? "建议先完成职业测评，明确学习方向后系统化学习"
			: `已掌握 ${masteredCount} 项技能，建议继续深化${learningCount > 0 ? "正在学习的技能" : "新的技能领域"}`,
	}

	createLearningReport(user.id, "stage", null, null, JSON.stringify(summary))
	return summary
})
