/**
 * 用真 Chrome 跑一遍「访谈 → 方向」的客户端流程，验证不需要手动刷新。
 */
import { chromium } from "playwright-core"
import { createHmac } from "node:crypto"
import { readFileSync } from "node:fs"

const ROOT = "/Users/yuki/Documents/Yuki/projects/competitons/hdc/fsp"
const secret = JSON.parse(readFileSync(`${ROOT}/data/config.json`, "utf8")).security.sessionSecret
const payload = { account: "test01", name: "测试同学", exp: Math.floor(Date.now() / 1000) + 3600 }
const enc = Buffer.from(JSON.stringify(payload)).toString("base64url")
const sig = createHmac("sha256", secret).update(enc).digest("base64url")

const browser = await chromium.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
})
const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } })
await context.addCookies([{ name: "fsp_session", value: `${enc}.${sig}`, domain: "localhost", path: "/" }])

const page = await context.newPage()
const errors = []
page.on("console", (msg) => {
  if (msg.type() === "error") errors.push(msg.text())
})
page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`))

await page.goto("http://localhost:3000/onboarding", { waitUntil: "networkidle" })
console.log("进入:", page.url())

await page.waitForSelector('button:has-text("找一份技术岗")', { timeout: 25_000 })
await page.click('button:has-text("找一份技术岗")')
console.log("已答第 1 题")

await page.waitForSelector('button:has-text("完全没接触过")', { timeout: 25_000 })
await page.click('button:has-text("完全没接触过")')
console.log("已答第 2 题")

const started = Date.now()
await page.waitForSelector("text=为你匹配的方向", { timeout: 25_000 })
console.log(`PASS 无需刷新，${Date.now() - started}ms 后出现方向页`)
console.log("方向卡片数:", await page.locator("button[aria-pressed]").count())
console.log("步骤显示:", (await page.locator("header span").last().innerText()).trim())

await page.screenshot({ path: "/tmp/onboarding-directions.png", fullPage: true })

// 选一个方向 → 进入每日时长 → 确认页，确认每一步都自动切换
await page.locator("button[aria-pressed]").first().click()
await page.click('button:has-text("就选这个方向")')
await page.waitForSelector("text=每天学多久？", { timeout: 15_000 })
console.log("进入每日时长步: true")
await page.screenshot({ path: "/tmp/onboarding-goal.png", fullPage: true })

// 选时长后应立即进入确认页，并明确标注「离线模板」
await page.click('button:has-text("冲刺")')
await page.waitForSelector("text=一切就绪", { timeout: 15_000 })
const offlineWarn = await page.locator("text=离线模板").count()
console.log("确认页出现离线提示:", offlineWarn > 0)
console.log("步骤显示:", (await page.locator("header span").last().innerText()).trim())
await page.screenshot({ path: "/tmp/onboarding-confirm.png", fullPage: true })

console.log("控制台错误数:", errors.length)
for (const item of errors.slice(0, 5)) console.log("  -", item.slice(0, 160))

await browser.close()
