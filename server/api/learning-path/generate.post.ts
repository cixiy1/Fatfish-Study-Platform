import { createLearningPath, addLearningPathItem, findSkillsByPosition, findUserSkills, findResourcesBySkill, findPositionById, findLearningPathsByUser } from "../../repositories/learning.repository"
import { readSession } from "../../utils/session"
import { findUserByAccount } from "../../repositories/user.repository"

/** 生成学习路径：POST /api/learning-path/generate */
export default defineEventHandler(async (event) => {
	const session = readSession(event)
	if (!session) throw createError({ statusCode: 401, message: "未登录" })

	const user = findUserByAccount(session.account)
	if (!user) throw createError({ statusCode: 401, message: "用户不存在" })

	const body = await readBody<{ position_id?: number }>(event).catch(() => null)
	const positionId = body?.position_id
	if (!positionId) throw createError({ statusCode: 400, message: "请选择目标岗位" })

	const position = findPositionById(positionId)
	if (!position) throw createError({ statusCode: 404, message: "岗位不存在" })

	// 查重：同岗位已有路径时拒绝重复创建
	const existingPaths = findLearningPathsByUser(user.id)
	const duplicate = existingPaths.find((p) => p.target_position_id === positionId)
	if (duplicate) {
		throw createError({ statusCode: 409, message: `该岗位已有学习路径「${duplicate.name}」，请在个性化导学页面查看或切换` })
	}

	const skills = findSkillsByPosition(positionId)
	const userSkills = findUserSkills(user.id)
	const masteredSkillIds = new Set(userSkills.filter((s) => s.status === "mastered").map((s) => s.skill_id))

	const gapSkills = skills.filter((s) => !masteredSkillIds.has(s.id))

	const pathId = createLearningPath(user.id, `${position.name} 学习路径`, positionId)

	let order = 0
	for (const skill of gapSkills) {
		const resources = findResourcesBySkill(skill.id)
		if (resources.length > 0) {
			for (const res of resources) {
				addLearningPathItem(pathId, skill.id, res.id, order++)
			}
		} else {
			addLearningPathItem(pathId, skill.id, null, order++)
		}
	}

	return { ok: true, pathId, totalItems: order, gapCount: gapSkills.length }
})
