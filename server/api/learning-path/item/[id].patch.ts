import { findAllSkills, findLearningPathItems, findPathItemForUser, updatePathItemStatus, upsertUserSkill } from "../../../repositories/learning.repository"
import { readSession } from "../../../utils/session"
import { findUserByAccount } from "../../../repositories/user.repository"

/**
 * 更新学习路径项状态：PATCH /api/learning-path/item/:id
 * 两条服务端约束（前端只是视觉，不能当作校验）：
 * 1. 只能改自己的关卡
 * 2. 不能跳过未完成的前一关直接完成后面的关卡
 */
export default defineEventHandler(async (event) => {
	const session = readSession(event)
	if (!session) throw createError({ statusCode: 401, message: "未登录" })

	const user = findUserByAccount(session.account)
	if (!user) throw createError({ statusCode: 401, message: "用户不存在" })

	const itemId = Number(getRouterParam(event, "id"))
	if (!Number.isFinite(itemId)) throw createError({ statusCode: 400, message: "参数不合法" })

	const body = await readBody<{ status?: string }>(event).catch(() => null)
	const status = body?.status

	if (!status || !["pending", "in_progress", "completed"].includes(status)) {
		throw createError({ statusCode: 400, message: "状态不合法" })
	}

	const item = findPathItemForUser(itemId, user.id)
	if (!item) throw createError({ statusCode: 404, message: "关卡不存在" })

	if (status === "completed") {
		const siblings = findLearningPathItems(item.path_id)
		const index = siblings.findIndex((s) => s.id === itemId)
		const previous = index > 0 ? siblings[index - 1] : null
		if (previous && previous.status !== "completed") {
			throw createError({ statusCode: 409, message: "请先完成上一关" })
		}
	}

	updatePathItemStatus(itemId, status)

	// 关卡状态同步到技能掌握：学习报告、技能图谱都读 user_skills，
	// 不同步的话「已掌握 / 掌握率」会永远是 0
	if (item.skill_id && status !== "pending") {
		const level = findAllSkills().find((skill) => skill.id === item.skill_id)?.level ?? 2
		upsertUserSkill(user.id, item.skill_id, status === "completed" ? "mastered" : "learning", level)
	}

	return { ok: true }
})
