import { findPositionById, findSkillsByPosition, findUserSkills } from "../../repositories/learning.repository"
import { readSession } from "../../utils/session"
import { findUserByAccount } from "../../repositories/user.repository"

/** 岗位详情（含技能图谱）：GET /api/positions/:id */
export default defineEventHandler((event) => {
	const id = Number(getRouterParam(event, "id"))
	const position = findPositionById(id)
	if (!position) {
		throw createError({ statusCode: 404, message: "岗位不存在" })
	}

	const skills = findSkillsByPosition(id)

	const session = readSession(event)
	let userSkills: { skill_id: number, status: string, self_assessed_level: number }[] = []
	if (session) {
		const user = findUserByAccount(session.account)
		if (user) userSkills = findUserSkills(user.id)
	}

	return { position, skills, userSkills }
})
