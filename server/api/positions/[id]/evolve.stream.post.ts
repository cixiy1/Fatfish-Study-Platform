import {
	findPositionById,
	findSkillsByPosition,
	findUserProfile,
	findUserSkills,
	parseProfileData,
} from "../../../repositories/learning.repository"
import { findUserByAccount } from "../../../repositories/user.repository"
import { chatStream } from "../../../utils/llm"
import { requireLlm } from "../../../utils/llm-guard"
import { readSession } from "../../../utils/session"
import { openSse } from "../../../utils/sse"
import {
	applyEvolveProposal,
	MAX_EVOLVE_ADD,
	MAX_EVOLVE_PRUNE,
	parseEvolveProposal,
} from "../../../utils/skill-evolve"

/**
 * 技能图谱演进（流式）：POST /api/positions/:id/evolve.stream
 *
 * 与 analyze 的区别：analyze 只改「用户掌握状态」（user_skills），
 * 这里改的是**图谱结构本身**（position_skills / skills）：
 * - add     补进缺失的技能节点
 * - relevel 调整要求等级
 * - reorder 按更合理的学习先后来重排
 * - prune   摘掉与该方向无关的节点
 *
 * SSE 事件：chunk（模型思考文本）→ proposal（解析出的 diff）→ done（实际落库结果）→ error
 */

interface AssessmentSnapshot {
	careerDirection?: string
	strengths?: string[]
	weaknesses?: string[]
	recommendation?: string
	suggestedTopics?: string[]
}

export default defineEventHandler(async (event) => {
	const session = readSession(event)
	if (!session) throw createError({ statusCode: 401, message: "未登录" })

	const user = findUserByAccount(session.account)
	if (!user) throw createError({ statusCode: 401, message: "用户不存在" })

	const positionId = Number(getRouterParam(event, "id"))
	const position = findPositionById(positionId)
	if (!position) throw createError({ statusCode: 404, message: "岗位不存在" })

	requireLlm()

	const currentSkills = findSkillsByPosition(positionId)
	if (currentSkills.length === 0) {
		throw createError({ statusCode: 400, message: "该方向还没有技能节点，无法演进" })
	}

	const body = await readBody<{ hint?: string }>(event).catch(() => null)
	const hint = typeof body?.hint === "string" ? body.hint.trim().slice(0, 120) : ""

	// --- 上下文：学习者状态 + 测评结论 ---
	const userSkillMap = new Map(findUserSkills(user.id).map((s) => [s.skill_id, s.status]))
	const profile = findUserProfile(user.id)
	const profileData = parseProfileData(profile?.profile_data ?? null)
	const lastAssessment = profileData.lastAssessment as AssessmentSnapshot | undefined
	const suggestedTopics = Array.isArray(profileData.suggestedTopics)
		? profileData.suggestedTopics.filter((item): item is string => typeof item === "string")
		: []
	const goal = (profileData.aiDirection as { profile?: { goal?: string | null } } | undefined)?.profile?.goal ?? ""

	const statusLabel = (skillId: number) => {
		const status = userSkillMap.get(skillId)
		return status === "mastered" ? "已掌握" : status === "learning" ? "学习中" : "未开始"
	}

	const skillLines = currentSkills.map((skill, index) =>
		`${index + 1}. ${skill.name}｜要求等级 ${skill.required_level}｜学习者：${statusLabel(skill.id)}`
		+ (skill.description ? `｜${skill.description}` : "")
	).join("\n")

	const assessmentLines = [
		lastAssessment?.careerDirection ? `- 测评给出的方向：${lastAssessment.careerDirection}` : "",
		lastAssessment?.strengths?.length ? `- 优势：${lastAssessment.strengths.join("、")}` : "",
		lastAssessment?.weaknesses?.length ? `- 待补强：${lastAssessment.weaknesses.join("、")}` : "",
		lastAssessment?.recommendation ? `- 学习建议：${lastAssessment.recommendation}` : "",
		suggestedTopics.length > 0 ? `- 建议先学的主题：${suggestedTopics.join("、")}` : "",
	].filter(Boolean)

	const messages = [
		{
			role: "system" as const,
			content: [
				"你是学习路径设计专家，负责在既有技能图谱上做**增量演进**，而不是推倒重来。",
				"硬性规则：",
				"1. 只做必要的改动；现有节点能覆盖的就不要新增。",
				"2. add 里的技能名必须是**具体的、可检索的学习单元**（如「Flexbox 布局入门」），不要写领域名。",
				"3. prune 只允许摘掉与本方向明显无关的节点，且必须给理由；拿不准就不要剪。",
				"4. reorder 要按学习先后顺序排，前置知识在前。",
				"5. 先用自然语言简要说明判断（2~3 句），然后输出 JSON 对象，用 ```json 代码块包裹。",
			].join("\n"),
		},
		{
			role: "user" as const,
			content: [
				`方向：${position.name}（${position.category}）`,
				position.description ? `方向说明：${position.description}` : "",
				"",
				"当前技能图谱（按顺序）：",
				skillLines,
				"",
				assessmentLines.length > 0 ? "测评结论：" : "测评结论：暂无测评记录",
				...assessmentLines,
				"",
				`学习目标：${goal || "未设定"}`,
				hint ? `额外要求：${hint}` : "",
				"",
				"请给出这份图谱的演进方案。先简要说明判断，然后输出 JSON：",
				"```json",
				"{",
				`  "summary":"60字内的演进说明",`,
				`  "add":[{"name":"新技能名","level":1,"description":"20字内","after":"插在哪个已有技能之后，可为空字符串","reason":"20字内"}],`,
				`  "relevel":[{"name":"已有技能名","requiredLevel":2,"reason":"20字内"}],`,
				`  "reorder":["按建议学习顺序排列的技能名（含新增）"],`,
				`  "prune":[{"name":"要摘掉的已有技能名","reason":"20字内"}]`,
				"}",
				"```",
				"",
				"字段要求：",
				`- add 最多 ${MAX_EVOLVE_ADD} 条，prune 最多 ${MAX_EVOLVE_PRUNE} 条；没有改动就给空数组`,
				"- 名字要与「当前技能图谱」里的名字完全一致，写错的名字会被丢弃",
				"- reorder 里要包含演进后的全部技能名",
			].filter(Boolean).join("\n"),
		},
	]

	const sse = openSse(event)
	let fullText = ""

	try {
		for await (const chunk of chatStream({
			messages,
			temperature: 0.3,
			maxTokens: 8192,
			timeoutMs: 90_000,
			tag: `skill-evolve:${user.id}:${positionId}`,
			signal: sse.signal,
		})) {
			fullText += chunk
			sse.write("chunk", { text: chunk })
		}

		const proposal = parseEvolveProposal(fullText)

		if (!proposal) {
			// 模型没吐出可解析的 JSON：把纯文本当结论回传，不动图谱
			sse.write("done", {
				applied: false,
				summary: fullText.replace(/```json[\s\S]*?```/g, "").trim().slice(0, 300) || "模型未给出可解析的演进方案",
				added: [],
				releveled: [],
				reordered: 0,
				pruned: [],
			})
			return
		}

		sse.write("proposal", {
			summary: proposal.summary,
			add: proposal.add,
			relevel: proposal.relevel,
			reorder: proposal.reorder,
			prune: proposal.prune,
			changed: (proposal.add.length + proposal.relevel.length + proposal.prune.length + proposal.reorder.length) > 0,
		})

		const applied = applyEvolveProposal(
			positionId,
			position.category,
			proposal,
			currentSkills.map((skill) => ({
				id: skill.id,
				name: skill.name,
				description: skill.description ?? null,
				level: skill.required_level,
			})),
		)

		console.info(
			`[skill-evolve] user=${user.id} pos=${positionId} 新增 ${applied.added.length} 调级 ${applied.releveled.length} 重排 ${applied.reordered} 剪枝 ${applied.pruned.length}`,
		)

		sse.write("done", {
			applied: true,
			summary: proposal.summary,
			...applied,
		})
	} catch (error) {
		const message = error instanceof Error ? error.message : "演进失败"
		console.warn(`[skill-evolve] failed user=${user.id} pos=${positionId} error=${message}`)
		sse.write("error", { message })
	} finally {
		sse.close()
	}
})
