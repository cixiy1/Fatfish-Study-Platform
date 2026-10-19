import { findAllSkills, findUserSkills } from "../../repositories/learning.repository"
import { readSession } from "../../utils/session"
import { findUserByAccount } from "../../repositories/user.repository"

/** 技能图谱：GET /api/skills */
export default defineEventHandler((event) => {
	const skills = findAllSkills()

	const session = readSession(event)
	let userSkills: { skill_id: number, status: string, self_assessed_level: number }[] = []
	if (session) {
		const user = findUserByAccount(session.account)
		if (user) userSkills = findUserSkills(user.id)
	}

	return { skills, userSkills }
})
