import type { DirectionCandidate, DirectionProfile, DirectionSelectResponse } from "#shared/types/direction"
import {
	addPositionSkill,
	createAiPosition,
	createSkill,
	findAllSkills,
	findPositionByName,
	findSkillByName,
	findSkillsByPosition,
	mergeProfileData,
	upsertUserProfile,
} from "../../repositories/learning.repository"
import { findUserByAccount } from "../../repositories/user.repository"
import { decodePayload, verify } from "../../utils/crypto"
import { getSessionSecret, readSession } from "../../utils/session"

/**
 * 选定学习方向：POST /api/direction/select
 *
 * 方向候选来自 interview 返回的签名 token，客户端只能传下标，
 * 不能伪造 skillIds（否则可以给自己造一个"全会"的方向）。
 */

interface SelectionPayload {
	v: 1
	uid: number
	exp: number
	profile: DirectionProfile
	directions: DirectionCandidate[]
}

export default defineEventHandler(async (event): Promise<DirectionSelectResponse> => {
	const session = readSession(event)
	if (!session) throw createError({ statusCode: 401, message: "未登录" })

	const user = findUserByAccount(session.account)
	if (!user) throw createError({ statusCode: 401, message: "用户不存在" })

	const body = await readBody<{ selectionToken?: string, directionIndex?: number }>(event).catch(() => null)
	const token = (body?.selectionToken ?? "").trim()
	const index = Number(body?.directionIndex ?? 0)

	if (!token) throw createError({ statusCode: 400, message: "缺少方向凭证，请重新完成问答" })

	const dot = token.lastIndexOf(".")
	if (dot <= 0) throw createError({ statusCode: 400, message: "方向凭证格式错误" })

	const encoded = token.slice(0, dot)
	const signature = token.slice(dot + 1)
	if (!verify(encoded, signature, getSessionSecret())) {
		throw createError({ statusCode: 400, message: "方向凭证校验失败，请重新完成问答" })
	}

	const payload = decodePayload<SelectionPayload>(encoded)
	if (!payload || payload.v !== 1) throw createError({ statusCode: 400, message: "方向凭证无效" })
	if (payload.uid !== user.id) throw createError({ statusCode: 403, message: "方向凭证不属于当前用户" })
	if (payload.exp * 1000 < Date.now()) throw createError({ statusCode: 400, message: "方向凭证已过期，请重新完成问答" })

	const direction = payload.directions[index]
	if (!direction) throw createError({ statusCode: 400, message: "方向不存在" })

	const validSkillIds = new Set(findAllSkills().map((skill) => skill.id))
	const skillIds = direction.skillIds.filter((id) => validSkillIds.has(id))
	// 目录外的新技能（模型现场提出的任何领域的技能点）
	const pendingSkills = (direction.newSkills ?? [])
		.map((item) => ({ name: item.name.trim().slice(0, 30), level: Math.min(3, Math.max(1, Math.round(item.level || 1))) }))
		.filter((item) => item.name.length >= 2)

	if (skillIds.length + pendingSkills.length < 3) {
		throw createError({ statusCode: 400, message: "该方向的技能不足，请重新生成" })
	}

	// 重名复用：命中种子岗位就不要再复制一份，否则岗位列表会出现两条同名
	const existing = findPositionByName(direction.name, user.id)

	let positionId: number
	let reused = false

	if (existing) {
		positionId = existing.id
		reused = true
	} else {
		positionId = createAiPosition({
			userId: user.id,
			name: direction.name,
			category: direction.category,
			description: direction.reason.slice(0, 200),
			icon: "i-lucide-compass",
		})

		skillIds.forEach((skillId, order) => {
			addPositionSkill(positionId, skillId, direction.skillLevels[String(skillId)] ?? 1, order)
		})

		// 新技能：库里已有同名就复用，没有才落库，避免同义技能反复堆积
		const seen = new Set(skillIds)
		let order = skillIds.length
		for (const pending of pendingSkills) {
			const hit = findSkillByName(pending.name)
			const skillId = hit?.id ?? createSkill({
				name: pending.name,
				category: direction.category,
				level: pending.level,
				description: `${pending.name}的基础知识与核心用法`,
			})
			if (seen.has(skillId)) continue
			seen.add(skillId)
			addPositionSkill(positionId, skillId, pending.level, order)
			order += 1
		}
	}

	// 以库里实际挂上的技能为准（复用岗位 / 新建岗位两种情况都适用）
	const finalSkillIds = findSkillsByPosition(positionId).map((skill) => skill.id)

	// 只 merge，不整体覆盖（dailyMinutes 等键要保留）
	mergeProfileData(user.id, {
		aiDirection: {
			positionId,
			name: direction.name,
			reason: direction.reason,
			matchScore: direction.matchScore,
			skillIds: finalSkillIds,
			estimatedWeeks: direction.estimatedWeeks,
			profile: payload.profile,
		},
	})
	upsertUserProfile(user.id, { career_direction: direction.name })

	return {
		positionId,
		name: direction.name,
		skillCount: finalSkillIds.length,
		reused,
	}
})
