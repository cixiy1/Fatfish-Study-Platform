import { findPathItemForUser, updateResourceReferences } from "../../../../repositories/learning.repository"
import { findUserByAccount } from "../../../../repositories/user.repository"
import { getDb } from "../../../../utils/db"
import { chatJson } from "../../../../utils/llm"
import { requireLlm } from "../../../../utils/llm-guard"
import { asRecord } from "../../../../utils/llm-json"
import { parseReferences, verifyReferences } from "../../../../utils/refs"
import { readSession } from "../../../../utils/session"

/**
 * 给已有学习节点补参考来源：POST /api/learning-path/item/:id/references
 *
 * 为什么单独做：正文生成一次要好几分钟，但「找几条权威来源」只要几秒。
 * 历史资料（这条功能上线前生成的）没有引用，不该为了加引用把整篇正文重写一遍。
 */
export default defineEventHandler(async (event) => {
	const session = readSession(event)
	if (!session) throw createError({ statusCode: 401, message: "未登录" })

	const user = findUserByAccount(session.account)
	if (!user) throw createError({ statusCode: 401, message: "用户不存在" })

	const itemId = Number(getRouterParam(event, "id"))
	if (!Number.isFinite(itemId)) throw createError({ statusCode: 400, message: "参数不合法" })

	const item = findPathItemForUser(itemId, user.id)
	if (!item) throw createError({ statusCode: 404, message: "关卡不存在" })
	if (!item.resource_id) throw createError({ statusCode: 400, message: "本关还没有资料，无法补引用" })

	const context = getDb()
		.prepare(`
			SELECT lr.title, lr.summary, lr.content,
			       s.name AS skill_name, p.name AS position_name
			FROM learning_resources lr
			LEFT JOIN learning_path_items lpi ON lpi.resource_id = lr.id AND lpi.id = ?
			LEFT JOIN skills s ON s.id = lpi.skill_id
			LEFT JOIN learning_paths lp ON lp.id = lpi.path_id
			LEFT JOIN positions p ON p.id = lp.target_position_id
			WHERE lr.id = ?
		`)
		.get(itemId, item.resource_id) as {
		title: string
		summary: string | null
		content: string | null
		skill_name: string | null
		position_name: string | null
	} | undefined

	if (!context) throw createError({ statusCode: 404, message: "资料不存在" })

	requireLlm()

	// 正文可能很长，只取开头——判断「该引哪个官方文档」不需要整篇
	const excerpt = (context.content ?? "").replace(/```[\s\S]*?```/g, "").slice(0, 900)

	const messages = [
		{
			role: "system" as const,
			content: [
				"你是学习资源检索助手，任务是给一篇已经写好的微课找**真实存在、能直接打开**的参考来源。",
				"挑选原则：",
				"1. 编程/框架/工具：优先官方文档（docs.oracle.com、docs.python.org、developer.mozilla.org、react.dev 等）与标准（w3.org、ietf.org）；",
				"2. 健身/健康/医学：权威机构与同行评议优先（who.int、cdc.gov、pubmed.ncbi.nlm.nih.gov、doi.org、acsm.org）；",
				"3. 语言考试：官方考试机构或权威词典（ets.org、cambridge.org、britishcouncil.org）；",
				"4. 其他领域：行业标准组织、主管部门官网或权威出版社的具体页面。",
				"硬性要求：链接必须给到具体页面（带路径），不能只丢首页；绝对不许编造 URL，不确定宁可不给。",
				"输出 2~4 条，只输出 JSON：",
				'{"references":[{"title":"页面标题","url":"https://具体页面","publisher":"机构名","note":"对应文中哪部分"}]}',
			].join("\n"),
		},
		{
			role: "user" as const,
			content: [
				context.position_name ? `学习方向：${context.position_name}` : "",
				context.skill_name ? `本关技能点：${context.skill_name}` : "",
				`关卡标题：${context.title}`,
				context.summary ? `摘要：${context.summary}` : "",
				"",
				"正文节选：",
				excerpt || "（无正文）",
			].filter(Boolean).join("\n"),
		},
	]

	const result = await chatJson({
		messages,
		temperature: 0.2,
		maxTokens: 1500,
		timeoutMs: 45_000,
		maxAttempts: 2,
		tag: `item-refs:${user.id}:${itemId}`,
		validate: (value) => {
			const raw = asRecord(value)
			const refs = parseReferences(raw.references ?? raw.sources ?? raw.links)
			if (refs.length === 0) throw new Error("模型没有给出可用的参考链接")
			return refs
		},
		// 引用是可选增强，模型不可用时直接报错，不写假数据
		allowMockOnError: false,
		mock: () => [],
	})

	if (result.mock) throw createError({ statusCode: 503, message: "大模型不可用，稍后再试" })

	const references = await verifyReferences(result.data)
	updateResourceReferences(item.resource_id, JSON.stringify(references))

	return { references }
})
