import {
	findAssessmentRecordsByUser,
	findPositionById,
	findSkillsByPosition,
	findUserSkills,
	findUserProfile,
	parseProfileData,
	upsertUserSkill,
} from "../../../repositories/learning.repository"
import { findUserByAccount } from "../../../repositories/user.repository"
import { chatStream } from "../../../utils/llm"
import { requireLlm } from "../../../utils/llm-guard"
import { readSession } from "../../../utils/session"
import { openSse } from "../../../utils/sse"

/**
 * 技能图谱分析（流式）：POST /api/positions/:id/analyze
 *
 * 把用户的测评结果、当前技能状态、岗位技能要求发给大模型，
 * 让它分析：哪些技能已具备、哪些需要补、推荐什么学习顺序。
 * 结果边输出边推送 SSE，完成后联动更新技能状态。
 */

interface SkillAnalysis {
	recommendations: { skillName: string, status: string, reason: string }[]
	summary: string
}

function tryParseSkillAnalysis(text: string): SkillAnalysis | null {
	try {
		const start = text.indexOf("{")
		const end = text.lastIndexOf("}")
		if (start < 0 || end <= start) return null
		const raw = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>
		const recs = Array.isArray(raw.recommendations) ? raw.recommendations : []
		return {
			recommendations: recs
				.filter((r): r is Record<string, unknown> => r !== null && typeof r === "object")
				.map((r) => ({
					skillName: typeof r.skillName === "string" ? r.skillName : "",
					status: typeof r.status === "string" ? r.status : "learning",
					reason: typeof r.reason === "string" ? r.reason : "",
				}))
				.filter((r) => r.skillName),
			summary: typeof raw.summary === "string" ? raw.summary : "",
		}
	} catch {
		return null
	}
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

	const skills = findSkillsByPosition(positionId)
	const userSkills = findUserSkills(user.id)
	const userSkillMap = new Map(userSkills.map((s) => [s.skill_id, s.status]))

	const profile = findUserProfile(user.id)
	const profileData = parseProfileData(profile?.profile_data ?? null)
	const assessmentRecords = findAssessmentRecordsByUser(user.id)

	const assessmentSummary = assessmentRecords.length > 0
		? assessmentRecords.map((r) => r.result_data?.slice(0, 200) ?? "").join("\n")
		: "暂无测评记录"

	const skillList = skills.map((s, i) => {
		const status = userSkillMap.get(s.id) ?? "未开始"
		const desc = s.description ? `（${s.description}）` : ""
		return `${i + 1}. ${s.name}｜要求等级：${s.required_level}｜当前状态：${status}${desc}`
	}).join("\n")

	const messages = [
		{
			role: "system" as const,
			content: [
				"你是技能评估专家，根据学习者的测评结果和当前技能状态，分析技能掌握情况并给出学习建议。",
				"要求：",
				"1. 分析要基于测评结果和技能要求，不要凭空猜测。",
				"2. status 只能是：mastered（已掌握）、learning（学习中）、not_started（未开始）。",
				"3. 先用自然语言简要分析（2~3 句），然后输出 JSON 对象，用 ```json 代码块包裹。",
			].join("\n"),
		},
		{
			role: "user" as const,
			content: [
				`方向：${position.name}（${position.category}）`,
				`方向说明：${position.description ?? ""}`,
				"",
				"当前技能图谱：",
				skillList,
				"",
				"测评结果摘要：",
				assessmentSummary,
				"",
				profileData.aiDirection
					? `用户学习目标：${(profileData.aiDirection as { profile?: { goal?: string | null } }).profile?.goal ?? "未设定"}`
					: "用户学习目标：未设定",
				"",
				"请分析每个技能的掌握情况，并给出学习建议。先简要分析，然后输出 JSON：",
				"```json",
				'{"summary":"整体分析（50字内）","recommendations":[{"skillName":"技能名","status":"mastered|learning|not_started","reason":"15字内的判断依据"}]}',
				"```",
			].join("\n"),
		},
	]

	const sse = openSse(event)
	let fullText = ""

	try {
		for await (const chunk of chatStream({
			messages,
			temperature: 0.4,
			maxTokens: 4096,
			timeoutMs: 60_000,
			tag: `skill-analyze:${user.id}:${positionId}`,
			signal: sse.signal,
		})) {
			fullText += chunk
			sse.write("chunk", { text: chunk })
		}

		const parsed = tryParseSkillAnalysis(fullText)

		if (parsed && parsed.recommendations.length > 0) {
			const skillByName = new Map(skills.map((s) => [s.name.toLowerCase(), s]))
			for (const rec of parsed.recommendations) {
				const skill = skillByName.get(rec.skillName.toLowerCase())
				if (skill && ["mastered", "learning", "not_started"].includes(rec.status)) {
					upsertUserSkill(user.id, skill.id, rec.status, skill.required_level)
				}
			}
			sse.write("done", { analysis: parsed, updated: true })
		} else {
			sse.write("done", {
				analysis: {
					summary: fullText.replace(/```json[\s\S]*?```/g, "").trim().slice(0, 400) || "分析完成",
					recommendations: [],
				},
				updated: false,
			})
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : "分析失败"
		console.warn(`[skill-map] analyze failed user=${user.id} pos=${positionId} error=${message}`)
		sse.write("error", { message })
	} finally {
		sse.close()
	}
})
