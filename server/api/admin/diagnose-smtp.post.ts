import { requireAdmin } from "../../utils/admin-guard"
import { getSmtpConfig } from "../../repositories/settings.repository"
import { diagnoseSmtp, resolveFromAddress } from "../../utils/email"

/**
 * SMTP 逐层诊断：POST /api/admin/diagnose-smtp
 *
 * 依次检测 DNS → TCP/问候 → TLS/认证 → 实际投递，返回每一步的结果与建议。
 * 用于定位「邮件发不出去」到底是网络、授权码还是发件人配置的问题。
 */
export default defineEventHandler(async (event) => {
	requireAdmin(event)

	const body = await readBody<{ to?: string }>(event).catch(() => null)
	const to = (body?.to ?? "").trim() || undefined

	const config = getSmtpConfig()
	if (!config) {
		throw createError({ statusCode: 400, message: "SMTP 尚未配置，请先保存 SMTP 设置" })
	}

	const diagnosis = await diagnoseSmtp(config, to)
	const effectiveFrom = resolveFromAddress(config)

	return {
		...diagnosis,
		config: {
			host: config.host,
			port: config.port,
			secure: config.secure,
			user: config.user,
			from: config.from,
			effectiveFrom,
			/** 配置的发件人与实际使用的不一致（QQ/163 常见） */
			fromAdjusted: effectiveFrom !== (config.from || config.user),
		},
		testedTo: to ?? null,
	}
})
