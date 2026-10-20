#!/usr/bin/env node
/**
 * SMTP 离线诊断脚本
 *
 * 直接读取 data/fsp.db 里的 SMTP 配置（自动解密授权码），
 * 逐层检测 DNS → TCP → 问候 → TLS/认证 → 投递，并把每一步的结果打印出来。
 *
 * 用法：
 *   node scripts/check-smtp.mjs                    # 只测连接与认证
 *   node scripts/check-smtp.mjs you@example.com    # 顺便真实投递一封测试邮件
 *
 * 注意：这个脚本必须在「没有挂代理」的终端里跑，才能反映真实网络状况。
 */

import { createDecipheriv, createHmac } from "node:crypto"
import { lookup } from "node:dns/promises"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { connect } from "node:net"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const require = createRequire(import.meta.url)
const nodemailer = require("nodemailer")

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const configPath = resolve(root, "data/config.json")
const dbPath = resolve(root, "data/fsp.db")

const C = {
	ok: "\u001B[32m",
	fail: "\u001B[31m",
	warn: "\u001B[33m",
	dim: "\u001B[2m",
	reset: "\u001B[0m",
}

function line(ok, name, detail, ms) {
	const mark = ok ? `${C.ok}✔${C.reset}` : `${C.fail}✘${C.reset}`
	const cost = ms === undefined ? "" : `${C.dim} ${ms}ms${C.reset}`
	console.log(`${mark} ${name}${cost}\n  ${detail}`)
}

/** 用 config.json 的 sessionSecret 派生密钥解密授权码 */
function decryptSecret(stored, sessionSecret) {
	if (!stored || !stored.startsWith("aes256gcm$")) return ""
	const parts = stored.split("$")
	if (parts.length !== 4) return ""
	const key = createHmac("sha256", `encrypt:${sessionSecret}`).digest()
	const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(parts[1], "hex"), { authTagLength: 16 })
	decipher.setAuthTag(Buffer.from(parts[2], "hex"))
	return Buffer.concat([decipher.update(Buffer.from(parts[3], "hex")), decipher.final()]).toString("utf8")
}

function loadSmtp() {
	const config = JSON.parse(readFileSync(configPath, "utf8"))
	const Database = require("better-sqlite3")
	const db = new Database(dbPath, { readonly: true })
	const row = db.prepare("SELECT value FROM settings WHERE key = 'smtp'").get()
	db.close()
	if (!row) throw new Error("数据库里没有 SMTP 配置（settings.smtp 为空）")
	const smtp = JSON.parse(row.value)
	return { ...smtp, pass: decryptSecret(smtp.pass, config.security.sessionSecret) }
}

function isFakeIp(addr) {
	if (addr.startsWith("198.18.") || addr.startsWith("198.19.")) return true
	if (addr === "127.0.0.1" || addr === "::1") return true
	// Clash / Surge TUN 的 fake-IPv6 段
	if (addr.startsWith("2001:2::") || addr.startsWith("fdfe:dcba:9876")) return true
	return false
}

function probeTcp(host, port) {
	return new Promise((done) => {
		const started = Date.now()
		const socket = connect({ host, port })
		let buffer = ""
		let settled = false
		const finish = (ok, detail) => {
			if (settled) return
			settled = true
			socket.destroy()
			line(ok, `TCP ${host}:${port}`, detail, Date.now() - started)
			done(ok)
		}
		socket.setEncoding("utf8")
		socket.setTimeout(15000)
		socket.on("connect", () => {
			setTimeout(() => {
				if (!buffer) finish(false, "连上了但 8s 内没有收到 SMTP 问候语 → 连接被代理或防火墙吞掉")
			}, 8000)
		})
		socket.on("data", (chunk) => {
			buffer += chunk
			if (buffer.startsWith("220")) finish(true, `问候语：${buffer.split("\r\n")[0].slice(0, 120)}`)
		})
		socket.on("timeout", () => finish(false, "连接超时，端口可能被封"))
		socket.on("error", (error) => finish(false, `连接失败：${error.code ?? error.message}`))
		socket.on("close", () => {
			if (!buffer) finish(false, "连接后立即被关闭（未收到任何数据）→ 典型的代理劫持表现")
		})
	})
}

async function main() {
	const testTo = process.argv[2]
	console.log(`${C.dim}FSP SMTP 诊断 · ${new Date().toLocaleString("zh-CN")}${C.reset}\n`)

	const smtp = loadSmtp()
	const from = smtp.from?.trim() || smtp.user
	console.log(`配置：${smtp.host}:${smtp.port} secure=${smtp.secure} user=${smtp.user} from=${smtp.from || "(空)"}`)
	console.log(`授权码：${smtp.pass ? `已解密，长度 ${smtp.pass.length}` : `${C.fail}解密失败（sessionSecret 变过？）${C.reset}`}\n`)

	// 1. DNS
	let addresses
	try {
		const started = Date.now()
		addresses = await lookup(smtp.host, { all: true })
		const list = addresses.map(a => a.address)
		const fakeCount = list.filter(isFakeIp).length
		if (fakeCount === list.length) {
			line(false, "DNS 解析", `${smtp.host} → ${list.join(", ")}（全是 fake-IP）→ 本机代理接管了流量，SMTP 会被断开\n  ${C.warn}处理：把 ${smtp.host} 加入代理直连规则，或临时关闭代理/系统代理再运行本脚本${C.reset}`, Date.now() - started)
			process.exit(1)
		}
		line(true, "DNS 解析", `${smtp.host} → ${list.join(", ")}`, Date.now() - started)
	} catch (error) {
		line(false, "DNS 解析", `失败：${error.code ?? error.message}`)
		process.exit(1)
	}

	// 2. TCP + 问候
	const tcpOk = await probeTcp(smtp.host, smtp.port)
	if (!tcpOk) process.exit(1)

	// 3. TLS + 认证
	const transporter = nodemailer.createTransport({
		host: smtp.host,
		port: smtp.port,
		secure: smtp.secure,
		requireTLS: !smtp.secure,
		auth: { user: smtp.user, pass: smtp.pass },
		connectionTimeout: 15000,
		greetingTimeout: 15000,
		socketTimeout: 30000,
		tls: { servername: smtp.host, minVersion: "TLSv1.2" },
	})

	const authStarted = Date.now()
	try {
		await transporter.verify()
		line(true, "TLS 与认证", `账号 ${smtp.user} 认证通过`, Date.now() - authStarted)
	} catch (error) {
		line(false, "TLS 与认证", `[${error.code ?? "UNKNOWN"}] ${error.response || error.message}`)
		console.log(`  ${C.warn}EAUTH/535 多为授权码错误；QQ/163 要在邮箱设置里开启 SMTP 服务并用授权码而非登录密码${C.reset}`)
		transporter.close()
		process.exit(1)
	}

	// 4. 投递
	if (testTo) {
		const sendStarted = Date.now()
		try {
			const info = await transporter.sendMail({
				from: `"FSP" <${from}>`,
				to: testTo,
				subject: "【FSP】SMTP 诊断邮件",
				text: `诊断脚本发出的测试邮件。时间：${new Date().toISOString()}`,
			})
			line(true, "实际投递", `已交给服务器：${String(info.response ?? "OK").slice(0, 120)}`, Date.now() - sendStarted)
		} catch (error) {
			line(false, "实际投递", `[${error.code ?? "UNKNOWN"}] ${error.response || error.message}`)
			if (/mail from|sender/i.test(`${error.response ?? error.message}`)) {
				console.log(`  ${C.warn}发件人与登录账号不一致会被拒信，把 from 改成 ${smtp.user}${C.reset}`)
			}
			transporter.close()
			process.exit(1)
		}
	}

	transporter.close()
	console.log(`\n${C.ok}诊断通过${C.reset}${testTo ? "，去收件箱看看（也检查一下垃圾箱）" : "；想验证投递请加收件人参数：node scripts/check-smtp.mjs you@example.com"}`)
}

main().catch((error) => {
	console.error(`${C.fail}诊断脚本异常：${error.message}${C.reset}`)
	process.exit(1)
})
