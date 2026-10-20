/**
 * 验证「只保留 GitHub 登录」后的界面：
 * - 登录页 / 注册页只有 GitHub 一个第三方按钮，没有 QQ / 微信
 * - 管理后台 OAuth 配置页只有 GitHub 一张卡
 *
 * 注意：登录态访问 /login 会被中间件弹回首页，所以游客页用无 cookie 的 context。
 */
import { chromium } from "playwright-core"
import { createHmac } from "node:crypto"
import { readFileSync } from "node:fs"

const ROOT = "/Users/yuki/Documents/Yuki/projects/competitons/hdc/fsp"
const secret = JSON.parse(readFileSync(`${ROOT}/data/config.json`, "utf8")).security.sessionSecret
const payload = { account: "Yukiho", name: "Yukiho", exp: Math.floor(Date.now() / 1000) + 3600 }
const enc = Buffer.from(JSON.stringify(payload)).toString("base64url")
const sig = createHmac("sha256", secret).update(enc).digest("base64url")

const browser = await chromium.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
})

const errors = []
function watch(page) {
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text())
  })
  page.on("pageerror", (err) => errors.push(String(err)))
}

/** 统计页面上出现的第三方平台字样 */
async function scan(page, url, name) {
  await page.goto(url, { waitUntil: "networkidle" })
  await page.waitForTimeout(600)
  const text = await page.locator("body").innerText()
  const hasQQ = text.includes("QQ")
  const hasWechat = text.includes("微信")
  const hasGitHub = text.includes("GitHub")
  const btn = await page.locator('a[href="/api/auth/github"]').count()
  console.log(`${name}: GitHub=${hasGitHub} QQ=${hasQQ} 微信=${hasWechat} github按钮=${btn} url=${page.url()}`)
  await page.screenshot({ path: `/tmp/oauth-${name}.png`, fullPage: true })
}

// 游客视角
const guest = await browser.newContext({ viewport: { width: 1280, height: 1000 } })
const guestPage = await guest.newPage()
watch(guestPage)
await scan(guestPage, "http://localhost:3000/login", "login")
await scan(guestPage, "http://localhost:3000/register", "register")

// 管理员视角
const admin = await browser.newContext({ viewport: { width: 1280, height: 1000 } })
await admin.addCookies([{ name: "fsp_session", value: `${enc}.${sig}`, domain: "localhost", path: "/" }])
const adminPage = await admin.newPage()
watch(adminPage)
await scan(adminPage, "http://localhost:3000/admin/oauth", "admin-oauth")
await scan(adminPage, "http://localhost:3000/admin", "admin")

console.log("控制台错误数:", errors.length)
errors.slice(0, 5).forEach((e) => console.log("  -", e))
await browser.close()
