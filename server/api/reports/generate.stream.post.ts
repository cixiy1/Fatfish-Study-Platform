import { createLearningReport } from "../../repositories/learning.repository"
import { findUserByAccount } from "../../repositories/user.repository"
import { chatStream } from "../../utils/llm"
import { requireLlm } from "../../utils/llm-guard"
import {
	buildFallbackSummary,
	buildReportMessages,
	buildReportStats,
	parseReportNarrative,
} from "../../utils/report-stats"
import { readSession } from "../../utils/session"
import { openSse } from "../../utils/sse"

/**
 * 生成学习复盘（流式）：POST /api/reports/generate.stream
 *
 * 事件顺序：
 * - stats  → 纯数据库算出来的客观数字，**立即**推送，前端先把统计区渲染出来
 * - chunk  → 模型叙述的流式片段
 * - done   → 解析后的叙述 + 与接口一致的完整报告体
 * - error  → 出错（统计已经给了，不会白屏）
 *
 * 之所以先给 stats：报告里最"重"的等待是大模型，而数字是本地算的。
 * 让用户先看到真实进度，比让他对着一个转圈等 20 秒更可信。
 */

export default defineEventHandler(async (event) => {
	const session = readSession(event)
	if (!session) throw createError({ statusCode: 401, message: "未登录" })

	const user = findUserByAccount(session.account)
	if (!user) throw createError({ statusCode: 401, message: "用户不存在" })

	requireLlm()

	const stats = buildReportStats(user.id, user.name)

	const sse = openSse(event)

	try {
		const base = {
			generatedAt: stats.generatedAt,
			overview: stats.overview,
			skillBreakdown: stats.skillBreakdown,
			recentAssessments: stats.recentAssessments,
		}

		// 空态不需要等模型：直接给引导
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
			sse.write("stats", base)
			createLearningReport(user.id, "stage", null, null, JSON.stringify(payload))
			sse.write("done", payload)
			return
		}

		// 1) 先把客观数字推下去
		sse.write("stats", base)

		// 2) 再让模型写叙述
		// 手动迭代而不是 for-await：生成器 return 的 ChatStreamMeta（model / truncated）
		// 在 for-await 里会被丢掉，而报告里要如实标注是哪个模型写的
		let fullText = ""
		let model: string | null = null
		let truncated = false

		const iterator = chatStream({
			messages: buildReportMessages(stats.profileText),
			temperature: 0.4,
			maxTokens: 4096,
			timeoutMs: 90_000,
			tag: `report-stream:${user.id}`,
			signal: sse.signal,
		})

		let step = await iterator.next()
		while (!step.done) {
			fullText += step.value
			sse.write("chunk", { text: step.value })
			step = await iterator.next()
		}
		model = step.value.model
		truncated = step.value.truncated

		const narrative = parseReportNarrative(fullText)
		const plainText = fullText.replace(/```(?:json)?[\s\S]*?```/g, "").trim()
		const summary = narrative?.summary || plainText.slice(0, 400) || buildFallbackSummary(stats)
		const degradedReason = narrative
			? (truncated ? "模型输出被长度截断，结论可能不完整" : null)
			: "模型未返回可解析的复盘结构"

		const payload = {
			...base,
			empty: false,
			aiGenerated: narrative !== null,
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
		sse.write("done", payload)
	} catch (error) {
		const message = error instanceof Error ? error.message : "报告生成失败"
		console.warn(`[report] stream failed user=${user.id} error=${message}`)
		sse.write("error", { message })
	} finally {
		sse.close()
	}
})
