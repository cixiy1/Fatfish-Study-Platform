import { isBlank, isStrongPassword } from "#shared/utils/validate"
import { isInstalled } from "../../utils/app-config"
import { hashPassword } from "../../utils/password"
import { checkRateLimit } from "../../utils/rate-limit"
import { findUserById, updateUserPassword } from "../../repositories/user.repository"
import {
	findResetToken,
	markResetTokenUsed,
} from "../../repositories/password-reset.repository"

/** 获取客户端 IP（用于限流） */
function getClientIp(event: Parameters<Parameters<typeof defineEventHandler>[0]>[0]): string {
	const forwarded = getRequestHeader(event, "x-forwarded-for")
	if (forwarded) return forwarded.split(",")[0]!.trim()
	return getRequestIP(event) ?? "unknown"
}

/**
 * 重置密码：POST /api/auth/reset-password
 *
 * 流程：校验 → 限流 → 查找 token → 校验有效期/未使用 → 更新密码 → 标记 token 已用
 */
export default defineEventHandler(async (event) => {
	if (!isInstalled()) {
		throw createError({ statusCode: 503, message: "系统尚未安装，请先访问 /install 完成初始化" })
	}

	const ip = getClientIp(event)
	if (!checkRateLimit(`reset-pwd:${ip}`, 10, 60_000)) {
		throw createError({ statusCode: 429, message: "请求过于频繁，请稍后再试" })
	}

	const body = await readBody<{ token?: string; password?: string }>(event).catch(() => null)
	const token = (body?.token ?? "").trim()
	const password = body?.password ?? ""

	if (isBlank(token)) {
		throw createError({ statusCode: 400, message: "重置链接无效" })
	}

	if (!isStrongPassword(password)) {
		throw createError({ statusCode: 400, message: "密码至少 8 位，需同时包含字母和数字" })
	}

	const resetToken = findResetToken(token)
	if (!resetToken) {
		throw createError({ statusCode: 400, message: "重置链接无效" })
	}

	if (resetToken.used_at) {
		throw createError({ statusCode: 400, message: "重置链接已使用，请重新申请" })
	}

	if (new Date(resetToken.expires_at).getTime() < Date.now()) {
		throw createError({ statusCode: 400, message: "重置链接已过期，请重新申请" })
	}

	const user = findUserById(resetToken.user_id)
	if (!user) {
		throw createError({ statusCode: 400, message: "用户不存在" })
	}

	updateUserPassword(user.id, hashPassword(password))
	markResetTokenUsed(resetToken.id)

	return {
		ok: true,
		message: "密码重置成功，请使用新密码登录",
	}
})
