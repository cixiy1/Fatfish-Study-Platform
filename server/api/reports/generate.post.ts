import { createLearningReport } from "../../repositories/learning.repository"
import { findUserByAccount } from "../../repositories/user.repository"
import { chatJson } from "../../utils/llm"
import {
	buildFallbackSummary,
	buildReportMessages,
	buildReportStats,
	validateNarrative,
} from "../../utils/report-stats"
import type { ReportNarrative } from "../../utils/report-stats"
import { readSession } from "../../utils/session"

/**
 * 生成学习复盘（非流式）：POST /api/reports/generate
 *
 * 分工：
 * - 数字（进度、掌握率、分类分布）由数据库算，保证真实；
 * - 叙述（总评、亮点、短板、下一步）交给大模型，避免模板化套话。
 *
 * 模型调用失败时仍然返回真实统计，但 `aiGenerated=false` 并给出说明，
 * 不拿规则文本冒充模型产出。
 *
 * 统计口径与流式版（generate.stream.post.ts）共用 report-stats，避免两套算法漂移。
 */

export default defineEventHandler(async (event) => {
	const session = readSession(event)
	if (!session) throw createError({ statusCode: 401, message: "未登录" })

	const user = findUserByAccount(session.account)
	if (!user) throw createError({ statusCode: 401, message: "用户不存在" })

	const stats = buildReportStats(user.id, user.name)

	const base = {
		generatedAt: stats.generatedAt,
		overview: stats.overview,
		skillBreakdown: stats.skillBreakdown,
		recentAssessments: stats.recentAssessments,
	}

	// 空态：没有路径也没有测评时，模型没有素材可复盘，直接给引导而不是让它在真空里编
	if (stats.empty) {
		const summary = "还没有可复盘的学习记录。先确定一个学习方向并完成前几关，再回来生成报告。"
		const payload = {
			...base,
			empty: true,
			aiGenerated: false,
			model: null,
			degradedReason: null,
			summary,
			highlights: [],
			gaps: ["暂无学习数据，无法判断薄弱环节"],
			nextSteps: [
				{ title: "确定一个学习方向", reason: "有方向后系统才能拆成可执行的每日关卡" },
				{ title: "完成前 3 关", reason: "有了完成记录，复盘才有依据" },
			],
			recommendation: summary,
		}
		createLearningReport(user.id, "stage", null, null, JSON.stringify(payload))
		return payload
	}

	let narrative: ReportNarrative | null = null
	let model: string | null = null
	let degradedReason: string | null = null

	try {
		const result = await chatJson<ReportNarrative>({
			messages: buildReportMessages(stats.profileText),
			temperature: 0.4,
			maxTokens: 3000,
			timeoutMs: 90_000,
			maxAttempts: 2,
			tag: `report:${user.id}`,
			validate: validateNarrative,
			allowMockOnError: false,
			mock: () => ({ summary: "", highlights: [], gaps: [], nextSteps: [] }),
		})

		if (!result.mock) {
			narrative = result.data
			model = result.model
		}
	} catch (error) {
		degradedReason = error instanceof Error ? error.message : "大模型调用失败"
		console.warn(`[report] narrative failed user=${user.id} error=${degradedReason}`)
	}

	const summary = narrative?.summary ?? buildFallbackSummary(stats)
	const aiGenerated = narrative !== null

	const payload = {
		...base,
		empty: false,
		aiGenerated,
		model,
		degradedReason,
		summary,
		highlights: narrative?.highlights ?? [],
		gaps: narrative?.gaps ?? [],
		nextSteps: narrative?.nextSteps ?? [],
		// 兼容旧字段：报告列表/详情读的是 recommendation
		recommendation: summary,
	}

	createLearningReport(user.id, "stage", null, null, JSON.stringify(payload))
	return payload
})
