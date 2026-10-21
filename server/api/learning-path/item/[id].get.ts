import { findLearningPathItems, findPathItemForUser, findResourceById } from "../../../repositories/learning.repository"
import { findUserByAccount } from "../../../repositories/user.repository"
import { parseReferenceJson } from "../../../utils/refs"
import { readSession } from "../../../utils/session"
import { getDb } from "../../../utils/db"

/** 单关详情：GET /api/learning-path/item/:id */
export default defineEventHandler((event) => {
	const session = readSession(event)
	if (!session) throw createError({ statusCode: 401, message: "未登录" })

	const user = findUserByAccount(session.account)
	if (!user) throw createError({ statusCode: 401, message: "用户不存在" })

	const itemId = Number(getRouterParam(event, "id"))
	if (!Number.isFinite(itemId)) throw createError({ statusCode: 400, message: "参数不合法" })

	const item = findPathItemForUser(itemId, user.id)
	if (!item) throw createError({ statusCode: 404, message: "关卡不存在" })

	const skill = item.skill_id
		? (getDb()
				.prepare("SELECT id, name, category, level, description FROM skills WHERE id = ?")
				.get(item.skill_id) as { id: number, name: string, category: string, level: number, description: string | null } | undefined)
		: undefined

	const resource = item.resource_id ? findResourceById(item.resource_id) : null

	// 同路径下的前后关，用于底部「上一关 / 下一关」
	const siblings = findLearningPathItems(item.path_id)
	const index = siblings.findIndex((s) => s.id === item.id)
	const prev = index > 0 ? siblings[index - 1] : null
	const next = index >= 0 && index < siblings.length - 1 ? siblings[index + 1] : null

	return {
		item: {
			id: item.id,
			status: item.status,
			sortOrder: item.sort_order,
			index: index + 1,
			total: siblings.length,
			estimatedMinutes: item.estimated_minutes,
		},
		skill: skill
			? {
					id: skill.id,
					name: skill.name,
					category: skill.category,
					level: skill.level,
					description: skill.description,
				}
			: null,
		resource: resource
			? {
					id: resource.id,
					title: resource.title,
					type: resource.type,
					url: resource.url,
					difficulty: resource.difficulty,
					description: resource.description,
					summary: resource.summary,
					objectives: parseObjectives(resource.objectives),
					content: resource.content,
					duration: resource.duration,
					// 参考来源：官方文档 / 标准 / 论文，学习者可点开原文核对
					references: parseReferenceJson(resource.references_json),
					// 只有生成来源的资料才带正文，外链资料页面要改成跳转
					generated: resource.status === "ready" && Boolean(resource.content),
				}
			: null,
		prevId: prev?.id ?? null,
		nextId: next?.id ?? null,
	}
})

/** objectives 是 JSON 数组字符串，坏数据不该让整页 500 */
function parseObjectives(raw: string | null): string[] {
	if (!raw) return []
	try {
		const parsed: unknown = JSON.parse(raw)
		return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : []
	} catch {
		return []
	}
}
