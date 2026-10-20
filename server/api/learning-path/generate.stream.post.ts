import {
	addLearningPathItem,
	createLearningPath,
	deleteLearningPath,
	findAssessmentRecordsByUser,
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
import { openSse } from "../../utils/sse"

/**
 * 生成学习路径（流式）：POST /api/learning-path/generate.stream
 *
 * 与非流式端点 /generate 语义一致（同一套落库与失败处理），
 * 区别是边生成边推送进度事件，前端可以「一条一条逐渐渲染」而不是干等转圈。
 *
 * 事件：
 * - start       总览（技能数量与清单），前端据此铺好槽位
 * - skill_start / skill_retry / skill_done / skill_fail  单个技能点的状态变化
 * - done        全部完成
 * - error       失败（带 code 与 partial.missing，前端可保留已渲染的卡片只重试缺失项）
 *
 * 两条硬约束：
 * 1. skill_done 不携带正文（content 最长 6000 字，塞进 SSE 会撑爆前端），正文由 /learn/{itemId} 读
 * 2. 进入流之后 HTTP 状态码已确定，**绝不能再 createError**，一切异常翻译成 error 事件
 */

interface GenerateBody {
	position_id?: number
}

interface StreamError {
	message: string
	code: string
	status: number
	partial?: { done: number, total: number, missing: string[] }
}

export default defineEventHandler(async (event) => {
	const session = readSession(event)
	const body = await readBody<GenerateBody>(event).catch(() => null)

	// 流还没开：这里可以正常抛 HTTP 错误
	if (!session) throw createError({ statusCode: 401, message: "未登录" })

	const user = findUserByAccount(session.account)
	if (!user) throw createError({ statusCode: 401, message: "用户不存在" })

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

	if (position.owner_user_id !== null && position.owner_user_id !== user.id) {
		throw createError({ statusCode: 403, message: "无权使用该方向" })
	}

	const duplicate = findLearningPathsByUser(user.id).find((p) => p.target_position_id === positionId)
	if (duplicate && duplicate.generation_status !== "failed") {
		throw createError({
			statusCode: 409,
			message: `该方向已有学习路径「${duplicate.name}」，请在「关卡路径」页查看或切换`,
		})
	}
	if (duplicate) deleteLearningPath(duplicate.id, user.id)

	const skills = findSkillsByPosition(positionId)
	if (skills.length === 0) {
		throw createError({ statusCode: 400, message: "该方向暂无技能点，请更换方向" })
	}

	// 大模型是强依赖：不配好就不开始，避免产出全是模板的假路径
	try {
		requireLlm()
	} catch (error) {
		const message = error instanceof Error ? error.message : describeLlmProblem(getLlmStatus())
		throw createError({ statusCode: 503, statusMessage: "LLM_NOT_CONFIGURED", message })
	}

	const masteredSkillIds = new Set(
		findUserSkills(user.id).filter((s) => s.status === "mastered").map((s) => s.skill_id),
	)
	const gapSkills = skills.filter((s) => !masteredSkillIds.has(s.id))

	const pathId = createLearningPath(user.id, position.name, positionId)
	updatePathGenerationStatus(pathId, "generating")

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

	// 测评结论注入生成上下文，让内容难度真的受测评影响
	const latestAssessment = findAssessmentRecordsByUser(user.id)[0] ?? null
	const assessmentResult = latestAssessment?.result_data
		? (safeParse(latestAssessment.result_data) as {
			strengths?: string[], weaknesses?: string[], recommendation?: string
		} | null)
		: null
	const suggestedTopics = Array.isArray(profileData.suggestedTopics)
		? (profileData.suggestedTopics as string[])
		: undefined

	const sse = openSse(event)

	try {
		sse.write("start", {
			total: pending.length,
			pathId,
			positionName: position.name,
			items: pending.map((skill, index) => ({
				skillId: skill.id,
				index: index + 1,
				name: skill.name,
				difficulty: skill.level,
			})),
		})

		// 一个技能点一次调用，事件与技能一一对应，前端按槽位就地更新
		const result = await generatePlanMaterials(
			pending,
			{
				positionName: position.name,
				positionId,
				goal: aiDirection?.profile?.goal ?? profile?.learning_goal ?? null,
				level: aiDirection?.profile?.level ?? null,
				dailyMinutes: getPlanSettings(user.id).dailyMinutes,
				suggestedTopics,
				assessment: assessmentResult
					? {
							strengths: assessmentResult.strengths ?? [],
							weaknesses: assessmentResult.weaknesses ?? [],
							recommendation: assessmentResult.recommendation ?? "",
						}
					: null,
			},
			{
				chunkSize: 1,
				concurrency: 2,
				signal: sse.signal,
				onProgress: (progress) => {
					sse.write(progress.type, progress)
				},
			},
		)

		const minutesById = new Map(result.materials.map((m) => [m.skillId, m.minutes]))
		for (const [skillId, resourceId] of persistMaterials(result.materials, replaceById, positionId)) {
			resourceIds.set(skillId, { id: resourceId, minutes: minutesById.get(skillId) ?? null })
		}

		let order = 0
		for (const skill of gapSkills) {
			const hit = resourceIds.get(skill.id)
			if (!hit) {
				const seeded = findResourcesBySkill(skill.id, positionId)[0]
				addLearningPathItem(pathId, skill.id, seeded?.id ?? null, order++, "lesson", seeded?.duration ?? null)
				continue
			}
			addLearningPathItem(pathId, skill.id, hit.id, order++, "lesson", hit.minutes)
		}

		updatePathGenerationStatus(pathId, result.degraded ? "degraded" : "ready", result.model)

		sse.write("done", {
			pathId,
			totalItems: order,
			generated: result.generated,
			fallback: result.fallback,
			degraded: result.degraded,
			model: result.model,
			elapsedMs: result.elapsedMs,
		})
	} catch (error) {
		const failure = toStreamError(error, resourceIds.size, pending.length)

		// 补偿落库：已烧掉 token 产出的资料不要浪费，下次重试会自动复用
		if (error instanceof PlanGenerationError && error.partialMaterials.length > 0) {
			try {
				for (const [skillId, resourceId] of persistMaterials(error.partialMaterials, replaceById, positionId)) {
					resourceIds.set(skillId, { id: resourceId, minutes: null })
				}
			} catch (persistError) {
				console.warn("[path] 失败补偿落库失败", persistError)
			}
		}

		updatePathGenerationStatus(pathId, "failed", null, failure.message.slice(0, 200))
		console.error(`[path] stream generate failed path=${pathId}`, error)
		sse.write("error", failure)
	} finally {
		sse.close()
	}
})

function safeParse(text: string): unknown {
	try {
		return JSON.parse(text)
	} catch {
		return null
	}
}

/** 把异常翻译成 error 事件载荷（含 HTTP 语义的 status，便于前端复用既有错误分支） */
function toStreamError(error: unknown, done: number, total: number): StreamError {
	const partial = { done, total, missing: [] as string[] }

	if (error instanceof PlanGenerationError) {
		return {
			message: error.message,
			code: "PLAN_INCOMPLETE",
			status: 502,
			partial: { ...partial, missing: error.failedSkills },
		}
	}

	if (error instanceof LlmTruncatedError) {
		return {
			message: error.message,
			code: "LLM_TRUNCATED",
			status: 502,
			partial,
		}
	}

	if (error instanceof LlmNotConfiguredError || error instanceof LlmKeyUnreadableError) {
		return {
			message: describeLlmProblem(getLlmStatus()),
			code: "LLM_NOT_CONFIGURED",
			status: 503,
			partial,
		}
	}

	if (error instanceof Error && error.message === "ABORTED") {
		return { message: "生成已取消", code: "ABORTED", status: 499, partial }
	}

	return {
		message: error instanceof Error ? error.message : "生成学习路径失败，请重试",
		code: "GENERATE_FAILED",
		status: 500,
		partial,
	}
}
