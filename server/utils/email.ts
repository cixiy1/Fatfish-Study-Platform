import nodemailer from "nodemailer"
import type { SmtpConfig } from "#shared/types/auth"

/**
 * 邮件发送封装（基于 nodemailer）。
 *
 * 提供验证邮件与测试邮件发送，邮件模板含纯文本与 HTML。
 */

/** 创建 SMTP 传输器 */
export function createTransporter(config: SmtpConfig): nodemailer.Transporter {
	return nodemailer.createTransport({
		host: config.host,
		port: config.port,
		secure: config.secure,
		auth: {
			user: config.user,
			pass: config.pass,
		},
	})
}

/** 验证 SMTP 连接是否可用 */
export async function verifySmtpConnection(config: SmtpConfig): Promise<void> {
	const transporter = createTransporter(config)
	try {
		await transporter.verify()
	} finally {
		transporter.close()
	}
}

/** 发送邮箱验证邮件 */
export async function sendVerificationEmail(
	config: SmtpConfig,
	to: string,
	verificationUrl: string,
	siteName: string,
): Promise<void> {
	const transporter = createTransporter(config)
	try {
		await transporter.sendMail({
			from: config.from,
			to,
			subject: `【${siteName}】邮箱验证`,
			text: `欢迎注册 ${siteName}！\n\n请点击下方链接验证你的邮箱（24 小时内有效）：\n${verificationUrl}\n\n如果这不是你本人的操作，请忽略此邮件。`,
			html: `
				<div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
					<h2 style="margin: 0 0 16px;">欢迎注册 ${siteName}</h2>
					<p style="color: #666; line-height: 1.6;">请点击下方按钮验证你的邮箱（24 小时内有效）：</p>
					<p style="margin: 24px 0;">
						<a href="${verificationUrl}" style="display: inline-block; padding: 10px 24px; background: #0d9488; color: #fff; text-decoration: none; border-radius: 6px;">验证邮箱</a>
					</p>
					<p style="color: #999; font-size: 12px; word-break: break-all;">或复制此链接到浏览器：<br>${verificationUrl}</p>
					<hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;">
					<p style="color: #999; font-size: 12px;">如果这不是你本人的操作，请忽略此邮件。</p>
				</div>
			`,
		})
	} finally {
		transporter.close()
	}
}

/** 发送密码重置邮件 */
export async function sendPasswordResetEmail(
	config: SmtpConfig,
	to: string,
	resetUrl: string,
	siteName: string,
): Promise<void> {
	const transporter = createTransporter(config)
	try {
		await transporter.sendMail({
			from: config.from,
			to,
			subject: `【${siteName}】密码重置`,
			text: `你正在重置 ${siteName} 账号的密码。\n\n请点击下方链接设置新密码（1 小时内有效）：\n${resetUrl}\n\n如果这不是你本人的操作，请忽略此邮件，你的密码不会改变。`,
			html: `
				<div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
					<h2 style="margin: 0 0 16px;">重置密码</h2>
					<p style="color: #666; line-height: 1.6;">你正在重置 ${siteName} 账号的密码。请点击下方按钮设置新密码（1 小时内有效）：</p>
					<p style="margin: 24px 0;">
						<a href="${resetUrl}" style="display: inline-block; padding: 10px 24px; background: #0d9488; color: #fff; text-decoration: none; border-radius: 6px;">重置密码</a>
					</p>
					<p style="color: #999; font-size: 12px; word-break: break-all;">或复制此链接到浏览器：<br>${resetUrl}</p>
					<hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;">
					<p style="color: #999; font-size: 12px;">如果这不是你本人的操作，请忽略此邮件，你的密码不会改变。</p>
				</div>
			`,
		})
	} finally {
		transporter.close()
	}
}

/** 发送测试邮件（管理员后台测试 SMTP 用） */
export async function sendTestEmail(
	config: SmtpConfig,
	to: string,
	siteName: string,
): Promise<void> {
	const transporter = createTransporter(config)
	try {
		await transporter.sendMail({
			from: config.from,
			to,
			subject: `【${siteName}】SMTP 测试邮件`,
			text: `这是一封来自 ${siteName} 的 SMTP 测试邮件。\n\n如果你收到了这封邮件，说明 SMTP 配置正确。`,
			html: `
				<div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
					<h2 style="margin: 0 0 16px;">SMTP 测试邮件</h2>
					<p style="color: #666; line-height: 1.6;">这是一封来自 ${siteName} 的测试邮件。</p>
					<p style="color: #666;">如果你收到了这封邮件，说明 SMTP 配置正确。</p>
				</div>
			`,
		})
	} finally {
		transporter.close()
	}
}
