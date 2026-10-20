import { randomBytes } from "node:crypto"
import type { RegisterPayload } from "#shared/types/auth"
import { isBlank, isStrongPassword, isValidEmail } from "#shared/utils/validate"
import { isInstalled, readConfig, resolveSiteUrl } from "../../utils/app-config"
import { hashPassword } from "../../utils/password"
import { checkRateLimit } from "../../utils/rate-limit"
import { getSmtpConfig } from "../../repositories/settings.repository"
import { describeSmtpError, sendVerificationEmail } from "../../utils/email"
import {
	createUser,
	findUserByAccount,
	findUserByEmail,
	updateUserStatus,
} from "../../repositories/user.repository"
import {
	cleanExpiredByUser,
	createToken,
} from "../../repositories/email-verification.repository"

/** 验证 token 有效期 24 小时 */
const TOKEN_TTL_MS = 24 * 60 * 60 * 1000

/** 获取客户端 IP（用于限流） */
function getClientIp(event: Parameters<Parameters<typeof defineEventHandler>[0]>[0]): string {
	const forwarded = getRequestHeader(event, "x-forwarded-for")
	if (forwarded) return forwarded.split(",")[0]!.trim()
	return getRequestIP(event) ?? "unknown"
}

/**
 * 注册：POST /api/auth/register
 *
 * 流程：校验 → 限流 → 唯一性检查（防枚举）→ 创建 pending 用户 → 生成 token → 发送验证邮件
 * 注册成功后不自动登录（status=pending），需邮件验证后激活。
 */
export default defineEventHandler(async (event) => {
	if (!isInstalled()) {
		throw createError({ statusCode: 503, message: "系统尚未安装，请先访问 /install 完成初始化" })
	}

	const ip = getClientIp(event)
	if (!checkRateLimit(`register:${ip}`, 5, 60_000)) {
		throw createError({ statusCode: 429, message: "注册请求过于频繁，请稍后再试" })
	}

	const body = await readBody<RegisterPayload>(event).catch(() => null)

	const account = (body?.account ?? "").trim()
	const email = (body?.email ?? "").trim().toLowerCase()
	const password = body?.password ?? ""
	const name = (body?.name ?? "").trim() || account

	if (isBlank(account) || isBlank(email) || !password) {
		throw createError({ statusCode: 400, message: "账号、邮箱和密码不能为空" })
	}

	if (!isValidEmail(email)) {
		throw createError({ statusCode: 400, message: "邮箱格式不正确" })
	}

	if (!isStrongPassword(password)) {
		throw createError({ statusCode: 400, message: "密码至少 8 位，需同时包含字母和数字" })
	}

	// 唯一性检查：账号或邮箱已存在均返回同一提示（防枚举）
	const existingByAccount = findUserByAccount(account)
	const existingByEmail = findUserByEmail(email)
	if (existingByAccount || existingByEmail) {
		throw createError({
			statusCode: 409,
			message: "注册失败，请检查输入或更换账号/邮箱后重试",
		})
	}

	// 创建用户（status=pending，需邮件验证）
	const passwordHash = hashPassword(password)
	const user = createUser({
		account,
		passwordHash,
		name,
		email,
		status: "pending",
	})

	// SMTP 未配置时跳过邮箱验证，直接激活；已配置时发送验证邮件
	const smtpConfig = getSmtpConfig()
	const siteName = readConfig()?.site.name ?? "FSP"
	let emailSent = false
	let emailError: string | null = null

	if (!smtpConfig) {
		updateUserStatus(user.id, "active")
		return {
			user: { account: user.account, name: user.name },
			emailSent: false,
			message: "注册成功，可直接登录（未配置 SMTP，已跳过邮箱验证）",
		}
	}

	const token = randomBytes(32).toString("hex")
	const expiresAt = new Date(Date.now() + TOKEN_TTL_MS).toISOString()
	cleanExpiredByUser(user.id)
	createToken({ userId: user.id, token, expiresAt })

	// 验证链接始终返回给前端：邮件发送失败时，用户可复制链接手动激活
	const siteUrl = resolveSiteUrl(event)
	const verificationUrl = `${siteUrl}/api/auth/verify-email?token=${token}`

	try {
		await sendVerificationEmail(smtpConfig, email, verificationUrl, siteName)
		emailSent = true
	} catch (error) {
		const failure = describeSmtpError(error)
		emailError = `[${failure.code}] ${failure.detail}｜${failure.hint}`
		console.error("[register] 验证邮件发送失败:", failure.code, failure.detail)
	}

	return {
		user: { account: user.account, name: user.name },
		emailSent,
		emailError,
		verificationUrl,
		message: emailSent
			? "注册成功，请查收验证邮件完成激活"
			: "注册成功，但验证邮件发送失败，请点击下方链接完成激活",
	}
})
