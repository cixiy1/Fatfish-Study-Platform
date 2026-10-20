import { chatJson } from "./llm"
import { strArray } from "./llm-json"
import { findSkillByName, upsertUserSkill } from "../repositories/learning.repository"

/**
 * 测评结论 → 技能图谱映射。
 *
 * 为什么需要这一步：此前用「子串包含」把模型写的中文长句（如「先查官方文档，基础打得实」）
 * 去匹配技能名（如「写出第一个 HTML 页面」），中文短句与技能名之间是语义鸿沟，
 * 实测命中率接近 0，导致 assessment → user_skills 这条链路形同虚设。
 *
 * 这里改成让模型从「候选技能列表」里挑，再用 findSkillByName 精确核对后才落库
 * ——不信任模型的自由文本，挑不出来就不写。
 */

export interface SkillCandidate {
	id: number
	name: string
	description: string | null
	level: number
}

export interface SkillLinkInput {
	strengths: string[]
	weaknesses: string[]
	suggestedTopics: string[]
	recommendation: string
	candidates: SkillCandidate[]
}

export interface SkillLink {
	skillId: number
	name: string
	status: "mastered" | "not_started"
	/** 判定依据，展示给用户看 */
	evidence: string
}

interface SkillLinkPayload {
	links?: unknown
}

/**
 * 让模型把测评结论映射到候选技能上。
 *
 * 失败一律返回空数组（联动是增益不是必需），由调用方决定是否展示提示。
 */
export async function mapConclusionToSkills(input: SkillLinkInput): Promise<SkillLink[]> {
	const candidates = input.candidates.slice(0, 12)
	if (candidates.length === 0) return []

	const list = candidates.map((skill, index) => `${index + 1}. ${skill.name}`).join("\n")

	try {
		const result = await chatJson<SkillLinkPayload>({
			messages: [
				{
					role: "system",
					content: [
						"你要把「能力测评结论」映射到给定的技能列表上。",
						"只能从候选列表里挑，绝不能自创技能名；没把握的宁可不选。",
						"只输出 JSON 对象，不要 Markdown 代码块。",
					].join("\n"),
				},
				{
					role: "user",
					content: [
						"测评结论：",
						`- 优势：${input.strengths.join("、") || "（无）"}`,
						`- 待补强：${input.weaknesses.join("、") || "（无）"}`,
						`- 建议先学：${input.suggestedTopics.join("、") || "（无）"}`,
						`- 学习建议：${input.recommendation}`,
						"",
						"候选技能列表（只能从里面挑）：",
						list,
						"",
						"请判断哪些技能学习者已经具备、哪些还没开始学，输出：",
						'{"links":[{"name":"技能名（必须与候选列表完全一致）","status":"mastered|not_started","evidence":"20字内的判断依据"}]}',
						"",
						"要求：",
						"- name 必须与候选列表中的名字完全一致，不一致的项会被丢弃",
						"- 最多 6 条，没把握的不要选；一个技能只能出现一次",
						"- 完全没有可判断的就输出 {\"links\":[]}",
					].join("\n"),
				},
			],
			temperature: 0.2,
			maxTokens: 1500,
			timeoutMs: 30_000,
			maxAttempts: 2,
			tag: "skill-link",
			allowMockOnError: false,
			validate: (value) => ({
				links: Array.isArray((value as SkillLinkPayload).links)
					? (value as SkillLinkPayload).links
					: [],
			}),
			mock: () => ({ links: [] }),
		})

		if (result.mock) return []

		const candidatesByName = new Map(candidates.map((skill) => [skill.name.toLowerCase(), skill]))
		const links: SkillLink[] = []
		const seen = new Set<number>()

		for (const raw of result.data.links ?? []) {
			if (typeof raw !== "object" || raw === null) continue
			const record = raw as { name?: unknown, status?: unknown, evidence?: unknown }
			const name = typeof record.name === "string" ? record.name.trim() : ""
			if (!name) continue

			// 不信任模型的自由文本：必须能在候选里精确对上
			const candidate = candidatesByName.get(name.toLowerCase())
			if (!candidate || seen.has(candidate.id)) continue

			// 再用库里的同名技能复核一次（NOCASE），防止候选列表与库不同步
			const stored = findSkillByName(candidate.name)
			if (!stored) continue

			const status = record.status === "mastered" ? "mastered" : "not_started"
			links.push({
				skillId: stored.id,
				name: stored.name,
				status,
				evidence: typeof record.evidence === "string"
					? strArray([record.evidence], 0, 1, 40, "evidence")[0] ?? ""
					: "",
			})
			seen.add(stored.id)
		}

		return links
	} catch (error) {
		console.warn("[skill-link] 测评结论映射失败", error instanceof Error ? error.message : error)
		return []
	}
}

/** 把映射结果写进 user_skills */
export function applySkillLinks(
	userId: number,
	links: SkillLink[],
	levelById: Map<number, number>,
): number {
	let applied = 0
	for (const link of links) {
		upsertUserSkill(userId, link.skillId, link.status, levelById.get(link.skillId) ?? 2)
		applied += 1
	}
	return applied
}
