import {
	addLearningPathItem,
	createLearningPath,
	deleteLearningPath,
	findLearningPathsByUser,
	findPositionById,
	findReadyResourceBySkill,
	findResourcesBySkill,
	findSkillsByPosition,
	findUserProfile,
	findUserSkills,
	getPlanSettings,
	parseProfileData,
	updatePathGenerationStatus,
} from "../../repositories/learning.repository"
import { findUserByAccount } from "../../repositories/user.repository"
import { LlmKeyUnreadableError, LlmNotConfiguredError, LlmTruncatedError } from "../../utils/llm"
import { describeLlmProblem, getLlmStatus, requireLlm } from "../../utils/llm-guard"
import { PlanGenerationError, generatePlanMaterials, persistMaterials } from "../../utils/plan-generator"
import { readSession } from "../../utils/session"

/**
 * 生成学习路径：POST /api/learning-path/generate
 *
 * body: { position_id?, generate_content? }
 * - position_id 缺省时取用户已选方向（profile_data.aiDirection）
 * - generate_content = true：为每个缺资料的技能点生成正文，一次请求产出整套关卡
 *
 * 前置条件：大模型必须已配置（generate_content 时），否则直接 503，
 * 不会退化成「全模板路径」——模板对用户没有价值，还会让人以为 AI 真的在工作。
 *
 * 之所以同步生成：一次只要 3 个技能一批、最多 7 关，实测远快于加轮询的复杂度；
 * 超时由 plan-generator 的总预算兜底，保证接口一定有返回。
 */

interface GenerateBody {
	position_id?: number
	generate_content?: boolean
}

export default defineEventHandler(async (event) => {
	const session = readSession(event)
	if (!session) throw createError({ statusCode: 401, message: "未登录" })

	const user = findUserByAccount(session.account)
	if (!user) throw createError({ statusCode: 401, message: "用户不存在" })

	const body = await readBody<GenerateBody>(event).catch(() => null)

	const profile = findUserProfile(user.id)
	const profileData = parseProfileData(profile?.profile_data ?? null)
	const aiDirection = profileData.aiDirection as
		| { positionId?: number, profile?: { goal?: string | null, level?: string | null } }
		| undefined

	const positionId = Number(body?.position_id ?? aiDirection?.positionId ?? 0)
	if (!Number.isFinite(positionId) || positionId <= 0) {
		throw createError({ statusCode: 400, message: "请选择学习方向" })
	}

	const position = findPositionById(positionId)
	if (!position) throw createError({ statusCode: 404, message: "方向不存在" })

	// 归属校验：AI 生成的岗位属于个人，不能拿别人的
	if (position.owner_user_id !== null && position.owner_user_id !== user.id) {
		throw createError({ statusCode: 403, message: "无权使用该方向" })
	}

	// 已有一条完整路径就直接拒绝，避免同一岗位堆出多条
	const duplicate = findLearningPathsByUser(user.id).find((p) => p.target_position_id === positionId)
	if (duplicate && duplicate.generation_status !== "failed") {
		throw createError({
			statusCode: 409,
			message: `该方向已有学习路径「${duplicate.name}」，请在「关卡路径」页查看或切换`,
		})
	}
	// 上次生成失败的半成品先清掉再重来
	if (duplicate) deleteLearningPath(duplicate.id, user.id)

	const skills = findSkillsByPosition(positionId)
	if (skills.length === 0) {
		throw createError({ statusCode: 400, message: "该方向暂无技能点，请更换方向" })
	}

	// 大模型是强依赖：要生成正文就必须先配好，否则连路径都不建，
	// 免得又产出一条「全是模板」的假路径
	const wantContent = body?.generate_content !== false
	if (wantContent) requireLlm()

	const masteredSkillIds = new Set(
		findUserSkills(user.id).filter((s) => s.status === "mastered").map((s) => s.skill_id),
	)
	const gapSkills = skills.filter((s) => !masteredSkillIds.has(s.id))

	const pathId = createLearningPath(user.id, position.name, positionId)
	updatePathGenerationStatus(pathId, "generating")

	// 先找现成的可读资料：只有「模型写的」才复用，
	// 离线模板（model='stub'）算待升级，配好大模型后重新生成会原地覆盖它
	const resourceIds = new Map<number, { id: number, minutes: number | null }>()
	const replaceById = new Map<number, number>()
	const pending = [] as typeof gapSkills

	for (const skill of gapSkills) {
		// 只复用为当前方向生成的资料：同名技能可能挂在语言完全不同的方向上
		const ready = findReadyResourceBySkill(skill.id, positionId)

		if (ready && ready.model !== "stub") {
			resourceIds.set(skill.id, { id: ready.id, minutes: ready.estimated_minutes })
			continue
		}

		if (ready) replaceById.set(skill.id, ready.id)
		pending.push(skill)
	}

	let generated = 0
	let fallback = 0
	let degraded = false
	/** 实际产出正文的模型名，落库后管理页能看到这条路径是谁写的 */
	let usedModel: string | null = null

	try {
		if (wantContent && pending.length > 0) {
			const result = await generatePlanMaterials(pending, {
				positionName: position.name,
				positionId,
				goal: aiDirection?.profile?.goal ?? profile?.learning_goal ?? null,
				level: aiDirection?.profile?.level ?? null,
				dailyMinutes: getPlanSettings(user.id).dailyMinutes,
			})

			const minutesById = new Map(result.materials.map((m) => [m.skillId, m.minutes]))
			for (const [skillId, resourceId] of persistMaterials(result.materials, replaceById, positionId)) {
				resourceIds.set(skillId, { id: resourceId, minutes: minutesById.get(skillId) ?? null })
			}

			generated = result.generated
			fallback = result.fallback
			degraded = result.degraded
			usedModel = result.model

			console.info(
				`[path] generated path=${pathId} model=${result.model}`
				+ ` ok=${result.generated} stub=${result.fallback} elapsed=${result.elapsedMs}ms`,
			)
		}

		let order = 0
		for (const skill of gapSkills) {
			const hit = resourceIds.get(skill.id)

			// 没走模型时退回已有的外链资料；一个都没有就只留技能点，页面会提示
			if (!hit) {
				const seeded = findResourcesBySkill(skill.id, positionId)[0]
				addLearningPathItem(pathId, skill.id, seeded?.id ?? null, order++, "lesson", seeded?.duration ?? null)
				continue
			}

			addLearningPathItem(pathId, skill.id, hit.id, order++, "lesson", hit.minutes)
		}

		updatePathGenerationStatus(pathId, degraded ? "degraded" : "ready", usedModel)

		return {
			ok: true,
			pathId,
			totalItems: order,
			gapCount: gapSkills.length,
			generated,
			fallback,
			degraded,
		}
	} catch (error) {
		updatePathGenerationStatus(
			pathId,
			"failed",
			null,
			error instanceof Error ? error.message.slice(0, 200) : "生成失败",
		)
		console.error(`[path] generate failed path=${pathId}`, error)

		if (error instanceof PlanGenerationError) {
			throw createError({ statusCode: 502, message: error.message })
		}

		// 配置层面的问题（输出上限太低），直接告诉用户怎么改，不要含糊成「生成失败」
		if (error instanceof LlmTruncatedError) {
			throw createError({ statusCode: 502, message: error.message })
		}

		// 生成途中才发现配置没了（例如并发下管理员点了「清除配置」）
		if (error instanceof LlmNotConfiguredError || error instanceof LlmKeyUnreadableError) {
			throw createError({
				statusCode: 503,
				statusMessage: "LLM_NOT_CONFIGURED",
				message: describeLlmProblem(getLlmStatus()),
				data: { code: "LLM_NOT_CONFIGURED", reason: getLlmStatus().reason },
			})
		}

		throw createError({ statusCode: 500, message: "生成学习路径失败，请重试" })
	}
})
