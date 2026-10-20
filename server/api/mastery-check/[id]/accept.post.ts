import {
	findAllSkills,
	findMasteryCheckById,
	moveSkillsToReview,
	normalizePathOrder,
	reopenSkillsForReview,
	updateMasteryCheckAccepted,
	upsertUserSkill,
} from "../../../repositories/learning.repository"
import { findUserByAccount } from "../../../repositories/user.repository"
import { readSession } from "../../../utils/session"

/**
 * 采纳阶段测评结论：POST /api/mastery-check/:id/accept
 *
 * 这一步才真正改动学习者的图谱与路径——
 * - 判定掌握 → user_skills 标 mastered
 * - 判定没掌握 → 标 not_started，并把该技能在路径里还没学的关卡挪到末尾标成复习关
 *
 * 之所以要「采纳」这一步而不是判完分就自动改：
 * 模型判断可能出错，直接改掉用户的路径很难撤回，中间留一次确认更稳妥。
 */

interface StoredVerdict {
	skillId?: number | null
	name?: string
	mastered?: boolean
}

export default defineEventHandler(async (event) => {
	const session = readSession(event)
	if (!session) throw createError({ statusCode: 401, message: "未登录" })

	const user = findUserByAccount(session.account)
	if (!user) throw createError({ statusCode: 401, message: "用户不存在" })

	const checkId = Number(getRouterParam(event, "id"))
	const check = findMasteryCheckById(checkId, user.id)
	if (!check) throw createError({ statusCode: 404, message: "测评不存在" })

	if (check.status === "accepted") {
		throw createError({ statusCode: 409, message: "这份测评的结论已经采纳过了" })
	}
	if (!check.result_data) {
		throw createError({ statusCode: 400, message: "这份测评还没判分" })
	}

	const result = JSON.parse(check.result_data) as { perSkill?: StoredVerdict[] }
	const verdicts = Array.isArray(result.perSkill) ? result.perSkill : []
	if (verdicts.length === 0) {
		throw createError({ statusCode: 400, message: "判分结果里没有技能结论" })
	}

	const levelById = new Map(findAllSkills().map((skill) => [skill.id, skill.level]))

	const masteredIds: number[] = []
	const reviewIds: number[] = []

	for (const verdict of verdicts) {
		const skillId = typeof verdict.skillId === "number" ? verdict.skillId : null
		if (!skillId) continue

		if (verdict.mastered === true) {
			upsertUserSkill(user.id, skillId, "mastered", levelById.get(skillId) ?? 1)
			masteredIds.push(skillId)
		} else {
			upsertUserSkill(user.id, skillId, "not_started", levelById.get(skillId) ?? 1)
			reviewIds.push(skillId)
		}
	}

	// 没掌握的技能：先把它那关从「已完成」退回去，再挪到末尾标成复习关
	const reopened = reopenSkillsForReview(check.path_id, reviewIds)
	const reviewMoved = moveSkillsToReview(check.path_id, reviewIds)
	if (reopened > 0 || reviewMoved > 0) {
		normalizePathOrder(check.path_id)
	}

	updateMasteryCheckAccepted(checkId)

	return {
		checkId,
		pathId: check.path_id,
		mastered: masteredIds,
		review: reviewIds,
		reopened,
		reviewMoved,
	}
})
