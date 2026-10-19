import type { H3Event } from "h3"
import { findUserByAccount } from "../repositories/user.repository"
import { readSession } from "./session"

/**
 * 管理员权限守卫（服务端）。
 *
 * RISK-04 方案二：SessionUser 不含 role，通过二次查询 users 表获取 role。
 * 在每个 /api/admin/* 接口入口调用，非管理员抛 403。
 */
export function requireAdmin(event: H3Event): { account: string, name: string } {
	const sessionUser = readSession(event)
	if (!sessionUser) {
		throw createError({ statusCode: 401, message: "未登录" })
	}

	const user = findUserByAccount(sessionUser.account)
	if (!user || user.role !== "admin") {
		throw createError({ statusCode: 403, message: "需要管理员权限" })
	}

	return sessionUser
}
