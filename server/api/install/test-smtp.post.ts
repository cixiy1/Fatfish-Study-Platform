import type { SmtpConfig } from "#shared/types/auth"
import { isValidEmail } from "#shared/utils/validate"
import { sendTestEmail } from "../../utils/email"

/**
 * 测试 SMTP 发送：POST /api/install/test-smtp
 *
 * install 向导中测试 SMTP 配置，向指定邮箱发送测试邮件。
 * 无需登录（系统可能尚未安装），不写入任何配置。
 */
export default defineEventHandler(async (event) => {
	const body = await readBody<{ smtp?: Partial<SmtpConfig>, to?: string }>(event).catch(() => null)
	const smtp = body?.smtp
	const to = (body?.to ?? "").trim()

	if (!smtp?.host || !smtp?.port || !smtp?.user || !smtp?.pass) {
		throw createError({ statusCode: 400, message: "请填写完整的 SMTP 配置（主机、端口、用户名、密码）" })
	}

	if (!to || !isValidEmail(to)) {
		throw createError({ statusCode: 400, message: "请填写有效的收件人邮箱" })
	}

	const config: SmtpConfig = {
		preset: smtp.preset ?? "custom",
		host: smtp.host,
		port: smtp.port,
		secure: smtp.secure ?? false,
		user: smtp.user,
		pass: smtp.pass,
		from: smtp.from ?? smtp.user,
	}

	try {
		await sendTestEmail(config, to, "FSP")
		return { ok: true, message: `测试邮件已发送至 ${to}` }
	} catch (error) {
		const message = error instanceof Error ? error.message : "发送失败"
		throw createError({ statusCode: 400, message: `SMTP 发送失败: ${message}` })
	}
})
