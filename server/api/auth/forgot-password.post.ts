import { randomBytes } from "node:crypto"
import { isBlank, isValidEmail } from "#shared/utils/validate"
import { isInstalled, readConfig } from "../../utils/app-config"
import { checkRateLimit } from "../../utils/rate-limit"
import { getSmtpConfig } from "../../repositories/settings.repository"
import { sendPasswordResetEmail } from "../../utils/email"
import { findUserByEmail } from "../../repositories/user.repository"
import {
	cleanExpiredResetTokens,
	createResetToken,
} from "../../repositories/password-reset.repository"

/** 重置 token 有效期 1 小时 */
const TOKEN_TTL_MS = 60 * 60 * 1000

/** 获取客户端 IP（用于限流） */
function getClientIp(event: Parameters<Parameters<typeof defineEventHandler>[0]>[0]): string {
	const forwarded = getRequestHeader(event, "x-forwarded-for")
	if (forwarded) return forwarded.split(",")[0]!.trim()
	return getRequestIP(event) ?? "unknown"
}

/**
 * 忘记密码：POST /api/auth/forgot-password
 *
 * 流程：校验 → 限流 → 查找用户 → 生成 token → 发送重置邮件
 * 无论邮箱是否存在都返回成功（防枚举），仅在 SMTP 未配置时返回错误。
 */
export default defineEventHandler(async (event) => {
	if (!isInstalled()) {
		throw createError({ statusCode: 503, message: "系统尚未安装，请先访问 /install 完成初始化" })
	}

	const ip = getClientIp(event)
	if (!checkRateLimit(`forgot-pwd:${ip}`, 5, 60_000)) {
		throw createError({ statusCode: 429, message: "请求过于频繁，请稍后再试" })
	}

	const body = await readBody<{ email?: string }>(event).catch(() => null)
	const email = (body?.email ?? "").trim().toLowerCase()

	if (isBlank(email) || !isValidEmail(email)) {
		throw createError({ statusCode: 400, message: "邮箱格式不正确" })
	}

	const smtpConfig = getSmtpConfig()
	if (!smtpConfig) {
		throw createError({ statusCode: 503, message: "邮件服务未配置，请联系管理员重置密码" })
	}

	// 查找用户（防枚举：无论是否存在都返回成功）
	const user = findUserByEmail(email)

	if (user && user.status !== "pending") {
		const token = randomBytes(32).toString("hex")
		const expiresAt = new Date(Date.now() + TOKEN_TTL_MS).toISOString()
		cleanExpiredResetTokens(user.id)
		createResetToken(user.id, token, expiresAt)

		try {
			const siteName = readConfig()?.site.name ?? "FSP"
			const siteUrl = (readConfig()?.site.url ?? "").replace(/\/$/, "")
			const resetUrl = `${siteUrl}/reset-password?token=${token}`
			await sendPasswordResetEmail(smtpConfig, email, resetUrl, siteName)
		} catch (error) {
			console.error("[forgot-password] 重置邮件发送失败:", error instanceof Error ? error.message : error)
		}
	}

	return {
		ok: true,
		message: "如果该邮箱已注册，重置链接已发送至你的邮箱",
	}
})
