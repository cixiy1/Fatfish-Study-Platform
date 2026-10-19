---
name: FSP 交接提示词（给继续开发的 Agent）
description: 自包含的开发交接提示词，含合规红线、项目现状、环境坑、技术约束、交付范围与工作纪律
type: PROMPT
---

# FSP 继续开发 · Agent 交接提示词

> **用法**：把「第 0 节 ~ 第 9 节」整段复制给接手开发的 Agent（可在华为云码道里直接粘贴）。
> 它看不到任何历史对话，本文所有信息自包含。
> 最后更新：2026-10-19 12:27 · 距离初赛提交截止（2026-10-24）剩 5 天。

---

## 0. 你的任务

你接手一个名为 **FSP** 的比赛项目，参加「华为开发者大赛 · 广东机电职业技术学院 · AI 自主学习系统设计大赛（华为云码道赛题，赛道 ID 1300000322）」。

目标：在 10-24 前交付一个**能跑通的 AI 自主学习系统**，主线闭环是

```
登录 → 10 题诊断测评 → 三维画像 → 选目标岗位 → 岗位技能图谱与差距
→ 生成学习路径 → 学今日技能点 → RAG 答疑（带引用）→ 阶段测评
→ 掌握度更新 → 路径自动重排
```

技术栈固定：Nuxt 4（Nitro SSR）+ `@nuxt/ui` v4 + `@nuxt/content` v3 + SQLite（`better-sqlite3`）+ 华为云 MaaS（OpenAI 兼容，允许 mock 兜底）。

**当前代码只有骨架**：Nuxt Content starter + 一个可用的登录页 + 一个已跑通的路由守卫。六大业务模块**一个都没实现**。你的工作是从 D1 收尾开始，一天一个模块往前推。

---

## 1. 不可协商的合规红线（优先级高于代码质量）

1. **核心开发必须在华为云码道（CodeArts 编程智能体）里完成**，不是"用过"，是"主要开发发生在它里面"。额度或网络不稳时，可本地 IDE 写、码道里补"重构 / 排错 / 文档"环节的对话。
2. **必须留使用痕迹**：每个功能点开发完立刻截 **3 张图** —— ① Prompt 输入 ② 生成结果 ③ 运行效果。存 `docs/submit/codearts-proof/YYYY-MM-DD/`，命名 `序号-环节-说明.png`（环节取值：`需求` / `生成` / `排错` / `测试` / `文档`）。
3. 痕迹是**过程产物**，当天不截就永远补不回来。所以你的**每一轮回复末尾都必须提醒用户「本轮该截哪 3 张图」**。
4. 作品必须原创；引入任何开源库要在 `docs/submit/readme/` 标注来源与协议。

---

## 2. 项目现状（开工前逐条读完，别猜）

### 2.1 已完成，可直接复用，**不要重写**

| 文件 | 状态 | 说明 |
|---|---|---|
| `app/pages/login.vue` | 可用 | `@nuxt/ui` 实现，左侧品牌区 + 右侧表单；`UForm` 校验、密码显隐、loading、回跳提示 |
| `app/composables/useAuth.ts` | 可用 | 登录态唯一来源 `useAuthSession()`：`user` / `isLoggedIn` / `resolveUser()` / `login()` / `logout()`；`useState` 缓存 + SSR 用 `useRequestFetch` 转发 cookie |
| `app/middleware/a.CheckUser.global.ts` | 可用 | 全局守卫：未登录跳 `/login?redirect=...`，已登录访问游客页反弹回 `redirect` |
| `app/utils/auth.ts` | 可用 | `safeRedirect()` 防开放重定向（只收单个 `/` 开头）、`GUEST_ONLY_PATHS` 白名单 |
| `server/utils/session.ts` | 可用（仅开发） | httpOnly cookie `fsp_session`，base64url 明文 JSON，**无签名** |
| `server/api/auth/{login.post,me.get,logout.post}.ts` | 可用（仅开发） | `login` 在 `!import.meta.dev` 时直接 501；开发期任意非空账号密码放行 |
| `app/pages/account.vue` | 可用 | 受保护页示例，`definePageMeta({ auth: true })` |
| `app/app.config.ts` | 已定 | `primary: "teal"`、`neutral: "slate"` |
| `app/assets/css/main.css` | 已定 | Tailwind + Nuxt UI 入口，含 `--ui-primary` 对比度覆盖 |
| `app/app.vue` | 已定 | `<UApp>` 包裹 + `<main>` 唯一 landmark + 全局 `<title>` |

### 2.2 已知陷阱（**踩了会浪费半天，全部是真实踩过的**）

| 陷阱 | 现象 | 正确做法 |
|---|---|---|
| `app/middleware/*.global.ts` 写成空文件 | 全站 500，`Object.defineProperty called on non-object` @ `virtual:nuxt:.nuxt/middleware.mjs` —— 缺 `export default` 会让 router 插件初始化就崩 | 任何全局中间件必须 `export default defineNuxtRouteMiddleware(...)` |
| `guestOnly` 与"默认全拦"同时命中 `/login` | `Infinite redirect in navigation guard`，全站 500 | `requiresAuth = to.meta.auth ?? (DEFAULT_REQUIRE_AUTH && !guestOnly)`，别让两项同时为真 |
| 回跳地址交给 vue-router 的 query 序列化 | 空格变 `+` 且回读不还原（`?x=a%20b` → `x=a+b`） | 必须手动 `encodeURIComponent`；SSR 下取 `useRequestURL().pathname + search` 拿原始编码 |
| 同时开两个 `nuxt dev` | 第二个和主实例共用 `.nuxt`，卡 503 / SSR 不返回 | **永远只开一个**，需要换端口先关掉旧的 |
| `curl localhost:3000` | 被本地代理拦成 503 | dev server 只监听 IPv6，用 `curl -6 "http://[::1]:3000/..."` |
| dev TUI 显示 `✖ 2 errors` | 日志是 `write EPIPE`，栈在 `WorkBuddy.app/.../broker-ipc-client.cjs` | 与项目无关，是环境注入的 `NODE_OPTIONS` shim；忽略，或在真终端 `env -u NODE_OPTIONS npm run dev` |
| `npx eslint a.ts b.ts c.ts` 一次跑多个文件 | 进程被 SIGTERM 杀掉（exit 137） | **逐个文件跑** `npx eslint <file>` |
| `<script>` 与 `<script setup lang="ts">` 语言类型不一致 | Vite Error `script and script setup must have the same language type` | 普通 `<script>` 也要写 `lang="ts"` |
| 想渲染 `content/` 下的 markdown | `/about` 虽然 200，但渲染的是 `[...slug].vue` 里写死的静态文本 | Nuxt Content v3 用 `queryCollection('content')` + `<ContentRenderer>`，不是 v2 的 `queryContent` |
| 登录页"看着多余"的代码 | 删了就坏 | `UInput class="w-full"`、`UButton type="button"`、`UFormField name`、`role="status"`、`aria-pressed`、装饰圆圈周围的 `relative` —— **一个都别删** |

### 2.3 一个待你确认的不一致

`app/middleware/a.CheckUser.global.ts` 第 12 行写的是 `const DEFAULT_REQUIRE_AUTH = true`，但同文件注释说"默认策略：放行（内容站常见做法）"。

实测当前行为：**除 `/login` 外全站 302 到登录页**（`/` `/test` `/about` `/account` 都被拦）。

这个状态对比赛 demo 其实**更合理**（评委进来必须先登录，才能看到画像和路径，不会看到空数据页），但注释和实现自相矛盾。**开工第一件事**：确认要哪种策略，然后把注释和常量统一。默认建议保留 `true`，并把注释改成"默认全拦（演示需要登录态），公开页用 `definePageMeta({ auth: false })` 开口子"。

---

## 3. 环境与命令

```bash
# 开发（只开一个实例）
npm run dev                      # http://localhost:3000 ，实际监听 [::1]:3000

# 探测（必须 IPv6）
curl -6 -s -o /dev/null -D - "http://[::1]:3000/" | grep -iE "^HTTP|^location"

# 登录后带 cookie 测试
curl -6 -s -c /tmp/jar.txt -X POST "http://[::1]:3000/api/auth/login" \
  -H "content-type: application/json" -d '{"account":"demo","password":"x"}'
curl -6 -s -b /tmp/jar.txt "http://[::1]:3000/api/..."

# 截图核对（macOS 已装 Chrome）
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless=new --no-first-run --disable-gpu --hide-scrollbars \
  --user-data-dir=/tmp/cs1 --screenshot=/tmp/shot.png --window-size=1440,900 \
  "http://[::1]:3000/"

# lint（逐个文件）
npx eslint app/pages/xxx.vue
```

- Node 22 / npm 环境已就绪，依赖已装齐（**不要 `npm install` 新依赖**，除非确实无法实现）。
- 测试栈已在：`vitest`（`test/unit`、`test/nuxt`）+ `playwright`（`tests/`）。时间紧，优先保证功能可运行，测试只写关键纯函数。

---

## 4. 技术约束（不许换栈、不许引重依赖）

| 层 | 规定 |
|---|---|
| 目录 | **Nuxt 4 结构**：页面/组件/组合式函数在 `app/` 下，`server/` 在根目录。别写到根级 `pages/` |
| UI | 只用 `@nuxt/ui` v4 的 `U*` 组件 + Tailwind 原子类；不引 Element/Vant/Ant |
| 颜色 | 主色 `teal` 已在 `app.config.ts` 定好；**`main.css` 里 `--ui-primary` 的覆盖必须留在 `@import "@nuxt/ui"` 之后**，否则对比度告警复现 |
| 内容 | 知识点写成 `content/**/*.md`，通过 `@nuxt/content` 读取，不建 CMS |
| 数据库 | SQLite + `better-sqlite3`（已装），DB 文件放 `.data/fsp.db`，建表用 `CREATE TABLE IF NOT EXISTS` 幂等脚本 |
| 图谱 | **JSON 技能树 + 自绘 SVG**，禁止引入 neo4j / d3 / cytoscape / vis-network |
| 大模型 | 华为云 MaaS（OpenAI 兼容接口），**必须留 mock 分支**：无 key 或请求失败时返回预置结果，保证演示不断流 |
| 校验 | 前端用 `UForm` 的 `:validate` 函数式校验；不引 zod |
| 可访问性 | `@nuxt/a11y` 在 dev 会报 axe：每个页面必须有 `<title>`、正文有 `<h1>`、内容在 `<main>` 内（`app.vue` 已提供）、交互元素有可读标签、对比度 ≥ 4.5:1。新页面直接照 `login.vue` 的结构抄 |

---

## 5. 本轮交付范围（详见 `docs/PLAN-Competition-TODO-202610191130.md`）

### 5.1 数据表（先建表，再写页面）

`users` / `profiles` / `jobs` / `skills` / `assessments` / `paths` / `mastery` / `chat_logs`
字段定义见 PLAN 文档 4.2 节，不要在没读 PLAN 的情况下自创表结构。

### 5.2 接口（`server/api/`）

| 方法 | 路径 | 作用 |
|---|---|---|
| POST | `/api/profile/assess` | 提交测评 → 三维画像 |
| GET | `/api/jobs` | 岗位列表 |
| GET | `/api/skills/graph?jobId=` | 技能图谱（节点 + 依赖边） |
| POST | `/api/path/generate` | 依画像 + 差距生成路径 |
| GET | `/api/path/today` | 今日任务 |
| POST | `/api/qa` | RAG 答疑，返回答案 + 引用片段 |
| POST | `/api/mastery` | 提交阶段测评，更新掌握度 |
| POST | `/api/path/replan` | 依掌握度重排路径 |

### 5.3 页面

`/`（门面）、`/onboarding`（测评）、`/profile`（画像）、`/jobs`（岗位）、`/skills/[id]`（图谱）、`/path`（路径 + 今日）、`/learn/[skillId]`（正文 + 侧边问答）、`/assessment`（阶段测评）。`/login`、`/account` 已有，复用。

### 5.4 多智能体

`server/utils/agent/{profiler,planner,tutor,evaluator}.ts` + `index.ts` 统一路由；
每个 Agent 的 system prompt 单独存 `server/utils/agent/prompts/*.md`（PPT 要展示 Prompt 设计）。

---

## 6. 工作方式（这决定你交付的质量）

1. **一次只做一个可验证的垂直切片**：表 → 种子数据 → 接口 → 页面，四步走通再进下一个。禁止一次性生成十个文件然后一起调。
2. **每改完一处立刻自证**：`curl` 看状态码 / 看 SSR HTML 关键字，或 headless 截图；不要"代码写完了就当作能跑"。
3. **先读再改**：改任何已有文件前先 `Read`，尤其 `login.vue`、`middleware`、`main.css`（见 2.2 陷阱表）。
4. **报错先定位再动手**：区分「项目 bug」与「dev 期噪声」（`Suspense experimental`、DevTools、webVitals 都是噪声，不用管）。
5. **不追求好看，先追求闭环**：宁可页面朴素但数据是真的，也不要精致假数据。DoD 是「`npm run dev` 下真实可用 + 有截图 + 能写进演示脚本的一句话」。
6. 时间不够就**降级实现**（PLAN 第 8 节有预案）：图谱降成卡片流、RAG 降成关键词匹配 + 引用原文、LLM 走 mock。降级要在代码注释和 PPT 里说清，不算失败。

---

## 7. 每轮回复必须包含（缺一不可）

```
1. 本轮改了什么       —— 文件清单 + 每个文件一句话作用
2. 为什么这么做       —— 关键设计取舍（1~3 条，别写流水账）
3. 怎么验证的         —— 实际执行的命令 + 真实输出片段（状态码 / 渲染结果）
4. 遗留与风险         —— 没做完的、占位的、需要在答辩时解释的
5. 本轮该截的 3 张图  —— 具体到「截哪个界面、配什么说明文字」
```

---

## 8. 明确不要做的事

- ❌ 重写登录页、`useAuth.ts`、`CheckUser.global.ts` 的既有逻辑（已验证跑通，改了要重测 8 个场景）
- ❌ 删除 `app/middleware/a.CheckUser.global.ts` 的 `export default` —— 会全站 500
- ❌ 同时启动两个 dev server
- ❌ 引入图数据库、UI 框架、状态管理库、ORM
- ❌ 把 `login.post.ts` 的开发期放行逻辑带进生产分支（它已用 `!import.meta.dev` 挡住，别拆这层保护）
- ❌ 在演示链路上依赖必须联网才能出结果（无 key 必须有 mock）
- ❌ 做到一半换技术方案（比如中途改 SSR 为纯前端、改 SQLite 为 JSON 文件）

---

## 9. 你的第一个任务（按序执行）

1. **统一中间件策略**：读 `app/middleware/a.CheckUser.global.ts`，确认 `DEFAULT_REQUIRE_AUTH` 用 `true` 还是 `false`，把注释改成与实现一致（见 2.3）。
2. **建库**：写 `server/utils/db.ts`（`better-sqlite3` 单例 + `CREATE TABLE IF NOT EXISTS` 幂等建表）与 `server/utils/seed.ts`（3 个岗位、30 个技能点、20 篇 `content/` 知识点 markdown）。
3. **换首页**：把 `app/pages/index.vue` 从 "Index" 换成项目门面（价值主张 + 三个入口：开始测评 / 看岗位 / 我的路径），保留 `<h1>` 与 `useHead`。
4. **自证**：`curl -6` 确认 `/` 200 且含主张文案；登录后确认能进首页；截图存档。
5. 汇报时按第 7 节的五段格式输出，并明确「D1 剩余任务是否清空」。

D1 清空后，直接进 D2（`/onboarding` 十题测评 + `/api/profile/assess` + `/profile` 画像页）。节奏按 PLAN 第 5 节，**每天结束前必须有可运行的东西**，因为 10-24 提交只能提交 1 次，没有回头补的时间。
