import { requireAdmin } from "../../../../utils/admin-guard"
import { findUserById, updateUserStatus } from "../../../../repositories/user.repository"

/**
 * 更新用户状态：PATCH /api/admin/users/:id/status
 *
 * body: { status: "active" | "pending" | "disabled" }
 * 不允许修改自己的状态。
 */
export default defineEventHandler(async (event) => {
	requireAdmin(event)

	const id = Number(getRouterParam(event, "id"))
	if (!Number.isInteger(id) || id <= 0) {
		throw createError({ statusCode: 400, message: "无效的用户 ID" })
	}

	const body = await readBody<{ status?: string }>(event).catch(() => null)
	const status = body?.status
	if (!status || !["active", "pending", "disabled"].includes(status)) {
		throw createError({ statusCode: 400, message: "状态必须为 active、pending 或 disabled" })
	}

	const target = findUserById(id)
	if (!target) {
		throw createError({ statusCode: 404, message: "用户不存在" })
	}

	const sessionUser = readSession(event)
	if (sessionUser && target.account === sessionUser.account) {
		throw createError({ statusCode: 400, message: "不能修改自己的状态" })
	}

	if (target.role === "admin" && status !== "active") {
		throw createError({ statusCode: 400, message: "不能禁用管理员账号" })
	}

	updateUserStatus(id, status)
	return { ok: true, message: `用户状态已更新为 ${status}` }
})
