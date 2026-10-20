import type { DirectionCandidate, DirectionNewSkill } from "#shared/types/direction"
import { asRecord, clampInt, LlmFormatError, str } from "./llm-json"

/**
 * 方向候选的规范化：把模型的原始输出修成可信结构。
 *
 * 平台定位是「想学什么都能学」，所以技能点**不再受技能库限制**：
 * - 模型给 `skillIds` 且 id 在库里 → 直接复用现有技能（省得库里长出一堆同义条目）
 * - 模型给 `newSkills`（或 `skillNames`）里的名字 → 库里同名就复用，没有就留作新技能，选中落库
 * - 两者合计至少 3 个，最多 8 个（每个技能点都会生成一关，太多会让生成时间失控）
 *
 * 单独成文件是为了能在不碰数据库/网络的情况下单测。
 */

/** 每个方向的技能点上限（= 关卡上限） */
const MAX_SKILLS = 8
/** 达不到这个数量就没法排出一条像样的路径 */
const MIN_SKILLS = 3

export interface DirectionCatalog {
	ids: Set<number>
	/** id -> 分类 */
	categoryOf: Map<number, string>
	/** id -> 名称 */
	nameOf: Map<number, string>
	/** 归一化名称 -> id（用于复用库里已有的同名技能） */
	idByName: Map<string, number>
}

/** 比较技能名用的归一化：忽略大小写与空白 */
export function skillKey(name: string): string {
	return name.trim().toLowerCase().replace(/\s+/g, "")
}

/** 分类不再限定枚举：模型说什么领域就存什么，兜底用目录分类或「其他」 */
export function normalizeCategory(value: unknown, fallback: string): string {
	if (typeof value === "string") {
		const trimmed = value.trim().replace(/\s+/g, " ").slice(0, 12)
		if (trimmed) return trimmed
	}
	return fallback
}

/** 把模型给的技能条目（字符串或 {name,level}）读成统一结构 */
function readSkillEntry(entry: unknown): { name: string, level: number } | null {
	if (typeof entry === "string") {
		const name = entry.trim()
		return name.length >= 2 ? { name, level: 1 } : null
	}
	if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null

	const record = entry as Record<string, unknown>
	const rawName = record.name ?? record.skill ?? record.title
	if (typeof rawName !== "string") return null
	const name = rawName.trim().replace(/\s+/g, " ")
	if (name.length < 2) return null

	return { name: name.slice(0, 30), level: clampInt(record.level, 1, 3, 1) }
}

/**
 * 规范化方向列表。任何不可修复的问题都抛 LlmFormatError，由调用方重试或报错。
 */
export function normalizeDirections(raw: unknown, catalog: DirectionCatalog): DirectionCandidate[] {
	if (!Array.isArray(raw)) throw new LlmFormatError("directions 不是数组")

	const result: DirectionCandidate[] = []

	for (const item of raw.slice(0, 3)) {
		const record = asRecord(item)
		const name = str(record.name, 2, 24, "direction.name")
		const reason = str(record.reason, 6, 160, "direction.reason")

		const rawIds = Array.isArray(record.skillIds)
			? record.skillIds.map((id) => Number(id)).filter((id) => catalog.ids.has(id))
			: []
		const skillIds = [...new Set(rawIds)]

		// 已经用上的技能名，避免新技能和库里的重复
		const taken = new Set(skillIds.map((id) => skillKey(catalog.nameOf.get(id) ?? "")))
		const newSkills: DirectionNewSkill[] = []

		const pushSkill = (entry: unknown) => {
			if (skillIds.length + newSkills.length >= MAX_SKILLS) return

			const parsed = readSkillEntry(entry)
			if (!parsed) return

			const key = skillKey(parsed.name)
			if (!key || taken.has(key)) return

			// 库里已有同名技能 → 当成 id 复用，不重复建
			const existingId = catalog.idByName.get(key)
			if (existingId) {
				if (!skillIds.includes(existingId)) skillIds.push(existingId)
				taken.add(key)
				return
			}

			newSkills.push(parsed)
			taken.add(key)
		}

		// 模型可能用 newSkills / skillNames 两种键表达「库里没有的技能」
		for (const entry of Array.isArray(record.newSkills) ? record.newSkills : []) pushSkill(entry)
		for (const entry of Array.isArray(record.skillNames) ? record.skillNames : []) pushSkill(entry)

		const total = skillIds.length + newSkills.length
		if (total < MIN_SKILLS) {
			throw new LlmFormatError(`方向「${name}」技能不足（${total} 个，至少 ${MIN_SKILLS} 个）`)
		}

		const levelsRaw = record.skillLevels && typeof record.skillLevels === "object"
			? record.skillLevels as Record<string, unknown>
			: {}
		const skillLevels: Record<string, number> = {}
		for (const id of skillIds) {
			skillLevels[String(id)] = clampInt(levelsRaw[String(id)], 1, 3, 1)
		}

		const fallbackCategory = skillIds.length > 0
			? catalog.categoryOf.get(skillIds[0] as number) ?? "其他"
			: "其他"

		const previewSkills = [
			...skillIds.map((id) => catalog.nameOf.get(id) ?? ""),
			...newSkills.map((skill) => skill.name),
		].filter(Boolean).slice(0, 6)

		result.push({
			name,
			category: normalizeCategory(record.category, fallbackCategory),
			reason,
			matchScore: clampInt(record.matchScore, 0, 100, 70),
			skillIds: skillIds.slice(0, MAX_SKILLS),
			skillLevels,
			newSkills: newSkills.length > 0 ? newSkills : undefined,
			previewSkills,
			estimatedWeeks: clampInt(record.estimatedWeeks, 4, 24, 10),
		})
	}

	if (result.length === 0) throw new LlmFormatError("没有可用的方向")
	return result
}

/** 方向里的技能总数（前端展示「N 个技能」用） */
export function countDirectionSkills(direction: DirectionCandidate): number {
	return direction.skillIds.length + (direction.newSkills?.length ?? 0)
}
