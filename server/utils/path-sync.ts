/**
 * 图谱 → 学习路线同步。
 *
 * 技能图谱演进（加节点 / 剪枝 / 重排）之后，用户已有的学习路径会停在旧结构上：
 * 新补进来的技能没有对应关卡，被剪掉的节点还占着一关，顺序也还是老的。
 * 这一步负责把路线重新对齐到图谱：
 *
 * 1. 剪枝：图谱里已不存在的节点，只删「还没学」的关卡；学过的保留成历史，
 *    不能因为模型改了图谱就把人家学过的记录抹掉。
 * 2. 补齐：图谱里有、路线里没有的节点，先看有没有为本方向生成过的资料就复用，
 *    没有就现场调模型生成——这一步是最慢的，所以把生成进度转成事件往 SSE 上推。
 * 3. 重排：已学/进行中/复习关保持原有次序，其余按图谱顺序排列。
 *
 * 约定：只同步「这个用户 + 这个方向」的那一条最新路径，没有路径就返回 null，
 * 由调用方决定要不要提示用户先建路径。
 */
import {
	addLearningPathItem,
	deletePathItem,
	findAllSkills,
	findAssessmentRecordsByUser,
	findLearningPathItems,
	findLearningPathsByUser,
	findPositionById,
	findReadyResourceBySkill,
	findSkillsByPosition,
	findUserProfile,
	findUserSkills,
	getPlanSettings,
	parseProfileData,
	reorderPathItems,
} from "../repositories/learning.repository"
import {
	PlanGenerationError,
	generatePlanMaterials,
	persistMaterials,
} from "./plan-generator"
import type { PlanEvent, PlanMaterial, PlanSkill } from "./plan-generator"

/* -------------------------------------------------------------------------- */
/* 事件                                                                        */
/* -------------------------------------------------------------------------- */

export interface PathGenMaterial {
	title: string
	summary: string
	objectives: string[]
	minutes: number
	difficulty: string
	referenceHosts?: string[]
}

/** 生成进度的四个事件，前缀加 path_ 与路径生成端点区分 */
type PathGenProgress = {
	skillId: number
	index: number
	total: number
	name: string
	attempt?: number
	reason?: string
	done?: number
	elapsedMs?: number
	material?: PathGenMaterial
}

export type PathSyncEvent =
	| {
		type: "path_start"
		pathId: number
		pathName: string
		totalSkills: number
		addedSkills: number
		needGenerate: number
	}
	| ({ type: "path_skill_start" | "path_skill_done" | "path_skill_retry" | "path_skill_fail" } & PathGenProgress)
	| { type: "path_removed", skillId: number | null, name: string }
	| {
		type: "path_added"
		skillId: number
		name: string
		index: number
		total: number
		resourceId: number | null
		reused: boolean
		material: PathGenMaterial | null
	}
	| { type: "path_done", result: PathSyncResult }

export interface PathSyncResult {
	pathId: number
	pathName: string
	added: { skillId: number, name: string, reused: boolean }[]
	removed: { skillId: number | null, name: string }[]
	/** 有节点没拿到资料（模型失败），路线已建但缺内容 */
	failed: string[]
	reused: number
	generated: number
	reordered: boolean
	error: string | null
}

export interface PathSyncOptions {
	onEvent?: (event: PathSyncEvent) => void
	signal?: AbortSignal
}

/* -------------------------------------------------------------------------- */
/* 内部工具                                                                    */
/* -------------------------------------------------------------------------- */

const PROGRESS_TYPES = new Set(["skill_start", "skill_done", "skill_retry", "skill_fail"])

function toPathEvent(event: PlanEvent): PathSyncEvent | null {
	if (!PROGRESS_TYPES.has(event.type)) return null
	const { type, ...rest } = event
	return { type: `path_${type}`, ...rest } as PathSyncEvent
}

/**
 * 最终顺序。
 *
 * 已学完的排最前（保持原先后）、正在学的紧随其后、没学的按图谱顺序、复习关垫底。
 * 这样图谱一改，用户看到的新顺序立刻生效，但已学部分不会前后乱跳。
 */
function computeOrder(
	items: { id: number, skill_id: number | null, sort_order: number, status: string, item_type: string }[],
	skills: { id: number }[],
): number[] {
	const skillRank = new Map(skills.map((skill, index) => [skill.id, index]))

	const groupOf = (item: { status: string, item_type: string }) => {
		if (item.status === "completed") return 0
		if (item.status === "in_progress") return 1
		if (item.item_type === "review") return 3
		return 2
	}

	return [...items]
		.sort((a, b) => {
			const groupDiff = groupOf(a) - groupOf(b)
			if (groupDiff !== 0) return groupDiff
			// 待学部分跟着图谱顺序走
			if (groupOf(a) === 2) {
				const rankA = a.skill_id !== null ? skillRank.get(a.skill_id) ?? 10_000 : 10_000
				const rankB = b.skill_id !== null ? skillRank.get(b.skill_id) ?? 10_000 : 10_000
				if (rankA !== rankB) return rankA - rankB
			}
			return a.sort_order - b.sort_order
		})
		.map((item) => item.id)
}

/* -------------------------------------------------------------------------- */
/* 主流程                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * 按当前技能图谱重建（对齐）该用户在某方向上的学习路径。
 *
 * @returns 同步结果；用户在该方向还没有路径时返回 null
 */
export async function syncPathWithGraph(
	userId: number,
	positionId: number,
	options: PathSyncOptions = {},
): Promise<PathSyncResult | null> {
	const emit = options.onEvent ?? (() => {})

	const candidates = findLearningPathsByUser(userId)
		.filter((item) => item.target_position_id === positionId && item.status !== "archived")
	const path = candidates.find((item) => item.status === "active") ?? candidates[0]
	if (!path) return null

	// 已掌握的技能不进路径（和首次生成保持一致）
	const mastered = new Set(
		findUserSkills(userId).filter((skill) => skill.status === "mastered").map((skill) => skill.skill_id),
	)
	const skills = findSkillsByPosition(positionId).filter((skill) => !mastered.has(skill.id))
	if (skills.length === 0) return null

	const skillNameById = new Map(findAllSkills().map((skill) => [skill.id, skill.name]))
	const items = findLearningPathItems(path.id)
	const graphIds = new Set(skills.map((skill) => skill.id))

	// --- 1) 剪枝：图谱里没有的节点，删掉还没学的关卡 ---
	const removed: PathSyncResult["removed"] = []
	for (const item of items) {
		if (item.skill_id === null || graphIds.has(item.skill_id)) continue
		if (item.status !== "pending") continue
		try {
			deletePathItem(item.id)
		} catch {
			continue
		}
		const name = skillNameById.get(item.skill_id) ?? `技能 ${item.skill_id}`
		removed.push({ skillId: item.skill_id, name })
		emit({ type: "path_removed", skillId: item.skill_id, name })
	}

	// --- 2) 找缺口：图谱里有、路线里没有 ---
	const remaining = findLearningPathItems(path.id)
	const covered = new Set(remaining.map((item) => item.skill_id).filter((id): id is number => id !== null))
	const missing = skills.filter((skill) => !covered.has(skill.id))

	const resourceById = new Map<number, { id: number, minutes: number | null }>()
	const replaceById = new Map<number, number>()
	const needGenerate: PlanSkill[] = []
	for (const skill of missing) {
		const ready = findReadyResourceBySkill(skill.id, positionId)
		if (ready && ready.model !== "stub") {
			resourceById.set(skill.id, { id: ready.id, minutes: ready.estimated_minutes })
			continue
		}
		// 之前只生成了离线模板的，这次原地升级，不额外堆一份
		if (ready) replaceById.set(skill.id, ready.id)
		needGenerate.push(skill)
	}

	emit({
		type: "path_start",
		pathId: path.id,
		pathName: path.name,
		totalSkills: skills.length,
		addedSkills: missing.length,
		needGenerate: needGenerate.length,
	})

	// --- 3) 缺资料的现场生成 ---
	let materials: PlanMaterial[] = []
	let generated = 0
	let error: string | null = null

	if (needGenerate.length > 0) {
		const position = findPositionById(positionId)
		const profile = findUserProfile(userId)
		const profileData = parseProfileData(profile?.profile_data ?? null)
		const aiDirection = profileData.aiDirection as { profile?: { goal?: string | null, level?: string | null } } | undefined
		const suggestedTopics = Array.isArray(profileData.suggestedTopics)
			? profileData.suggestedTopics.filter((item): item is string => typeof item === "string")
			: undefined
		const latestAssessment = findAssessmentRecordsByUser(userId)[0] ?? null
		const assessmentResult = latestAssessment?.result_data
			? (safeParse(latestAssessment.result_data) as { strengths?: string[], weaknesses?: string[], recommendation?: string } | null)
			: null

		try {
			const result = await generatePlanMaterials(
				needGenerate,
				{
					positionName: position?.name ?? path.name,
					positionId,
					goal: aiDirection?.profile?.goal ?? profile?.learning_goal ?? null,
					level: aiDirection?.profile?.level ?? null,
					dailyMinutes: getPlanSettings(userId).dailyMinutes,
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
					signal: options.signal,
					onProgress: (event) => {
						const mapped = toPathEvent(event)
						if (mapped) emit(mapped)
					},
				},
			)
			materials = result.materials
			generated = result.generated
		} catch (err) {
			if (err instanceof PlanGenerationError) {
				// 已烧掉 token 的部分不浪费，先落库，剩下的留作失败提示
				materials = err.partialMaterials
			}
			error = err instanceof Error ? err.message : "生成关卡资料失败"
		}
	}

	if (materials.length > 0) {
		const ids = persistMaterials(materials, new Map(), positionId)
		for (const material of materials) {
			const resourceId = ids.get(material.skillId)
			if (resourceId === undefined) continue
			resourceById.set(material.skillId, { id: resourceId, minutes: material.minutes })
		}
	}

	// --- 4) 建关卡并回传，让前端能逐条看到新节点长出来 ---
	const added: PathSyncResult["added"] = []
	const failed: string[] = []
	const total = skills.length

	skills.forEach((skill) => {
		if (covered.has(skill.id)) return

		const hit = resourceById.get(skill.id)
		if (!hit) {
			failed.push(skill.name)
			return
		}

		const reused = !materials.some((material) => material.skillId === skill.id)
		addLearningPathItem(path.id, skill.id, hit.id, Number.MAX_SAFE_INTEGER, "lesson", hit.minutes)
		added.push({ skillId: skill.id, name: skill.name, reused })
		emit({
			type: "path_added",
			skillId: skill.id,
			name: skill.name,
			index: skills.findIndex((item) => item.id === skill.id) + 1,
			total,
			resourceId: hit.id,
			reused,
			material: materials.find((material) => material.skillId === skill.id)
				? summarizeForClient(materials.find((material) => material.skillId === skill.id)!)
				: null,
		})
	})

	// --- 5) 重排 ---
	const finalItems = findLearningPathItems(path.id)
	const order = computeOrder(finalItems, skills)
	reorderPathItems(path.id, order)

	const result: PathSyncResult = {
		pathId: path.id,
		pathName: path.name,
		added,
		removed,
		failed,
		reused: added.filter((item) => item.reused).length,
		generated,
		reordered: true,
		error,
	}

	emit({ type: "path_done", result })
	return result
}

function summarizeForClient(material: PlanMaterial): PathGenMaterial {
	return {
		title: material.title,
		summary: material.summary,
		objectives: material.objectives,
		minutes: material.minutes,
		difficulty: material.difficulty,
		referenceHosts: material.references.slice(0, 3).map((ref) => {
			try {
				return new URL(ref.url).hostname.replace(/^www\./, "")
			} catch {
				return ref.publisher
			}
		}),
	}
}

function safeParse(raw: string): unknown {
	try {
		return JSON.parse(raw)
	} catch {
		return null
	}
}
