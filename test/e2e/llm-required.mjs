/**
 * 验证「大模型必填」在界面上的表现：
 * 1. 学生端 /onboarding 直接显示配置引导，不再进入访谈
 * 2. /learning 顶部提示大模型未配置、不显示「重新生成」
 * 3. 管理后台显示红色横幅，大模型卡片为「未配置（必填）」
 * 4. /admin/llm 顶部有未就绪提示
 */
import { chromium } from "playwright-core"
import { createHmac } from "node:crypto"
import { readFileSync } from "node:fs"

const ROOT = "/Users/yuki/Documents/Yuki/projects/competitons/hdc/fsp"
const secret = JSON.parse(readFileSync(`${ROOT}/data/config.json`, "utf8")).security.sessionSecret

function cookieFor(account) {
  const payload = { account, name: account, exp: Math.floor(Date.now() / 1000) + 3600 }
  const enc = Buffer.from(JSON.stringify(payload)).toString("base64url")
  const sig = createHmac("sha256", secret).update(enc).digest("base64url")
  return { name: "fsp_session", value: `${enc}.${sig}`, domain: "localhost", path: "/" }
}

const browser = await chromium.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
})

async function open(account, path) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 1100 } })
  await context.addCookies([cookieFor(account)])
  const page = await context.newPage()
  const errors = []
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text())
  })
  await page.goto(`http://localhost:3000${path}`, { waitUntil: "networkidle" })
  return { context, page, errors }
}

// 1. 学生端引导页
{
  const { context, page, errors } = await open("test01", "/onboarding")
  await page.waitForTimeout(600)
  console.log("引导页出现配置引导:", (await page.locator("text=先接入大模型，才能生成学习计划").count()) > 0)
  console.log("引导页没有访谈输入框:", (await page.locator("textarea").count()) === 0)
  console.log("非管理员看不到配置按钮:", (await page.locator('a:has-text("去配置大模型")').count()) === 0)
  await page.screenshot({ path: "/tmp/llm-required-onboarding.png", fullPage: true })
  console.log("控制台错误:", errors.length)
  await context.close()
}

// 2. 关卡页
{
  const { context, page } = await open("test01", "/learning")
  await page.waitForTimeout(600)
  console.log("关卡页提示未配置:", (await page.locator("text=平台还没有配置大模型接口").count()) > 0)
  console.log("非管理员看不到配置按钮:", (await page.locator('a:has-text("去配置大模型")').count()) === 0)
  await page.screenshot({ path: "/tmp/llm-required-learning.png", fullPage: true })
  await context.close()
}

// 3. 管理后台
{
  const { context, page } = await open("Yukiho", "/admin")
  await page.waitForTimeout(1200)
  console.log("后台出现红色横幅:", (await page.locator("text=大模型接口未就绪").count()) > 0)
  console.log("大模型卡片标记必填:", (await page.locator("text=未配置（必填）").count()) > 0)
  console.log("后台仍有其他配置卡片:", (await page.locator("text=SMTP 邮件配置").count()) > 0)
  await page.screenshot({ path: "/tmp/llm-required-admin.png", fullPage: true })
  await context.close()
}

// 4. 后台大模型配置页
{
  const { context, page } = await open("Yukiho", "/admin/llm")
  await page.waitForTimeout(1200)
  console.log("配置页出现未就绪提示:", (await page.locator("text=当前未就绪：平台 AI 功能处于停用状态").count()) > 0)
  console.log("配置页有必填徽标:", (await page.locator("text=必填").count()) > 0)
  await page.screenshot({ path: "/tmp/llm-required-admin-llm.png", fullPage: true })
  await context.close()
}

// 5. 管理员视角的引导页：直接给配置入口
{
  const { context, page } = await open("Yukiho", "/onboarding")
  await page.waitForTimeout(600)
  console.log("管理员看到配置按钮:", (await page.locator('a:has-text("去配置大模型")').count()) > 0)
  await page.screenshot({ path: "/tmp/llm-required-onboarding-admin.png", fullPage: true })
  await context.close()
}

await browser.close()
