import { deleteLearningPath } from "../../repositories/learning.repository"
import { readSession } from "../../utils/session"
import { findUserByAccount } from "../../repositories/user.repository"

/** 删除学习路径：DELETE /api/learning-path/:id */
export default defineEventHandler((event) => {
	const session = readSession(event)
	if (!session) throw createError({ statusCode: 401, message: "未登录" })
	const user = findUserByAccount(session.account)
	if (!user) throw createError({ statusCode: 401, message: "用户不存在" })

	const pathId = Number(getRouterParam(event, "id"))
	const ok = deleteLearningPath(pathId, user.id)
	if (!ok) {
		throw createError({ statusCode: 404, message: "学习路径不存在" })
	}

	return { ok: true }
})
