import type { TestSmtpRequest } from "#shared/types/auth"
import { requireAdmin } from "../../utils/admin-guard"
import { readConfig } from "../../utils/app-config"
import { getSmtpConfig } from "../../repositories/settings.repository"
import { sendTestEmail } from "../../utils/email"

/**
 * 测试 SMTP 发送：POST /api/admin/test-smtp
 *
 * 使用当前保存的 SMTP 配置向指定地址发送测试邮件。
 */
export default defineEventHandler(async (event) => {
	requireAdmin(event)

	const body = await readBody<TestSmtpRequest>(event).catch(() => null)
	const to = (body?.to ?? "").trim()

	if (!to) {
		throw createError({ statusCode: 400, message: "请填写收件人邮箱" })
	}

	const smtpConfig = getSmtpConfig()
	if (!smtpConfig) {
		throw createError({ statusCode: 400, message: "SMTP 尚未配置，请先保存 SMTP 设置" })
	}

	const siteName = readConfig()?.site.name ?? "FSP"

	try {
		await sendTestEmail(smtpConfig, to, siteName)
		return { ok: true, message: `测试邮件已发送至 ${to}` }
	} catch (error) {
		const message = error instanceof Error ? error.message : "发送失败"
		throw createError({ statusCode: 500, message: `SMTP 发送失败: ${message}` })
	}
})
