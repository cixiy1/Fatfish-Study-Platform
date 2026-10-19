import { updatePathItemStatus } from "../../../repositories/learning.repository"
import { readSession } from "../../../utils/session"
import { findUserByAccount } from "../../../repositories/user.repository"

/** 更新学习路径项状态：PATCH /api/learning-path/item/:id */
export default defineEventHandler(async (event) => {
	const session = readSession(event)
	if (!session) throw createError({ statusCode: 401, message: "未登录" })

	const user = findUserByAccount(session.account)
	if (!user) throw createError({ statusCode: 401, message: "用户不存在" })

	const itemId = Number(getRouterParam(event, "id"))
	const body = await readBody<{ status?: string }>(event).catch(() => null)
	const status = body?.status

	if (!status || !["pending", "in_progress", "completed"].includes(status)) {
		throw createError({ statusCode: 400, message: "状态不合法" })
	}

	updatePathItemStatus(itemId, status)
	return { ok: true }
})
