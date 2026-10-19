import { updateLearningPathStatus } from "../../repositories/learning.repository"
import { readSession } from "../../utils/session"
import { findUserByAccount } from "../../repositories/user.repository"

/**
 * 更新学习路径状态：PATCH /api/learning-path/:id
 *
 * 支持激活（active）、存档（archived）、完成（completed）。
 * 激活时自动将其他路径置为 archived，实现方向切换。
 */
export default defineEventHandler(async (event) => {
	const session = readSession(event)
	if (!session) throw createError({ statusCode: 401, message: "未登录" })
	const user = findUserByAccount(session.account)
	if (!user) throw createError({ statusCode: 401, message: "用户不存在" })

	const pathId = Number(getRouterParam(event, "id"))
	const body = await readBody<{ status?: string }>(event).catch(() => null)
	const status = body?.status

	if (!status || !["active", "archived", "completed"].includes(status)) {
		throw createError({ statusCode: 400, message: "状态不合法" })
	}

	const ok = updateLearningPathStatus(pathId, user.id, status as "active" | "archived" | "completed")
	if (!ok) {
		throw createError({ statusCode: 404, message: "学习路径不存在" })
	}

	return { ok: true }
})
