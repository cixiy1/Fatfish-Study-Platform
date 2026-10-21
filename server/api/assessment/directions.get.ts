import {
	findPositionById,
	findStudyPositions,
	findUserProfile,
	parseProfileData,
} from "../../repositories/learning.repository"
import { findUserByAccount } from "../../repositories/user.repository"
import { readSession } from "../../utils/session"

/**
 * 测评可选方向：GET /api/assessment/directions
 *
 * 能力测评必须能跟着学习方向走，前端要有个地方拿「我在学的方向」。
 * 只列 learning_paths 里真实存在的方向（真在学），外加当前主方向；
 * 不用 findAllPositions —— 那会把全站种子岗位都摆出来。
 */
export default defineEventHandler((event) => {
	const session = readSession(event)
	if (!session) throw createError({ statusCode: 401, message: "未登录" })

	const user = findUserByAccount(session.account)
	if (!user) throw createError({ statusCode: 401, message: "用户不存在" })

	const profile = findUserProfile(user.id)
	const profileData = parseProfileData(profile?.profile_data ?? null)
	const primaryId = (profileData.aiDirection as { positionId?: number } | undefined)?.positionId ?? null

	const directions = findStudyPositions(user.id).map((row) => ({
		id: row.id,
		name: row.name,
		category: row.category,
		description: row.description,
		itemCount: row.item_count,
		completedCount: row.completed_count ?? 0,
		generationStatus: row.generation_status,
	}))

	// 主方向还没有学习路径（刚选完方向就来做测评）时也要能选到
	if (primaryId && !directions.some((item) => item.id === primaryId)) {
		const position = findPositionById(primaryId)
		if (position && (position.owner_user_id === null || position.owner_user_id === user.id)) {
			directions.unshift({
				id: position.id,
				name: position.name,
				category: position.category,
				description: position.description,
				itemCount: 0,
				completedCount: 0,
				generationStatus: "none",
			})
		}
	}

	return {
		directions,
		current: primaryId && directions.some((item) => item.id === primaryId)
			? primaryId
			: directions[0]?.id ?? null,
	}
})
