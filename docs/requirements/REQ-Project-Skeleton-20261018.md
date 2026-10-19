# 需求规格说明书：FSP 项目骨架完善

| 字段 | 值 |
|---|---|
| 文档 ID | REQ-Project-Skeleton-20261018 |
| 版本 | 1.1 |
| 创建日期 | 2026-10-18 |
| 状态 | 已实施 |
| 关联任务 | 完善项目骨架（对标 Nuxt 4 标准目录结构） |
| 依据文档 | `docs/TDD-Nuxt-Dev-Guide-202610181252.md` §2.4 |
| 技术栈 | Nuxt 4.6.1 + Vue 3.5 + @nuxt/content 3.16 + @nuxt/ui 4.12 + TailwindCSS 4 + TypeScript 6 |

---

## 1. 引言

### 1.1 任务描述

FSP 是一个基于 Nuxt 4 的内容管理系统（CMS）。当前项目已具备基础运行能力（根组件、内容路由、认证模块、全局样式入口等），但尚未完整对齐 `docs/TDD-Nuxt-Dev-Guide-202610181252.md` §2.4.1 所定义的 Nuxt 4 标准目录结构。

本任务的目标是：**在不破坏现有功能的前提下，补全缺失的标准目录与占位/示例文件，使项目结构完整符合 Nuxt 4 规范，为后续功能开发提供完整、可运行、可测试的脚手架。**

### 1.2 范围

**包含：**
- 创建缺失的 Nuxt 4 标准目录与占位/示例文件（`app/error.vue`、`app/layouts/`、`app/plugins/`、`server/middleware/`、`shared/` 等）
- 创建可运行的示例代码（health check API、日志中间件、共享类型/工具函数等）
- 对接现有 catch-all 路由的 404 错误处理

**不包含：**
- 不修改现有已符合规范的文件的核心逻辑（`app.vue`、`[...slug].vue`、`Alert.vue`、`CounterBox.vue`、`content/`、现有认证模块等）
- 不引入新的第三方依赖
- 不实现具体业务功能（占位文件仅为可运行示例，非业务实现）
- 不涉及数据库 schema、部署架构、CI/CD 流水线设计

### 1.3 术语与缩略语

| 术语 | 定义 |
|---|---|
| EARS | Easy Approach to Requirements Syntax，需求语句结构化语法，使用 WHEN/WHILE/IF/THEN/UNLESS 关键词 |
| Nuxt 4 标准目录结构 | 由 `docs/TDD-Nuxt-Dev-Guide-202610181252.md` §2.4.1 定义的 `app/` + `server/` + `shared/` 三层结构 |
| catch-all 路由 | `app/pages/[...slug].vue`，匹配所有未明确声明的路径 |
| 占位文件 | 包含可运行示例代码或合理默认实现的文件，非空文件 |
| 自动导入 | Nuxt 对 `app/components/`、`app/composables/`、`app/utils/`、`shared/` 等目录的无需手动 import 的机制 |

---

## 2. 利益相关者与目标

### 2.1 利益相关者

| 利益相关者 | 关注点 |
|---|---|
| 后续功能开发者 | 项目结构完整、约定清晰、可直接在标准位置新增代码 |
| 代码审查者 | 结构符合 Nuxt 4 规范、TypeScript 类型安全、ESLint 通过 |
| 测试工程师 | 占位文件可运行、可被单元测试/E2E 测试覆盖 |
| 运维/部署 | health check API 可用于健康探测 |
| 竞赛评委（HDC） | 项目工程化程度、规范对齐情况 |

### 2.2 业务目标

1. **结构对齐**：项目目录 100% 覆盖 Nuxt 4 标准结构中适用于本项目的目录
2. **脚手架可用**：所有新增占位文件可运行、可编译、不引入运行时错误
3. **零回归**：现有功能（内容渲染、认证流程、组件自动导入）行为不变
4. **示范性**：示例代码体现 Nuxt 4 最佳实践，可直接作为后续开发模板

### 2.3 成功标准

- `npm run dev` 启动无错误
- `npm run build` 构建成功
- 现有页面（`/`、`/about`、`/login`、`/account` 等）行为与骨架完善前一致
- 访问不存在路径时，`error.vue` 正确渲染 404 页面
- `GET /api/health` 返回 200 与健康状态 JSON
- ESLint 检查通过（`npx eslint .` 无 error）

---

## 3. 当前状态分析

### 3.1 已存在且符合规范的结构（保持不变）

| 路径 | 状态 | 说明 |
|---|---|---|
| `app/app.vue` | ✅ 已存在 | 根组件，含 UApp + NuxtRouteAnnouncer + NuxtPage |
| `app/app.config.ts` | ✅ 已存在 | 已配置 ui.colors（primary=teal, neutral=slate） |
| `app/assets/css/main.css` | ✅ 已存在 | 已含 TailwindCSS + @nuxt/ui 入口 + 主题变量 |
| `app/components/Alert.vue` | ✅ 已存在 | Alert 组件 |
| `app/components/CounterBox.vue` | ✅ 已存在 | Counter 组件 |
| `app/composables/useAuth.ts` | ✅ 已存在 | 认证组合式函数（完整实现） |
| `app/middleware/a.CheckUser.global.ts` | ✅ 已存在 | 全局认证中间件（默认放行策略） |
| `app/pages/[...slug].vue` | ✅ 已存在 | catch-all 内容路由 |
| `app/pages/index.vue`、`account.vue`、`login.vue`、`test.vue` | ✅ 已存在 | 页面路由 |
| `app/types/page-meta.d.ts` | ✅ 已存在 | 页面 meta 类型定义 |
| `app/utils/auth.ts` | ✅ 已存在 | 认证工具函数 |
| `server/api/auth/login.post.ts`、`logout.post.ts`、`me.get.ts` | ✅ 已存在 | 认证 API |
| `server/utils/session.ts` | ✅ 已存在 | 服务端会话工具 |
| `nuxt.config.ts` 的 `css: ["~/assets/css/main.css"]` | ✅ 已注册 | 全局样式入口已配置 |

### 3.2 缺失需补全的标准结构

| 路径 | 状态 | 用途 |
|---|---|---|
| `app/error.vue` | ❌ 缺失 | 自定义错误页（404/500 统一展示） |
| `app/layouts/default.vue` | ❌ 缺失 | 默认布局组件 |
| `app/plugins/` | ❌ 缺失 | 插件目录（需示例插件占位） |
| `app/composables/useExample.ts` | ❌ 缺失 | 组合式函数示例（与 useAuth.ts 并存） |
| `app/utils/format.ts` | ❌ 缺失 | 工具函数示例（与 auth.ts 并存） |
| `server/api/health.get.ts` | ❌ 缺失 | health check API |
| `server/middleware/log.ts` | ❌ 缺失 | 服务端日志中间件示例 |
| `shared/types/` | ❌ 缺失 | 共享类型定义目录 |
| `shared/utils/` | ❌ 缺失 | 共享工具函数目录 |

---

## 4. 功能需求（EARS 格式）

> EARS 关键词说明：`WHEN`（事件驱动）、`WHILE`（状态驱动）、`IF...THEN`（条件）、`UNLESS`（例外）、`SHALL`（强制）、`MAY`（可选）。

### FR-1：自定义错误页面（app/error.vue）

| 编号 | 需求语句（EARS） |
|---|---|
| FR-1.1 | **WHEN** 应用抛出 `error.statusCode` 等于 404 的 fatal error，**THE SYSTEM SHALL** 渲染 404 友好提示页，包含错误说明与"返回首页"入口（使用 `UButton` 组件，`to="/"`）。 |
| FR-1.2 | **WHEN** 应用抛出 `error.statusCode` 等于 500 的 error，**THE SYSTEM SHALL** 渲染 500 错误提示页，包含错误说明与"返回首页"入口。 |
| FR-1.3 | **WHEN** `error.vue` 接收到 `error` prop，**THE SYSTEM SHALL** 展示 `error.statusCode` 与 `error.message`，并使用 `clearError` 提供错误清除能力。 |
| FR-1.4 | **IF** `error.statusCode` 不属于已知集合 {400, 401, 403, 404, 500}，**THEN** **THE SYSTEM SHALL** 回退到通用错误展示，使用传入的 statusCode 与 message。 |
| FR-1.5 | **WHILE** 渲染错误页，**THE SYSTEM SHALL** 使用 `UContainer` 包裹内容并应用 TailwindCSS 样式，保持与站点整体视觉一致。 |
| FR-1.6 | **WHEN** 用户在错误页点击"返回首页"，**THE SYSTEM SHALL** 调用 `clearError({ redirect: '/' })` 清除错误状态并导航至首页。 |
| FR-1.7 | **WHEN** 现有 `app/pages/[...slug].vue` 在内容不存在时抛出 `createError({ statusCode: 404, fatal: true })`，**THE SYSTEM SHALL** 由 `error.vue` 接管渲染，**UNLESS** 该错误已被页面内 try/catch 自行处理。 |

### FR-2：默认布局（app/layouts/default.vue）

| 编号 | 需求语句（EARS） |
|---|---|
| FR-2.1 | **WHEN** 页面未通过 `definePageMeta({ layout })` 指定布局，**THE SYSTEM SHALL** 使用 `default` 布局渲染该页面。 |
| FR-2.2 | **WHEN** `default.vue` 布局渲染，**THE SYSTEM SHALL** 包含 `<slot />`（用于注入 NuxtPage 内容）并使用 `UContainer` 提供响应式宽度容器。 |
| FR-2.3 | **WHILE** 使用 `default` 布局，**THE SYSTEM SHALL** 保持现有 `app.vue` 的 `UApp` 包裹结构不被破坏（布局在 `UApp` 内部渲染）。 |
| FR-2.4 | **WHEN** `app.vue` 当前直接渲染 `<NuxtPage />`，**THE SYSTEM MAY** 保持现状不强制引入 `NuxtLayout`（默认布局作为可选能力存在，供后续页面按需引用），**UNLESS** 引入布局不会破坏现有渲染。 |

### FR-3：插件目录与示例（app/plugins/）

| 编号 | 需求语句（EARS） |
|---|---|
| FR-3.1 | **WHEN** Nuxt 启动，**THE SYSTEM SHALL** 按文件名排序顺序执行 `app/plugins/` 下的插件。 |
| FR-3.2 | **WHEN** 示例插件 `app/plugins/01.init.ts` 被加载，**THE SYSTEM SHALL** 成功执行 `defineNuxtPlugin` 且不抛出异常（示例可为空实现或注册一个无害的全局属性）。 |
| FR-3.3 | **WHILE** 插件执行，**THE SYSTEM SHALL** 不阻塞应用启动、不修改现有全局状态。 |

### FR-4：组合式函数示例（app/composables/useExample.ts）

| 编号 | 需求语句（EARS） |
|---|---|
| FR-4.1 | **WHEN** 调用 `useExample()`，**THE SYSTEM SHALL** 返回包含响应式状态（`ref`/`computed`）与方法的对象，符合 Nuxt 组合式函数自动导入规范。 |
| FR-4.2 | **WHEN** `useExample` 在 SSR 与客户端均被调用，**THE SYSTEM SHALL** 行为一致且不产生 hydration mismatch。 |
| FR-4.3 | **WHEN** `app/composables/` 目录已存在 `useAuth.ts`，**THE SYSTEM SHALL** 新增 `useExample.ts` 与之并存，不修改 `useAuth.ts`。 |

### FR-5：工具函数示例（app/utils/format.ts）

| 编号 | 需求语句（EARS） |
|---|---|
| FR-5.1 | **WHEN** 调用 `app/utils/format.ts` 导出的工具函数，**THE SYSTEM SHALL** 返回符合 TypeScript 签名的结果，且函数为纯函数（无副作用）。 |
| FR-5.2 | **WHEN** `app/utils/` 目录已存在 `auth.ts`，**THE SYSTEM SHALL** 新增 `format.ts` 与之并存，不修改 `auth.ts`。 |
| FR-5.3 | **WHILE** 工具函数被自动导入，**THE SYSTEM SHALL** 无需手动 import 即可在 `app/` 任意位置直接调用。 |

### FR-6：服务端 Health Check API（server/api/health.get.ts）

| 编号 | 需求语句（EARS） |
|---|---|
| FR-6.1 | **WHEN** 客户端或探针请求 `GET /api/health`，**THE SYSTEM SHALL** 返回 HTTP 200 与 JSON 体 `{ "status": "ok", "timestamp": <ISO8601字符串> }`。 |
| FR-6.2 | **WHILE** 服务端运行正常，**THE SYSTEM SHALL** health check 响应时间小于 50ms（本地环境）。 |
| FR-6.3 | **WHEN** health check 处理完成，**THE SYSTEM SHALL** 不读取或写入任何持久化存储、不依赖外部服务。 |
| FR-6.4 | **IF** health check 执行过程中发生未预期异常，**THEN** **THE SYSTEM SHALL** 返回 HTTP 500 与 `{ "status": "error" }`，不泄露内部堆栈信息。 |

### FR-7：服务端日志中间件（server/middleware/log.ts）

| 编号 | 需求语句（EARS） |
|---|---|
| FR-7.1 | **WHEN** 每次服务端请求到达，**THE SYSTEM SHALL** 执行 `server/middleware/log.ts` 中间件，记录请求方法与请求路径。 |
| FR-7.2 | **WHILE** 日志中间件执行，**THE SYSTEM SHALL** 不阻断请求、不修改响应内容、不抛出异常导致请求失败。 |
| FR-7.3 | **WHEN** 日志中间件记录完成，**THE SYSTEM SHALL** 调用 `event.next()` 放行请求至后续处理器。 |
| FR-7.4 | **WHEN** 请求路径以 `/_` 开头（Nuxt 内部资源）或为静态资源，**THE SYSTEM MAY** 跳过日志记录以减少噪音，**UNLESS** 调试模式开启。 |

### FR-8：共享类型定义（shared/types/）

| 编号 | 需求语句（EARS） |
|---|---|
| FR-8.1 | **WHEN** 前端（`app/**`）或后端（`server/**`）引用 `shared/types/` 导出的类型，**THE SYSTEM SHALL** 通过 Nuxt 4 自动导入机制无需手动 import 即可使用。 |
| FR-8.2 | **WHEN** `shared/types/` 新增示例类型（如 `User`、`ApiResponse<T>`），**THE SYSTEM SHALL** 为纯类型定义（`interface`/`type`），不包含运行时逻辑、不依赖 Vue 或 Node 特有 API。 |
| FR-8.3 | **WHILE** 类型在前后端共享，**THE SYSTEM SHALL** 保证类型在两端解析一致，不产生环境差异。 |

### FR-9：共享工具函数（shared/utils/）

| 编号 | 需求语句（EARS） |
|---|---|
| FR-9.1 | **WHEN** 前端或后端引用 `shared/utils/` 导出的函数，**THE SYSTEM SHALL** 通过自动导入机制直接可用。 |
| FR-9.2 | **WHEN** `shared/utils/` 新增示例函数（如 `validateEmail`、`formatDate`），**THE SYSTEM SHALL** 为纯函数，不依赖 Vue、Node 或浏览器特有 API，可在前后端任意环境执行。 |
| FR-9.3 | **IF** 共享函数被服务端调用，**THEN** **THE SYSTEM SHALL** 不访问 `window`、`document` 等浏览器全局对象。 |
| FR-9.4 | **IF** 共享函数被客户端调用，**THEN** **THE SYSTEM SHALL** 不访问 `process`、`fs` 等 Node 模块。 |

### FR-10：全局样式入口注册（保持）

| 编号 | 需求语句（EARS） |
|---|---|
| FR-10.1 | **WHILE** `nuxt.config.ts` 的 `css` 选项包含 `"~/assets/css/main.css"`，**THE SYSTEM SHALL** 加载 TailwindCSS 与 @nuxt/ui 样式（当前已注册，保持不变）。 |
| FR-10.2 | **WHEN** `app/assets/css/main.css` 已存在且含 `@import "tailwindcss"` 与 `@import "@nuxt/ui"`，**THE SYSTEM SHALL** 不修改该文件内容。 |

### FR-11：零回归保护

| 编号 | 需求语句（EARS） |
|---|---|
| FR-11.1 | **WHEN** 完善骨架过程中，**THE SYSTEM SHALL** 不修改以下现有文件的核心逻辑：`app/app.vue`、`app/pages/[...slug].vue`、`app/components/Alert.vue`、`app/components/CounterBox.vue`、`content/` 目录下所有文件、`app/composables/useAuth.ts`、`app/middleware/a.CheckUser.global.ts`、`app/utils/auth.ts`、`server/api/auth/*`、`server/utils/session.ts`。 |
| FR-11.2 | **WHEN** 完善骨架后启动 `npm run dev`，**THE SYSTEM SHALL** 现有页面（`/`、`/about`、`/login`、`/account`）渲染结果与完善前一致。 |
| FR-11.3 | **WHEN** 完善骨架后运行现有测试（`npm test`），**THE SYSTEM SHALL** 不引入新的测试失败。 |
| FR-11.4 | **WHEN** 现有全局认证中间件 `a.CheckUser.global.ts` 执行，**THE SYSTEM SHALL** 其行为与骨架完善前完全一致。 |

### FR-12：nuxt.config.ts 配置补充（仅必要时）

| 编号 | 需求语句（EARS） |
|---|---|
| FR-12.1 | **WHEN** 骨架完善需要新增配置项（如 `app.head`、`runtimeConfig`），**THE SYSTEM MAY** 修改 `nuxt.config.ts`，**UNLESS** 该配置已存在。 |
| FR-12.2 | **WHEN** 修改 `nuxt.config.ts`，**THE SYSTEM SHALL** 仅追加配置项，不删除或变更现有配置（modules、devtools、css、compatibilityDate、app.head）。 |

---

## 5. 非功能需求

### 5.1 可维护性（NFR-M）

| 编号 | 需求语句（EARS） |
|---|---|
| NFR-M.1 | **WHEN** 新增占位文件，**THE SYSTEM SHALL** 包含 JSDoc/TSDoc 注释说明文件用途与用法，便于后续开发者理解。 |
| NFR-M.2 | **WHILE** 维护骨架文件，**THE SYSTEM SHALL** 每个文件单一职责，文件名语义化，符合 Nuxt 4 命名约定。 |
| NFR-M.3 | **WHEN** 后续开发者需新增同类文件，**THE SYSTEM SHALL** 可直接参考对应占位文件作为模板。 |

### 5.2 规范性（NFR-S）

| 编号 | 需求语句（EARS） |
|---|---|
| NFR-S.1 | **WHEN** 创建 `.ts` 与 `.vue` 文件，**THE SYSTEM SHALL** 使用 TypeScript（`lang="ts"`），提供完整类型标注。 |
| NFR-S.2 | **WHILE** 编写代码，**THE SYSTEM SHALL** 遵循 ESLint 规范：无分号、单引号、2 空格缩进（与现有代码风格一致）。 |
| NFR-S.3 | **WHEN** 执行 `npx eslint .`，**THE SYSTEM SHALL** 不产生 error 级别违规。 |
| NFR-S.4 | **WHEN** 创建 Vue 组件，**THE SYSTEM SHALL** 使用 @nuxt/ui 组件（`UButton`、`UContainer`、`UApp` 等）而非原生 HTML，保持 UI 一致性。 |
| NFR-S.5 | **WHILE** 文件组织，**THE SYSTEM SHALL** 严格遵循 Nuxt 4 `app/` + `server/` + `shared/` 三层边界，跨端纯逻辑放 `shared/`，服务端逻辑放 `server/`，Vue 渲染放 `app/`。 |

### 5.3 兼容性（NFR-C）

| 编号 | 需求语句（EARS） |
|---|---|
| NFR-C.1 | **WHEN** 骨架完善完成，**THE SYSTEM SHALL** 兼容现有 Node.js 18.x+ 运行时（推荐 20.x LTS）。 |
| NFR-C.2 | **WHEN** 骨架完善完成，**THE SYSTEM SHALL** `npm run build` 构建成功，不产生 TypeScript 编译错误。 |
| NFR-C.3 | **WHILE** SSR 与客户端 hydration，**THE SYSTEM SHALL** 占位文件不产生 hydration mismatch 警告。 |
| NFR-C.4 | **WHEN** 现有 `tsconfig.json` 引用 `.nuxt/` 生成类型，**THE SYSTEM SHALL** 新增文件类型可被 TypeScript 正确解析。 |

### 5.4 可测试性（NFR-T）

| 编号 | 需求语句（EARS） |
|---|---|
| NFR-T.1 | **WHEN** 为占位文件编写测试，**THE SYSTEM SHALL** 示例函数/API/组件可被 Vitest（单元/Nuxt 环境）与 Playwright（E2E）覆盖。 |
| NFR-T.2 | **WHEN** 测试 `GET /api/health`，**THE SYSTEM SHALL** 可通过 `@nuxt/test-utils` 的 `createApp` 或直接 HTTP 请求验证响应。 |
| NFR-T.3 | **WHEN** 测试 `error.vue`，**THE SYSTEM SHALL** 可通过传入模拟 error prop 验证渲染输出。 |

### 5.5 安全性（NFR-Sec）

| 编号 | 需求语句（EARS） |
|---|---|
| NFR-Sec.1 | **WHEN** 服务端日志中间件记录请求，**THE SYSTEM SHALL** 不记录敏感信息（cookie、authorization 头、请求体）。 |
| NFR-Sec.2 | **WHEN** `error.vue` 展示错误信息，**THE SYSTEM SHALL** 在生产环境不泄露完整堆栈跟踪，仅展示 statusCode 与友好 message。 |

---

## 6. 约束

| 编号 | 约束内容 |
|---|---|
| CON-1 | **不破坏现有功能**：禁止修改 `app/app.vue`、`app/pages/[...slug].vue`、`app/components/Alert.vue`、`app/components/CounterBox.vue`、`content/` 下文件、`app/composables/useAuth.ts`、`app/middleware/a.CheckUser.global.ts`、`app/utils/auth.ts`、`server/api/auth/*`、`server/utils/session.ts` 的核心逻辑。 |
| CON-2 | **遵循 Nuxt 4 约定**：使用 `app/` 目录结构，TypeScript 优先，依赖自动导入规范，不手动 import 自动导入范围内的模块。 |
| CON-3 | **使用项目已有技术栈**：UI 用 @nuxt/ui 组件（`UButton`、`UContainer`、`UApp` 等），样式用 TailwindCSS 4，不引入新 UI 库或 CSS 框架。 |
| CON-4 | **占位文件非空**：所有新增文件必须包含可运行的示例代码或合理默认实现，禁止创建空文件。 |
| CON-5 | **error.vue 对接现有 404**：需处理 `createError({ statusCode: 404, fatal: true })` 形式的错误。 |
| CON-6 | **全局样式入口已注册**：`nuxt.config.ts` 已含 `css: ["~/assets/css/main.css"]`，无需重复注册；如需修改 nuxt.config.ts 仅允许追加配置。 |
| CON-7 | **中间件不阻断路由**：全局路由中间件与服务端中间件示例仅做日志或放行，不阻断正常访问。 |
| CON-8 | **全 TypeScript**：所有 `.ts` 与 `.vue` 文件使用 `lang="ts"`，提供类型标注。 |
| CON-9 | **ESLint 规范**：无分号、单引号、2 空格缩进，与现有代码风格一致。 |
| CON-10 | **不引入新依赖**：仅使用 `package.json` 中已声明的依赖，不新增第三方包。 |
| CON-11 | **shared/ 纯逻辑**：`shared/` 下代码不依赖 Vue 或 Node 特有 API，保证前后端可共享。 |

---

## 7. 验收标准

### 7.1 结构验收

| 编号 | 验收条件 |
|---|---|
| AC-1 | `app/error.vue` 存在且为有效的 Vue SFC（含 `<script setup lang="ts">` 与 `<template>`） |
| AC-2 | `app/layouts/default.vue` 存在且包含 `<slot />` |
| AC-3 | `app/plugins/` 目录存在且至少含一个示例插件文件（如 `01.init.ts`） |
| AC-4 | `app/composables/useExample.ts` 存在且导出 `useExample` 函数 |
| AC-5 | `app/utils/format.ts` 存在且导出至少一个纯函数 |
| AC-6 | `server/api/health.get.ts` 存在且导出 `defineEventHandler` |
| AC-7 | `server/middleware/log.ts` 存在且导出 `defineEventHandler` 并调用 `event.next()` |
| AC-8 | `shared/types/` 目录存在且至少含一个类型定义文件 |
| AC-9 | `shared/utils/` 目录存在且至少含一个纯函数文件 |

### 7.2 运行时验收

| 编号 | 验收条件 |
|---|---|
| AC-10 | `npm run dev` 启动成功，控制台无 error 级别日志 |
| AC-11 | `npm run build` 构建成功，退出码为 0 |
| AC-12 | 访问不存在路径（如 `/this-page-does-not-exist`）时，渲染 `error.vue` 的 404 内容，HTTP 状态码为 404 |
| AC-13 | 请求 `GET /api/health` 返回 HTTP 200，响应体为 `{ "status": "ok", "timestamp": "<ISO8601>" }` |
| AC-14 | 访问现有页面（`/`、`/about`、`/login`）渲染结果与骨架完善前一致 |
| AC-15 | 服务端日志中间件在每次请求时输出请求方法与路径，不阻断请求 |

### 7.3 质量验收

| 编号 | 验收条件 |
|---|---|
| AC-16 | `npx eslint .` 执行无 error 级别违规 |
| AC-17 | `npx tsc --noEmit`（或 `vue-tsc`）类型检查通过 |
| AC-18 | 现有测试套件（`npm test`）不产生新的失败 |
| AC-19 | 所有新增文件含 TSDoc 注释说明用途 |
| AC-20 | `shared/` 下文件不引用 Vue 或 Node 特有 API（可通过 grep 验证无 `vue`、`process`、`fs` 等导入） |

### 7.4 零回归验收

| 编号 | 验收条件 |
|---|---|
| AC-21 | `app/app.vue` 内容未被修改（与完善前 git diff 为空） |
| AC-22 | `app/pages/[...slug].vue` 内容未被修改 |
| AC-23 | `app/composables/useAuth.ts` 内容未被修改 |
| AC-24 | `app/middleware/a.CheckUser.global.ts` 内容未被修改 |
| AC-25 | `server/api/auth/` 下文件内容未被修改 |
| AC-26 | `nuxt.config.ts` 仅允许追加配置项，不删除现有 modules/devtools/css/compatibilityDate/app.head |

---

## 8. 附录：建议文件清单

### 8.1 需新建文件

| 序号 | 文件路径 | 简要内容说明 |
|---|---|---|
| 1 | `app/error.vue` | 自定义错误页，接收 `error` prop，按 statusCode 分支渲染 404/500/通用错误，使用 `UContainer` + `UButton`，提供 `clearError` 返回首页 |
| 2 | `app/layouts/default.vue` | 默认布局，`UContainer` 包裹 `<slot />`，供页面按需通过 `definePageMeta({ layout: 'default' })` 引用 |
| 3 | `app/plugins/01.init.ts` | 示例插件，`defineNuxtPlugin` 空实现或注册一个无害的 nuxtApp provide，数字前缀控制执行顺序 |
| 4 | `app/composables/useExample.ts` | 组合式函数示例，返回响应式 `ref` 状态与一个示例方法，演示自动导入规范 |
| 5 | `app/utils/format.ts` | 工具函数示例，导出纯函数（如 `formatDate(date: Date): string`），演示 `app/utils/` 自动导入 |
| 6 | `server/api/health.get.ts` | Health check API，`defineEventHandler` 返回 `{ status: 'ok', timestamp: new Date().toISOString() }` |
| 7 | `server/middleware/log.ts` | 服务端日志中间件，记录请求方法与路径后 `event.next()` 放行，不阻断请求 |
| 8 | `shared/types/index.ts` | 共享类型定义，导出 `User`、`ApiResponse<T>` 等示例类型，纯类型无运行时逻辑 |
| 9 | `shared/utils/validate.ts` | 共享工具函数，导出 `validateEmail(email: string): boolean` 等纯函数，前后端可用 |

### 8.2 需新建目录（由上述文件创建时自动生成）

- `app/layouts/`
- `app/plugins/`
- `shared/`
- `shared/types/`
- `shared/utils/`
- `server/middleware/`

### 8.3 保持不变的文件（零回归保护对象）

- `app/app.vue`、`app/app.config.ts`、`app/assets/css/main.css`
- `app/components/Alert.vue`、`app/components/CounterBox.vue`
- `app/composables/useAuth.ts`
- `app/middleware/a.CheckUser.global.ts`
- `app/pages/[...slug].vue`、`app/pages/index.vue`、`app/pages/account.vue`、`app/pages/login.vue`、`app/pages/test.vue`
- `app/types/page-meta.d.ts`
- `app/utils/auth.ts`
- `server/api/auth/login.post.ts`、`server/api/auth/logout.post.ts`、`server/api/auth/me.get.ts`
- `server/utils/session.ts`
- `content/index.md`、`content/about.md`
- `nuxt.config.ts`（仅允许追加，不删改现有项）

### 8.4 可选修改的文件

| 文件 | 修改条件 | 允许的修改 |
|---|---|---|
| `nuxt.config.ts` | 仅当骨架完善需要新增配置项时 | 追加 `runtimeConfig`、`app.head.meta` 等配置，不删除现有项 |

---

## 9. 变更记录

| 版本 | 日期 | 变更说明 | 作者 |
|---|---|---|---|
| 1.0 | 2026-10-18 | 初始版本，基于项目实际状态与开发文档 §2.4 生成 | spec-requirement-agent |
| 1.1 | 2026-10-18 | 依据评审反馈调整并实施：① 移除 Nuxt Starter 官方示例（`content/index.md`、`content/about.md`、`app/components/Alert.vue`、`app/components/CounterBox.vue`，`app/components/` 目录删除）；② `error.vue` 扩展覆盖 401/403；③ `layouts/default.vue` 最小化、不含 `UApp`（避免与 `app.vue` 嵌套重复）；④ `useExample.ts` 改为实用型 `useToggle.ts`；⑤ 明确 `shared/types` 与 `app/types` 分工；⑥ 修正代码风格假设——实际项目为 **Tab 缩进 + 双引号 + 无分号**（原规格误记为 2 空格 + 单引号）。 | CodeArts |

---

**文档结束**
