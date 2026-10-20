/**
 * 验证「降级路径」提示与「重新生成」按钮。
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
const context = await browser.newContext({ viewport: { width: 1280, height: 1100 } })
await context.addCookies([{ name: "fsp_session", value: `${enc}.${sig}`, domain: "localhost", path: "/" }])
const page = await context.newPage()

await page.goto("http://localhost:3000/learning", { waitUntil: "networkidle" })
const banner = page.locator("text=离线模板")
console.log("出现降级提示:", (await banner.count()) > 0)
await page.screenshot({ path: "/tmp/learning-degraded.png", fullPage: true })

const regen = page.locator('button:has-text("重新生成")')
console.log("有重新生成按钮:", (await regen.count()) > 0)

if (await regen.count()) {
  await regen.first().click()
  await page.waitForSelector("text=已重新生成", { timeout: 60_000 }).catch(() => {})
  const toastText = await page.locator("text=已重新生成").count()
  console.log("重新生成完成:", toastText > 0)
  await page.waitForTimeout(800)
  await page.screenshot({ path: "/tmp/learning-after-regen.png", fullPage: true })
}

await browser.close()
