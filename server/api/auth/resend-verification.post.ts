import { randomBytes } from "node:crypto"
import { isBlank, isValidEmail } from "#shared/utils/validate"
import { isInstalled, readConfig, resolveSiteUrl } from "../../utils/app-config"
import { checkRateLimit } from "../../utils/rate-limit"
import { getSmtpConfig } from "../../repositories/settings.repository"
import { describeSmtpError, sendVerificationEmail } from "../../utils/email"
import { findUserByEmail } from "../../repositories/user.repository"
import { cleanExpiredByUser, createToken } from "../../repositories/email-verification.repository"

/** 验证 token 有效期 24 小时 */
const TOKEN_TTL_MS = 24 * 60 * 60 * 1000

/** 获取客户端 IP（用于限流） */
function getClientIp(event: Parameters<Parameters<typeof defineEventHandler>[0]>[0]): string {
	const forwarded = getRequestHeader(event, "x-forwarded-for")
	if (forwarded) return forwarded.split(",")[0]!.trim()
	return getRequestIP(event) ?? "unknown"
}

/**
 * 补发邮箱验证邮件：POST /api/auth/resend-verification
 *
 * 用于注册时验证邮件发送失败、邮件丢失或链接过期后的补救。
 * 只对 pending（待激活）用户补发；已激活用户不需要验证。
 * 防枚举：无论邮箱是否存在 / 是否已激活，都返回统一的成功文案。
 */
export default defineEventHandler(async (event) => {
	if (!isInstalled()) {
		throw createError({ statusCode: 503, message: "系统尚未安装" })
	}

	const ip = getClientIp(event)
	if (!checkRateLimit(`resend:${ip}`, 5, 60_000)) {
		throw createError({ statusCode: 429, message: "请求过于频繁，请稍后再试" })
	}

	const body = await readBody<{ email?: string }>(event).catch(() => null)
	const email = (body?.email ?? "").trim().toLowerCase()

	if (isBlank(email) || !isValidEmail(email)) {
		throw createError({ statusCode: 400, message: "邮箱格式不正确" })
	}

	// 防枚举：查不到用户或已激活，都返回「已发送」的假象，不泄露账号是否存在
	const user = findUserByEmail(email)
	if (!user || user.status !== "pending") {
		return { ok: true, sent: false, message: "如果该邮箱有待激活账号，验证邮件已重新发送" }
	}

	const smtpConfig = getSmtpConfig()
	if (!smtpConfig) {
		return { ok: false, sent: false, message: "未配置 SMTP，无法发送验证邮件，请联系管理员手动激活" }
	}

	const token = randomBytes(32).toString("hex")
	const expiresAt = new Date(Date.now() + TOKEN_TTL_MS).toISOString()
	cleanExpiredByUser(user.id)
	createToken({ userId: user.id, token, expiresAt })

	const siteName = readConfig()?.site.name ?? "FSP"
	try {
		const siteUrl = resolveSiteUrl(event)
		const verificationUrl = `${siteUrl}/api/auth/verify-email?token=${token}`
		await sendVerificationEmail(smtpConfig, email, verificationUrl, siteName)
		return { ok: true, sent: true, message: "验证邮件已重新发送，请查收" }
	} catch (error) {
		const failure = describeSmtpError(error)
		console.error("[resend-verification] 补发失败:", failure.code, failure.detail)
		throw createError({
			statusCode: 502,
			message: `发送失败 [${failure.code}] ${failure.detail}｜${failure.hint}`,
			data: failure,
		})
	}
})
