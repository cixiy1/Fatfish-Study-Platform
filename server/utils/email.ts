import { lookup } from "node:dns/promises"
import { connect as netConnect } from "node:net"
import nodemailer from "nodemailer"
import type { SmtpConfig } from "#shared/types/auth"

/**
 * 邮件发送封装（基于 nodemailer）。
 *
 * 提供验证邮件、密码重置邮件、测试邮件，以及逐层网络诊断。
 * 所有发送都带显式超时，避免 SMTP 端口被中间设备吞掉连接时请求挂死。
 */

/** 建连超时（毫秒） */
const CONNECT_TIMEOUT_MS = 15_000
/** 等待服务器问候超时（毫秒） */
const GREETING_TIMEOUT_MS = 15_000
/** 单次读写信道空闲超时（毫秒） */
const SOCKET_TIMEOUT_MS = 30_000

/**
 * 对发件人地址卡得极严的域名：MAIL FROM 必须与登录账号完全一致，
 * 否则服务器直接回 501 / 553 拒信。
 */
const STRICT_FROM_DOMAINS = new Set([
	"qq.com",
	"foxmail.com",
	"vip.qq.com",
	"163.com",
	"126.com",
	"yeah.net",
	"188.com",
])

/** 取邮箱地址的域名部分 */
function domainOf(address: string): string {
	const at = address.lastIndexOf("@")
	return at < 0 ? "" : address.slice(at + 1).trim().toLowerCase()
}

/**
 * 计算实际可用的发件人地址。
 *
 * QQ / 163 等邮箱要求 MAIL FROM 与授权账号完全一致，配置里写了别名地址会被直接拒信，
 * 因此域名不一致时回退成登录账号，保证邮件能发出去。
 */
export function resolveFromAddress(config: SmtpConfig): string {
	const user = (config.user ?? "").trim()
	const from = (config.from ?? "").trim()
	if (!from) return user
	if (!user) return from
	const userDomain = domainOf(user)
	const fromDomain = domainOf(from)
	if (userDomain && fromDomain && userDomain !== fromDomain) {
		if (STRICT_FROM_DOMAINS.has(userDomain) || STRICT_FROM_DOMAINS.has(fromDomain)) {
			return user
		}
	}
	return from
}

/** 发件人展示名（配置的地址与登录账号不一致被回退时提示用） */
function formatFrom(config: SmtpConfig, siteName?: string): string {
	const address = resolveFromAddress(config)
	return siteName ? `"${siteName}" <${address}>` : address
}

/** 创建 SMTP 传输器 */
export function createTransporter(config: SmtpConfig): nodemailer.Transporter {
	return nodemailer.createTransport({
		host: config.host,
		port: config.port,
		secure: config.secure,
		// 587 等明文端口强制 STARTTLS，避免服务器不提供加密时明文发送被中间设备重置
		requireTLS: !config.secure,
		auth: {
			user: config.user,
			pass: config.pass,
		},
		connectionTimeout: CONNECT_TIMEOUT_MS,
		greetingTimeout: GREETING_TIMEOUT_MS,
		socketTimeout: SOCKET_TIMEOUT_MS,
		tls: {
			servername: config.host,
			minVersion: "TLSv1.2",
		},
	})
}

/** 判断 IP 是否落在本地代理的 fake-IP 段（Clash / Surge TUN 常见） */
function isFakeIp(address: string): boolean {
	if (address.startsWith("198.18.") || address.startsWith("198.19.")) return true
	if (address === "127.0.0.1" || address === "::1") return true
	// Clash / Surge TUN 的 fake-IPv6 段
	if (address.startsWith("2001:2::") || address.startsWith("fdfe:dcba:9876")) return true
	if (address.startsWith("::ffff:198.18.") || address.startsWith("::ffff:127.")) return true
	return false
}

/** 结构化错误描述：给前端/后台展示「为什么发不出去」 */
export interface SmtpFailure {
	/** nodemailer / Node 错误码，如 EAUTH、ESOCKET */
	code: string
	/** 服务器原始响应或错误消息 */
	detail: string
	/** 面向人的排查建议 */
	hint: string
}

/** 把 errno 翻译成中文可操作建议 */
export function describeSmtpError(error: unknown): SmtpFailure {
	const err = error as {
		code?: string
		responseCode?: number
		response?: string
		message?: string
		command?: string
	}
	const code = err?.code ?? (err?.responseCode ? String(err.responseCode) : "UNKNOWN")
	const detail = (err?.response || err?.message || "未知错误").toString().trim().slice(0, 500)
	const lower = detail.toLowerCase()

	if (code === "EAUTH" || err?.responseCode === 535 || lower.includes("authentication")) {
		return {
			code,
			detail,
			hint: "账号或密码被拒。QQ/163 邮箱要用「授权码」（在邮箱设置-账户里开启 SMTP 服务后生成），不能用登录密码；Gmail 要用应用专用密码。",
		}
	}

	if (lower.includes("mail from") || lower.includes("sender") || err?.responseCode === 501 || err?.responseCode === 553) {
		return {
			code,
			detail,
			hint: "发件人被服务器拒绝。QQ/163 要求「发件人邮箱」与「登录账号」完全一致，请把发件人改成登录账号本身。",
		}
	}

	if (lower.includes("too many") || lower.includes("frequency") || err?.responseCode === 550) {
		return {
			code,
			detail,
			hint: "发送过于频繁或内容被判定为垃圾邮件，稍后再试，并检查邮件标题/正文是否含大量链接。",
		}
	}

	if (code === "ETIMEOUT" || code === "ETIMEDOUT" || code === "ESOCKET" || code === "ECONNRESET" || code === "ECONNECTION" || code === "EPROTO") {
		return {
			code,
			detail,
			hint: "TCP 连上了但握手/加密被中断，通常是本机代理（Clash/Surge 的 TUN 或全局模式）劫持了 SMTP 端口。把 smtp 域名加入代理直连（DIRECT）规则，或先关闭代理再试。",
		}
	}

	if (code === "ENOTFOUND" || code === "EAI_AGAIN" || code === "EDNS") {
		return { code, detail, hint: "SMTP 服务器域名解析失败，检查主机名拼写或本机 DNS。" }
	}

	if (code === "EHOSTUNREACH" || code === "ENETUNREACH" || code === "ECONNREFUSED") {
		return { code, detail, hint: "无法连接该 SMTP 端口，多为端口被网络屏蔽，可尝试改用 465（SSL）。" }
	}

	if (code === "CERT_HAS_EXPIRED" || lower.includes("certificate") || code === "DEPTH_ZERO_SELF_SIGNED_CERT") {
		return { code, detail, hint: "TLS 证书校验失败，自建邮件服务器请使用受信任证书，或换用 587 + STARTTLS。" }
	}

	return { code, detail, hint: "发送失败，请核对主机、端口、加密方式与账号授权码。" }
}

/* -------------------------------------------------------------------------- */
/* 分层诊断                                                                    */
/* -------------------------------------------------------------------------- */

/** 单个诊断步骤结果 */
export interface SmtpDiagnosisStep {
	/** 步骤名，如 DNS 解析 */
	name: string
	ok: boolean
	/** 结果说明 */
	detail: string
	/** 耗时（毫秒） */
	durationMs: number
	/** 失败建议 */
	hint?: string
}

/** 诊断汇总 */
export interface SmtpDiagnosis {
	ok: boolean
	steps: SmtpDiagnosisStep[]
	/** 首个失败步骤的建议 */
	hint?: string
	/** 首行结论 */
	summary: string
}

/** 用裸 socket 测 TCP 连接 + 服务器问候（SMTP 220） */
function probeTcpAndGreeting(host: string, port: number): Promise<{ ok: boolean, detail: string, hint?: string }> {
	return new Promise((resolve) => {
		const started = Date.now()
		const socket = netConnect({ host, port })
		let settled = false
		let buffer = ""

		const finish = (ok: boolean, detail: string, hint?: string) => {
			if (settled) return
			settled = true
			socket.destroy()
			resolve({ ok, detail, hint })
		}

		socket.setTimeout(CONNECT_TIMEOUT_MS)
		socket.setEncoding("utf8")

		socket.on("connect", () => {
			// 连上后等服务端问候语，超过 8s 没有响应就认为被中间设备吞掉
			setTimeout(() => {
				if (!buffer) {
					finish(false, `TCP 已连上 ${host}:${port}，但 ${Math.round((Date.now() - started) / 1000)}s 内没有收到 SMTP 问候语`, "连接被中间设备（代理/防火墙）接受后立即挂起，请把 smtp 域名设为直连。")
				}
			}, 8000)
		})

		socket.on("data", (chunk: string) => {
			buffer += chunk
			if (buffer.startsWith("220")) {
				finish(true, `已连通，服务器问候：${buffer.split("\r\n")[0]!.slice(0, 120)}`)
			} else if (buffer.includes("\r\n")) {
				finish(false, `服务器返回异常响应：${buffer.split("\r\n")[0]!.slice(0, 120)}`, "端口可能不是标准 SMTP 端口（465 为 SSL，587 为 STARTTLS）。")
			}
		})

		socket.on("timeout", () => {
			finish(false, `连接 ${host}:${port} 超时`, "端口可能被防火墙或代理阻断，可尝试其他端口（465/587）。")
		})

		socket.on("error", (error: NodeJS.ErrnoException) => {
			finish(false, `连接 ${host}:${port} 失败：${error.code ?? error.message}`, describeSmtpError(error).hint)
		})

		socket.on("close", () => {
			if (!buffer) finish(false, `连接 ${host}:${port} 后立即被关闭（未收到任何数据）`, "典型的代理劫持表现：SMTP 端口无法穿透代理，请把域名设为直连或改用 465。")
		})
	})
}

/**
 * 逐层诊断 SMTP：DNS → TCP/问候 → 认证 → （可选）实际发信。
 *
 * 每一步都独立计时，失败即停止并给出该层的建议。
 */
export async function diagnoseSmtp(config: SmtpConfig, testTo?: string): Promise<SmtpDiagnosis> {
	const steps: SmtpDiagnosisStep[] = []

	// 1. DNS
	const dnsStarted = Date.now()
	let addresses: { address: string, family: number }[] = []
	try {
		addresses = await lookup(config.host, { all: true })
		const list = addresses.map(a => a.address)
		const fake = list.filter(isFakeIp)
		if (fake.length > 0 && fake.length === list.length) {
			steps.push({
				name: "DNS 解析",
				ok: false,
				detail: `${config.host} 解析到 ${list.join(", ")}（fake-IP 段）`,
				durationMs: Date.now() - dnsStarted,
				hint: "解析结果是代理的虚拟 IP（198.18.x.x），说明本机代理软件接管了全部流量。SMTP 不走 HTTP 代理，会被直接断开：请把 smtp 域名加入直连规则，或关闭代理后重试。",
			})
			return { ok: false, steps, hint: steps[0]!.hint, summary: "DNS 被代理接管（fake-IP），SMTP 无法直连" }
		}
		steps.push({
			name: "DNS 解析",
			ok: true,
			detail: `${config.host} → ${list.join(", ")}`,
			durationMs: Date.now() - dnsStarted,
		})
	} catch (error) {
		const failure = describeSmtpError(error)
		steps.push({
			name: "DNS 解析",
			ok: false,
			detail: failure.detail,
			durationMs: Date.now() - dnsStarted,
			hint: failure.hint,
		})
		return { ok: false, steps, hint: failure.hint, summary: "域名解析失败" }
	}

	// 2. TCP + 问候语
	const tcpStarted = Date.now()
	const tcp = await probeTcpAndGreeting(config.host, config.port)
	steps.push({
		name: `TCP 连接 ${config.port}（${config.secure ? "SSL" : "STARTTLS"}）`,
		ok: tcp.ok,
		detail: tcp.detail,
		durationMs: Date.now() - tcpStarted,
		hint: tcp.hint,
	})
	if (!tcp.ok) {
		return { ok: false, steps, hint: tcp.hint, summary: "无法与 SMTP 服务器建立会话" }
	}

	// 3. 认证（含 TLS 升级）
	const authStarted = Date.now()
	const transporter = createTransporter(config)
	try {
		await transporter.verify()
		steps.push({
			name: "TLS 与账号认证",
			ok: true,
			detail: `加密握手成功，账号 ${config.user} 认证通过`,
			durationMs: Date.now() - authStarted,
		})
	} catch (error) {
		const failure = describeSmtpError(error)
		steps.push({
			name: "TLS 与账号认证",
			ok: false,
			detail: `[${failure.code}] ${failure.detail}`,
			durationMs: Date.now() - authStarted,
			hint: failure.hint,
		})
		transporter.close()
		return { ok: false, steps, hint: failure.hint, summary: "账号认证失败" }
	}

	// 4. 实际发信
	if (testTo) {
		const sendStarted = Date.now()
		try {
			const info = await transporter.sendMail({
				from: formatFrom(config, "FSP"),
				to: testTo,
				subject: "【FSP】SMTP 诊断邮件",
				text: `这是一封 SMTP 诊断邮件，收到即表示发信链路正常。\n时间：${new Date().toISOString()}`,
			})
			steps.push({
				name: "实际投递",
				ok: true,
				detail: `已交给服务器，响应：${(info.response ?? "OK").toString().slice(0, 120)}`,
				durationMs: Date.now() - sendStarted,
			})
		} catch (error) {
			const failure = describeSmtpError(error)
			steps.push({
				name: "实际投递",
				ok: false,
				detail: `[${failure.code}] ${failure.detail}`,
				durationMs: Date.now() - sendStarted,
				hint: failure.hint,
			})
			transporter.close()
			return { ok: false, steps, hint: failure.hint, summary: "投递被服务器拒绝" }
		}
	}

	transporter.close()
	return { ok: true, steps, summary: testTo ? "全链路正常，邮件已投递" : "连接与认证正常" }
}

/* -------------------------------------------------------------------------- */
/* 发送邮件                                                                    */
/* -------------------------------------------------------------------------- */

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
			from: formatFrom(config, siteName),
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
			from: formatFrom(config, siteName),
			to,
			subject: `【${siteName}】密码重置`,
			text: `你正在重置 ${siteName} 账号的密码。\n\n请点击下方链接设置新密码（1 小时内有效）：\n${resetUrl}\n\n如果这不是你本人的操作，请忽略此邮件，你的密码不会改变。`,
			html: `
				<div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
					<h2 style="margin: 0 0 16px;">重置密码</h2>
					<p style="color: #666; line-height: 1.6;">你正在重置 ${siteName} 账号的密码。请点击下方链接设置新密码（1 小时内有效）：</p>
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
			from: formatFrom(config, siteName),
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
