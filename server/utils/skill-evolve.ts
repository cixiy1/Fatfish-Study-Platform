import {
	addPositionSkill,
	createSkill,
	findSkillByName,
	removePositionSkill,
	updatePositionSkillOrder,
} from "../repositories/learning.repository"
import type { SkillCandidate } from "./skill-link"

/**
 * 技能图谱演进：让大模型在「当前图谱 + 测评结论 + 学习者状态」的基础上，
 * 提出一份**结构化 diff**（增 / 调等级 / 重排 / 剪枝），服务端核对后落库。
 *
 * 为什么是 diff 而不是「重新生成整张图谱」：
 * 整张重生成会把用户已经标了「已掌握」的技能连带 user_skills 状态一起推翻，
 * 也会让已完成的学习路径项失去对应的 skill_id。diff 只动该动的部分。
 *
 * 为什么不让模型直接写库：
 * add 里的技能名必须先在库里核对（同名复用），prune 只能解绑不能删技能本体，
 * 所以模型只负责「提议」，落库全部由这里做，模型给的非法项一律丢弃。
 */

export interface EvolveAdd {
	name: string
	level: number
	description: string
	/** 建议插在哪个已有技能之后；为空则追加到末尾 */
	after: string | null
	reason: string
}

export interface EvolveRelevel {
	name: string
	requiredLevel: number
	reason: string
}

export interface EvolvePrune {
	name: string
	reason: string
}

export interface EvolveProposal {
	summary: string
	add: EvolveAdd[]
	relevel: EvolveRelevel[]
	reorder: string[]
	prune: EvolvePrune[]
}

export interface EvolveApplied {
	added: { skillId: number, name: string }[]
	releveled: { skillId: number, name: string, requiredLevel: number }[]
	reordered: number
	pruned: { skillId: number, name: string }[]
}

export const MAX_EVOLVE_ADD = 5
export const MAX_EVOLVE_PRUNE = 2

interface RawProposal {
	summary?: unknown
	add?: unknown
	relevel?: unknown
	reorder?: unknown
	prune?: unknown
}

function pickString(value: unknown, maxLen: number): string {
	return typeof value === "string" ? value.trim().slice(0, maxLen) : ""
}

function pickInt(value: unknown, fallback: number, min: number, max: number): number {
	const n = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10)
	if (!Number.isFinite(n)) return fallback
	return Math.min(Math.max(Math.trunc(n), min), max)
}

/**
 * 解析模型输出里的演进 JSON。
 *
 * 只做「形状」层面的清洗（类型、长度、数量上限），
 * 名字是否真的存在由 apply 阶段核对——解析阶段没有库上下文。
 */
export function parseEvolveProposal(text: string): EvolveProposal | null {
	try {
		const start = text.indexOf("{")
		const end = text.lastIndexOf("}")
		if (start < 0 || end <= start) return null
		const raw = JSON.parse(text.slice(start, end + 1)) as RawProposal

		const add: EvolveAdd[] = (Array.isArray(raw.add) ? raw.add : [])
			.filter((item): item is Record<string, unknown> => item !== null && typeof item === "object")
			.map((item) => ({
				name: pickString(item.name, 40),
				level: pickInt(item.level, 1, 1, 5),
				description: pickString(item.description, 60),
				after: typeof item.after === "string" && item.after.trim() ? item.after.trim().slice(0, 40) : null,
				reason: pickString(item.reason, 40),
			}))
			.filter((item) => item.name.length > 0)
			.slice(0, MAX_EVOLVE_ADD)

		const relevel: EvolveRelevel[] = (Array.isArray(raw.relevel) ? raw.relevel : [])
			.filter((item): item is Record<string, unknown> => item !== null && typeof item === "object")
			.map((item) => ({
				name: pickString(item.name, 40),
				requiredLevel: pickInt(item.requiredLevel, 1, 1, 5),
				reason: pickString(item.reason, 40),
			}))
			.filter((item) => item.name.length > 0)
			.slice(0, 12)

		const reorder: string[] = (Array.isArray(raw.reorder) ? raw.reorder : [])
			.filter((item): item is string => typeof item === "string")
			.map((item) => item.trim().slice(0, 40))
			.filter((item) => item.length > 0)
			.slice(0, 40)

		const prune: EvolvePrune[] = (Array.isArray(raw.prune) ? raw.prune : [])
			.filter((item): item is Record<string, unknown> => item !== null && typeof item === "object")
			.map((item) => ({
				name: pickString(item.name, 40),
				reason: pickString(item.reason, 40),
			}))
			.filter((item) => item.name.length > 0)
			.slice(0, MAX_EVOLVE_PRUNE)

		return {
			summary: pickString(raw.summary, 120),
			add,
			relevel,
			reorder,
			prune,
		}
	} catch {
		return null
	}
}

/**
 * 把演进 diff 落到 position_skills / skills。
 *
 * @param currentSkills 当前方向上的技能（含 required_level），顺序即现有 sort_order
 * @returns 实际改动，供前端展示「改了什么」
 */
export function applyEvolveProposal(
	positionId: number,
	category: string,
	proposal: EvolveProposal,
	currentSkills: SkillCandidate[],
): EvolveApplied {
	// order 里存的是 skill_id，演进全程维护它，最后一次性写回 sort_order
	const order: number[] = currentSkills.map((skill) => skill.id)
	const levelById = new Map(currentSkills.map((skill) => [skill.id, skill.level]))
	const nameToId = new Map(currentSkills.map((skill) => [skill.name.toLowerCase(), skill.id]))
	const idToName = new Map(currentSkills.map((skill) => [skill.id, skill.name]))

	const applied: EvolveApplied = { added: [], releveled: [], reordered: 0, pruned: [] }

	// 1) 剪枝：只解绑，不删技能本体
	for (const item of proposal.prune) {
		// 图谱不能越剪越空——少于等于 3 个节点时一律不再剪
		if (order.length <= 3) break
		const skillId = nameToId.get(item.name.toLowerCase())
		if (skillId === undefined) continue
		if (!removePositionSkill(positionId, skillId)) continue
		const at = order.indexOf(skillId)
		if (at >= 0) order.splice(at, 1)
		nameToId.delete(item.name.toLowerCase())
		applied.pruned.push({ skillId, name: idToName.get(skillId) ?? item.name })
	}

	// 2) 新增：同名技能复用，绝不重复建
	for (const item of proposal.add) {
		const key = item.name.toLowerCase()
		if (nameToId.has(key)) continue

		const existing = findSkillByName(item.name)
		const skillId = existing
			? existing.id
			: createSkill({
					name: item.name,
					category,
					level: item.level,
					description: item.description || null,
				})

		let at = order.length
		if (item.after) {
			const afterId = nameToId.get(item.after.toLowerCase())
			if (afterId !== undefined) {
				const afterAt = order.indexOf(afterId)
				if (afterAt >= 0) at = afterAt + 1
			}
		}
		order.splice(at, 0, skillId)
		levelById.set(skillId, item.level)
		nameToId.set(key, skillId)
		idToName.set(skillId, item.name)
		applied.added.push({ skillId, name: item.name })
	}

	// 3) 调等级
	for (const item of proposal.relevel) {
		const skillId = nameToId.get(item.name.toLowerCase())
		if (skillId === undefined) continue
		levelById.set(skillId, item.requiredLevel)
		applied.releveled.push({
			skillId,
			name: idToName.get(skillId) ?? item.name,
			requiredLevel: item.requiredLevel,
		})
	}

	// 4) 重排：至少覆盖当前集合的一半才认，防止模型只记得几个名字就把其余的打乱
	if (proposal.reorder.length > 0) {
		const picked: number[] = []
		const seen = new Set<number>()
		for (const name of proposal.reorder) {
			const skillId = nameToId.get(name.toLowerCase())
			if (skillId === undefined || seen.has(skillId)) continue
			seen.add(skillId)
			picked.push(skillId)
		}
		const rest = order.filter((id) => !seen.has(id))
		if (picked.length * 2 >= order.length) {
			order.length = 0
			order.push(...picked, ...rest)
			applied.reordered = picked.length
		}
	}

	// 一次性写回：sort_order + required_level 一起落，保证 add/relevel 都不会丢
	order.forEach((skillId, index) => {
		addPositionSkill(positionId, skillId, levelById.get(skillId) ?? 1, index)
	})

	// 没重排时也要确认 sort_order 正确（剪枝/插入后索引已经变了）
	if (applied.reordered === 0) {
		order.forEach((skillId, index) => updatePositionSkillOrder(positionId, skillId, index))
	}

	return applied
}
