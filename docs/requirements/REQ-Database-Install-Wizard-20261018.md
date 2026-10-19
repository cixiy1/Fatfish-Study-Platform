# 需求规格说明书：数据库接入 + 网络接口封装 + 首次部署 install 向导

| 字段 | 值 |
|---|---|
| 文档 ID | REQ-Database-Install-Wizard-20261018 |
| 版本 | 1.1 |
| 创建日期 | 2026-10-18 |
| 状态 | 已实施 |
| 关联任务 | ① 数据持久层接入 ② 服务端接口规范化封装 ③ 首次部署 install 初始化向导 |
| 依据文档 | `docs/TDD-Nuxt-Dev-Guide-202610181252.md`、`docs/requirements/REQ-Project-Skeleton-20261018.md` |
| 技术栈 | Nuxt 4.6.1 + Vue 3.5 + @nuxt/content 3.16 + @nuxt/ui 4.12 + TailwindCSS 4 + TipTap 3 + TypeScript 6 + Vitest 5 + Playwright |
| 部署形态 | **前后端不分离**：Nuxt/Nitro 一体部署（SSR + server API 同进程），不支持前后端分别部署 |

---

## 1. 引言

### 1.1 任务描述

FSP 是一个基于 Nuxt 4 的内容管理系统（CMS），采用 Nuxt/Nitro 一体部署（SSR 页面与服务端接口同进程，同源）。当前项目骨架完整、可运行，但**没有任何数据持久化能力**：

- `server/utils/session.ts` 用「无签名 base64 JSON cookie」作为开发占位会话，代码注释已自述"正式上线必须换成签名 JWT 或服务端 session store"；
- `server/api/auth/login.post.ts` 在非 dev 环境直接抛 `501 登录接口尚未接入真实鉴权`；
- `package.json` 已声明 `better-sqlite3 ^12.11.1`，但**尚无任何代码使用**；
- **无 `.env` 文件**，无任何数据库连接代码。

本任务目标是三件事：

1. **搭建数据库持久层**：引入真实数据持久化，替换占位会话方案，支撑管理员存储与登录凭证校验，并为后续内容业务预留扩展空间。
2. **封装网络接口**：在 `server/api/` 下规范化服务端接口（统一响应结构、统一错误码、参数校验、鉴权对接数据库），供 `app/` 下页面/组件通过 `$fetch`/`useFetch` 同源调用。
3. **首次部署 install 向导**：项目打包部署到自有服务器后，首次运行需通过 `/install` 页面在浏览器内完成数据库配置、管理员创建、站点常量初始化与持久化，而不是手工改配置文件。

### 1.2 范围

**包含：**

- 数据库连接建立与管理（连接初始化、复用、健康探测）
- 用户（管理员）与登录会话的数据模型与持久化
- 数据访问层封装（查询/写入/迁移），可被 Vitest 覆盖
- 密码哈希存储与凭证校验
- 会话签名（替换无签名 base64 占位）
- `server/api/` 接口规范化：统一响应结构、统一错误码、参数校验、鉴权对接数据库
- 前端调用规范（`$fetch`/`useFetch` 同源、SSR 下 cookie 传递）
- `/install` 初始化向导页：数据库配置、连通性测试、管理员创建、站点常量、初始化编排、防重复初始化、配置持久化
- 未安装/已安装状态下的访问控制（全局中间件 + 接口守卫）
- 安装状态探测接口
- 敏感信息保护（不进 git）

**不包含：**

- 不引入独立后端服务（前后端不分离，一切基于 Nuxt/Nitro 一体部署）
- 不实现内容业务表（文章/分类/标签等）——本任务仅聚焦用户表与会话表，并为内容业务预留扩展位
- 不实现注册、找回密码、第三方登录（微信/GitHub）等登录页占位功能
- 不实现完整的 RBAC 权限体系（仅预留 `role` 字段与最小角色判定）
- **不在本规格中确定任何第三方依赖方案**——所有依赖选型列入第 8 章「依赖选型待确认清单」，由用户决策
- 不涉及 CI/CD 流水线、容器化编排、反向代理/HTTPS 证书配置
- 不设计最终数据库物理结构（字段类型、索引、外键）——本规格仅给出**表结构草案**（见附录 A），最终以设计阶段为准

### 1.3 术语与缩略语

| 术语 | 定义 |
|---|---|
| EARS | Easy Approach to Requirements Syntax，需求语句结构化语法，使用 WHEN/WHILE/IF/THEN/UNLESS 关键词 |
| 前后端不分离 | Nuxt 以 Nitro 一体形式部署，前端页面与服务端接口运行在同一进程、同一端口、同源 |
| 未安装状态 | 服务端未找到有效持久化配置，或配置存在但未完成初始化标记的状态 |
| 已安装状态 | 初始化流程全部成功（建表、写入管理员、持久化配置、写入已安装标记）后的状态 |
| 安装标记 | 持久化配置中表示"已完成初始化"的字段/键，用于访问控制与防重复初始化 |
| 会话密钥（session secret） | 用于对会话令牌签名/校验的密钥，安装向导中生成或录入 |
| 连通性测试 | 使用用户填写的数据库参数尝试建立连接并执行最小探测查询，验证参数是否可用 |
| 迁移（migration） | 幂等地创建/升级数据库表结构的操作 |
| ApiResponse | `shared/types/index.ts` 中定义的统一响应结构 `{ code, message, data }` |
| 保护文件 | 本任务中不允许改动核心逻辑、或仅允许兼容性改动的既有文件（见 CON-1） |

---

## 2. 利益相关者与目标

### 2.1 利益相关者

| 利益相关者 | 关注点 |
|---|---|
| 运维/部署人员 | 首次部署能在浏览器内完成初始化，无需手工改 `.env` 或执行 SQL 脚本；配置持久化、重启生效 |
| 管理员（站点运营者） | 能用自建管理员账号登录后台；密码安全存储；站点常量（站名等）可配置 |
| 后续功能开发者 | 数据访问层与接口规范清晰、可复用；新增业务表有扩展位；类型安全 |
| 安全审查者 | 密码不明文存储；会话 cookie httpOnly 且签名；install 页不可被重复初始化；敏感配置不进 git |
| 测试工程师 | 数据库层与接口可被 Vitest 覆盖；install 流程可 E2E 验证 |
| 竞赛评委（HDC） | 工程化程度、需求/设计/任务可追溯性、规范对齐 |

### 2.2 业务目标

1. **可持久化**：用真实数据库替代占位会话，管理员与登录态在进程重启后依然有效、可校验。
2. **可初始化**：首次部署零手工干预，仅凭浏览器即可完成全部初始化。
3. **可防护**：避免占位会话被带上线；避免已安装实例被再次初始化；避免敏感信息泄露。
4. **可复用**：接口与数据层提供统一范式，后续业务可直接套用。
5. **零回归**：不破坏现有构建、测试与既有页面的对外契约。

### 2.3 成功标准

- `npm run build` 构建成功、`npm test` 无新增失败、`npx eslint .` 无 error。
- 全新环境（无配置、无数据库）访问任意页面被引导至 `/install`。
- 在 `/install` 内完成配置后，可用新管理员账号登录，重启服务后登录态与数据仍有效。
- 已安装后再次访问 `/install` 被拒绝。
- 数据库中用户密码字段非明文。
- 会话 cookie 为 httpOnly 且带签名，被篡改后视为未登录。
- 敏感配置文件不被 git 跟踪。

---

## 3. 当前状态分析

### 3.1 既有实现（现状）

| 组件 | 文件 | 现状 | 本任务处置 |
|---|---|---|---|
| 会话工具 | `server/utils/session.ts` | 无签名 base64 JSON cookie，cookie 名 `fsp_session` | **重写**为签名会话 + 数据库校验 |
| 登录接口 | `server/api/auth/login.post.ts` | dev 下任意非空账号放行；非 dev 抛 501 | **重写**为查库校验 + 哈希比对 |
| 登出接口 | `server/api/auth/logout.post.ts` | 清除 cookie | 增强：可选失效服务端会话记录 |
| 当前用户接口 | `server/api/auth/me.get.ts` | 读 cookie 直接返回 user | **重写**为校验签名（+ 可选查库） |
| 健康检查 | `server/api/health.get.ts` | 返回 `{ status, timestamp }` | 保持契约，可选附加数据库状态 |
| 请求日志中间件 | `server/middleware/log.ts` | dev 下打印方法+路径 | 保持 |
| 前端登录态 | `app/composables/useAuth.ts` | 依赖 `/api/auth/me`，检查 cookie 名 `fsp_session` | 保持契约；**若接口结构变更需同步适配** |
| 全局守卫 | `app/middleware/a.CheckUser.global.ts` | 默认全拦（`DEFAULT_REQUIRE_AUTH = true`），白名单 `GUEST_ONLY_PATHS` | **扩展**：叠加未安装 → `/install` 的引导逻辑 |
| 共享类型 | `shared/types/index.ts` | 已有 `ApiResponse<T>`、`Paginated<T>`、`HealthStatus` | 复用并扩展（新增 User、安装相关类型） |
| 共享校验 | `shared/utils/validate.ts` | 已有 `isValidEmail`、`isBlank`、`isStrongPassword` | 复用并扩展（端口、host、账号等） |
| 网络依赖 | `package.json` | 已声明 `better-sqlite3 ^12.11.1`（**未被任何代码使用**） | 是否启用见第 8 章 |
| 存储目录 | `.data/`（已被 `.gitignore` 忽略） | 含 `.data/content/contents.sqlite`（@nuxt/content 使用）、`.data/kv/` | 可作为 SQLite 落盘目录候选 |
| 环境文件 | `.env` | **不存在**；`.gitignore` 已忽略 `.env`、`.env.*`、`!.env.example` | 作为配置持久化候选位置之一 |

### 3.2 既有对外契约（**必须尽量兼容**）

| 接口 | 现有返回结构 | 现有错误结构 | 调用方 |
|---|---|---|---|
| `POST /api/auth/login` | `{ user: { account, name } }` | `createError({ statusCode: 400/501 })` | `app/composables/useAuth.ts` → `login()` |
| `POST /api/auth/logout` | `{ ok: true }` | — | `useAuth.ts` → `logout()` |
| `GET /api/auth/me` | `{ account, name }`（直接返回 user，**非包裹**） | `401 未登录` | `useAuth.ts` → `fetchMe()` |
| `GET /api/health` | `{ status: "ok", timestamp }` | — | 探针/监控 |

> ⚠️ **关键约束**：`useAuth.ts` 读取的是 `login` 的 `data.user` 与 `me` 的**顶层 user 对象**。若统一为 `ApiResponse` 包裹（`{ code, message, data }`），必须同步改造 `useAuth.ts`。二者取舍见 FR-2.6 与第 8 章 DEP-7，**需用户确认**。

---

## 4. 功能需求（EARS 格式）

> EARS 关键词说明：`WHEN`（事件驱动）、`WHILE`（状态驱动）、`IF...THEN`（条件触发）、`UNLESS`（例外）、`SHALL`（强制）。所有需求均可测试。

### 4.1 第一部分：数据库持久层（FR-1）

| 编号 | 需求语句（EARS） |
|---|---|
| FR-1.1 | **WHEN** Nitro 服务端进程启动，**THE SYSTEM SHALL** 依据持久化配置初始化数据库访问句柄，并将其封装为服务端可复用的单例（避免每次请求重复建连）。 |
| FR-1.2 | **IF** 服务端启动时不存在有效持久化配置（未安装），**THEN THE SYSTEM SHALL** 不因数据库缺失而崩溃或中断启动，而是保持可服务并进入"未安装状态"，由访问控制将其引导至 `/install`。 |
| FR-1.3 | **WHEN** 系统持久化一个管理员用户，**THE SYSTEM SHALL** 存储账号、密码哈希、昵称、邮箱、角色、状态、创建时间、更新时间；**SHALL NOT** 以任何形式存储明文密码。 |
| FR-1.4 | **WHEN** 校验一组登录凭证，**THE SYSTEM SHALL** 依据账号查询用户记录，并使用与写入时一致的哈希算法比对密码；**UNLESS** 用户不存在、状态为禁用或密码不匹配，**THE SYSTEM SHALL** 返回统一的失败结果（不区分"账号不存在"与"密码错误"，避免账号枚举）。 |
| FR-1.5 | **WHILE** 系统处于已安装状态，**THE SYSTEM SHALL** 保证用户数据与登录态可跨服务重启复用（非进程内内存态）。 |
| FR-1.6 | **WHEN** 登录成功，**THE SYSTEM SHALL** 生成携带签名（或服务端可校验）的会话凭证，并写入 cookie 名为 `fsp_session` 的 httpOnly cookie。 |
| FR-1.7 | **IF** 会话凭证签名校验失败、被篡改或已过期，**THEN THE SYSTEM SHALL** 视为未登录，且**SHALL NOT** 因解析异常而抛出 500。 |
| FR-1.8 | **WHEN** 执行数据库初始化或迁移，**THE SYSTEM SHALL** 幂等创建所需表结构（已存在时不报错、不重复写入）。 |
| FR-1.9 | **WHEN** 系统访问数据库，**THE SYSTEM SHALL** 通过统一的数据访问层（而非在接口内散落 SQL / 直接操作连接），以便集中审计与测试。 |
| FR-1.10 | **WHEN** 数据库操作发生异常（连接失败、约束冲突、超时），**THE SYSTEM SHALL** 转化为可识别的内部错误，且**SHALL NOT** 将数据库原始错误详情或堆栈返回给客户端。 |
| FR-1.11 | **WHILE** 数据模型设计，**THE SYSTEM SHALL** 为用户表预留可用于后续内容业务的扩展字段（如角色、状态、时间戳），**SHALL NOT** 将数据模型与内容业务强耦合。 |
| FR-1.12 | **WHEN** 运行单元测试，**THE SYSTEM SHALL** 允许数据访问层在隔离数据库（临时文件或内存库）上被独立测试，不污染开发/生产数据。 |

### 4.2 第二部分：网络接口封装（FR-2）

| 编号 | 需求语句（EARS） |
|---|---|
| FR-2.1 | **WHEN** 任一业务接口成功处理请求，**THE SYSTEM SHALL** 返回与 `shared/types` 中 `ApiResponse<T>` 一致的统一响应结构 `{ code, message, data }`。 |
| FR-2.2 | **IF** 接口处理过程中发生错误，**THEN THE SYSTEM SHALL** 返回统一错误结构（`code` + 可读 `message`），并映射到恰当的 HTTP 状态码（如参数错误 400、未登录 401、无权限 403、资源不存在 404、冲突 409、服务端错误 500）。 |
| FR-2.3 | **WHEN** 接口接收请求体或查询参数，**THE SYSTEM SHALL** 对参数进行校验（复用/扩展 `shared/utils/validate.ts`）；**IF** 校验失败，**THEN THE SYSTEM SHALL** 返回 400 与明确的字段级错误信息，**SHALL NOT** 继续执行业务逻辑。 |
| FR-2.4 | **WHEN** 客户端请求 `POST /api/auth/login` 且系统已安装，**THE SYSTEM SHALL** 查库校验凭证，成功后设置签名会话 cookie 并返回当前用户信息；**IF** 系统未安装，**THEN THE SYSTEM SHALL** 返回明确的"未初始化"错误而非 500。 |
| FR-2.5 | **WHEN** 客户端请求 `POST /api/auth/logout`，**THE SYSTEM SHALL** 清除会话 cookie；**IF** 采用服务端会话记录方案，**THEN THE SYSTEM SHALL** 同步失效该会话记录。 |
| FR-2.6 | **WHILE** 改造 `login`/`logout`/`me` 三个既有接口，**THE SYSTEM SHALL** 保持其在 §3.2 记录的对外 JSON 契约（`login → { user }`、`me → user`、`logout → { ok: true }`）不变，**UNLESS** 用户确认采用全量 `ApiResponse` 包裹并由本任务同步改造 `app/composables/useAuth.ts`（见第 8 章 DEP-7）。 |
| FR-2.7 | **WHEN** 客户端请求 `GET /api/auth/me`，**THE SYSTEM SHALL** 校验会话有效性（签名校验，若可行则叠加数据库校验）后返回当前用户；**IF** 会话无效，**THEN THE SYSTEM SHALL** 返回 401。 |
| FR-2.8 | **WHEN** 前端需要判断站点安装状态，**THE SYSTEM SHALL** 提供安装状态查询接口（如 `GET /api/install/status`），返回 `{ installed: boolean }`；**SHALL NOT** 在响应中泄露数据库密码、会话密钥等敏感配置。 |
| FR-2.9 | **WHEN** 前端在 `app/` 内调用服务端接口，**THE SYSTEM SHALL** 通过 `$fetch` / `useFetch` 进行同源调用；**WHILE** 在 SSR 环境下需要携带会话 cookie，**THE SYSTEM SHALL** 使用 `useRequestFetch`（或其等价机制）转发原始请求 cookie。 |
| FR-2.10 | **WHEN** 每次服务端请求到达，**THE SYSTEM SHALL** 复用既有 `server/middleware/log.ts` 记录请求方法与路径；**IF** 新增数据库错误日志，**THEN THE SYSTEM SHALL** 不记录 cookie、authorization 头、密码等敏感内容。 |

### 4.3 第三部分：install 初始化向导（FR-3）

| 编号 | 需求语句（EARS） |
|---|---|
| FR-3.1 | **WHILE** 系统处于未安装状态，**WHEN** 用户访问除 `/install`、静态资源、`/api/install/*`、`/api/health` 之外的任意页面，**THE SYSTEM SHALL** 将其重定向至 `/install`，**UNLESS** 该请求为内部资源请求（以 `/api/`、`/_` 开头）。 |
| FR-3.2 | **WHILE** 系统处于已安装状态，**WHEN** 用户访问 `/install`，**THE SYSTEM SHALL** 拒绝访问并重定向（如至首页或登录页），以防止重复初始化。 |
| FR-3.3 | **WHEN** 用户打开 `/install`，**THE SYSTEM SHALL** 提供分步表单，包含：数据库类型、数据库地址（host）、端口、库名、账号、密码。 |
| FR-3.4 | **WHEN** 用户填写管理员信息，**THE SYSTEM SHALL** 收集账号、密码、昵称、邮箱；**IF** 邮箱格式非法或密码强度不足（复用 `isStrongPassword`），**THEN THE SYSTEM SHALL** 阻止提交并提示。 |
| FR-3.5 | **WHEN** 用户填写站点级配置，**THE SYSTEM SHALL** 收集站点名称、会话密钥（session secret）及其他初始化常量；**IF** 用户未提供会话密钥，**THEN THE SYSTEM SHALL** 允许系统自动生成一个高强度随机密钥。 |
| FR-3.6 | **WHEN** 用户触发"测试连接"，**THE SYSTEM SHALL** 使用所填参数建立数据库连接并执行最小探测；**IF** 成功，**THEN THE SYSTEM SHALL** 返回成功提示且**SHALL NOT** 写入任何配置；**IF** 失败，**THEN THE SYSTEM SHALL** 返回可读错误信息且**SHALL NOT** 写入任何配置。 |
| FR-3.7 | **WHEN** 用户提交初始化，**THE SYSTEM SHALL** 按序执行：测试数据库连接 → 建表/迁移 → 写入管理员 → 持久化配置 → 写入"已安装"标记；**SHALL** 在每一步反馈进度或结果。 |
| FR-3.8 | **IF** 初始化过程中任一步骤失败，**THEN THE SYSTEM SHALL** 回滚/补偿已写入的部分（尤其不得留下半初始化状态与可登录的半成品管理员），返回失败原因，并使系统保持"未安装状态"。 |
| FR-3.9 | **WHEN** 创建管理员，**THE SYSTEM SHALL** 使用选定的哈希算法生成密码哈希后写入数据库；**SHALL NOT** 以明文写入数据库、日志或响应体。 |
| FR-3.10 | **WHEN** 初始化成功，**THE SYSTEM SHALL** 将配置持久化到服务器可持久化位置（`.env` 或 `data/config.json` 等，见第 8 章 DEP-5），确保服务重启后配置仍生效。 |
| FR-3.11 | **WHEN** 持久化配置，**THE SYSTEM SHALL** 保证含敏感信息（数据库密码、会话密钥）的配置文件被 `.gitignore` 覆盖，**SHALL NOT** 被提交到 git；**SHALL** 提供不含敏感值的示例文件（如 `.env.example`）。 |
| FR-3.12 | **WHILE** 初始化流程正在执行，**THE SYSTEM SHALL** 防止并发重复初始化（如安装锁 / 幂等写入），避免重复建表或重复创建管理员。 |
| FR-3.13 | **WHEN** 系统已安装后再次提交初始化请求，**THE SYSTEM SHALL** 拒绝该请求并提示"系统已安装"。 |
| FR-3.14 | **WHILE** 系统处于未安装状态，**THE SYSTEM SHALL** 仅开放初始化所必需的安装接口（`/api/install/*`）与健康检查；**WHEN** 系统已安装，**THE SYSTEM SHALL** 拒绝所有安装接口的调用。 |
| FR-3.15 | **WHEN** 初始化成功完成，**THE SYSTEM SHALL** 引导用户至登录页（`/login`）或首页，并保证可用新创建的管理员账号完成登录。 |
| FR-3.16 | **WHEN** 前端在未安装状态下尝试发起需要登录态的请求，**THE SYSTEM SHALL** 优先引导至 `/install` 而非 `/login`。 |

### 4.4 第四部分：零回归与兼容（FR-4）

| 编号 | 需求语句（EARS） |
|---|---|
| FR-4.1 | **WHEN** 本任务完成后执行 `npm run build`，**THE SYSTEM SHALL** 构建成功，退出码为 0。 |
| FR-4.2 | **WHEN** 本任务完成后执行 `npm test`，**THE SYSTEM SHALL** 不引入新的测试失败。 |
| FR-4.3 | **WHEN** 本任务完成后启动应用，**THE SYSTEM SHALL** 现有页面（`/`、`/login`、`/account`、内容路由）在已安装并登录的前提下渲染与改造前一致。 |
| FR-4.4 | **WHILE** 改造会话与鉴权，**THE SYSTEM SHALL** 保持 cookie 名 `fsp_session`、`httpOnly`、`path=/`、`sameSite` 等既有属性约定，**UNLESS** 同步调整 `app/composables/useAuth.ts` 中的 cookie 名探测逻辑。 |
| FR-4.5 | **WHEN** 移除 `login.post.ts` 中"非 dev 抛 501"的占位逻辑，**THE SYSTEM SHALL** 以真实鉴权替代，且**SHALL NOT** 在任何环境下保留"任意非空账号放行"的行为。 |
| FR-4.6 | **WHEN** 应用运行于开发环境且未完成安装，**THE SYSTEM SHALL** 仍可通过 `/install` 完成初始化并正常进入开发调试流程。 |

---

## 5. 非功能需求

### 5.1 安全性（NFR-Sec）

| 编号 | 需求语句（EARS） |
|---|---|
| NFR-Sec.1 | **WHEN** 存储用户凭证，**THE SYSTEM SHALL** 仅存储密码哈希（加盐），**SHALL NOT** 存储或传输明文密码。 |
| NFR-Sec.2 | **WHEN** 设置会话 cookie，**THE SYSTEM SHALL** 使用 `httpOnly`，并遵循既有 `sameSite=lax`、`path=/`、生产环境 `secure` 的约定。 |
| NFR-Sec.3 | **WHEN** 生成会话凭证，**THE SYSTEM SHALL** 使其具备防篡改能力（签名或服务端存储），**SHALL NOT** 使用可被伪造的无签名明文 payload。 |
| NFR-Sec.4 | **WHEN** 返回错误响应，**THE SYSTEM SHALL** 不泄露数据库连接串、堆栈跟踪、内部文件路径等实现细节。 |
| NFR-Sec.5 | **WHEN** 持久化敏感配置（数据库密码、会话密钥），**THE SYSTEM SHALL** 保证其文件被 `.gitignore` 忽略，且**SHALL NOT** 出现在日志与接口响应中。 |
| NFR-Sec.6 | **WHILE** 系统处于已安装状态，**THE SYSTEM SHALL** 拒绝任何重复初始化请求，防止攻击者通过 `/install` 重置管理员或覆盖配置。 |
| NFR-Sec.7 | **WHEN** 用户登录失败，**THE SYSTEM SHALL** 返回不区分账号存在性的统一提示，避免账号枚举。 |

### 5.2 可维护性（NFR-M）

| 编号 | 需求语句（EARS） |
|---|---|
| NFR-M.1 | **WHEN** 新增 `.ts`/`.vue` 文件，**THE SYSTEM SHALL** 包含说明文件用途与用法的 TSDoc/JSDoc 注释。 |
| NFR-M.2 | **WHILE** 编写代码，**THE SYSTEM SHALL** 遵循项目既有代码风格：**Tab 缩进、双引号、无分号**（与 `server/utils/session.ts`、`app/utils/format.ts` 等既有文件一致）。 |
| NFR-M.3 | **WHEN** 组织代码，**THE SYSTEM SHALL** 遵循 Nuxt 4 三层边界：跨端纯逻辑置于 `shared/`，服务端逻辑置于 `server/`，Vue 渲染置于 `app/`。 |
| NFR-M.4 | **WHEN** 新增数据表或接口，**THE SYSTEM SHALL** 保持命名与结构一致，使后续业务可直接参照。 |
| NFR-M.5 | **WHEN** 执行 `npx eslint .`，**THE SYSTEM SHALL** 不产生 error 级别违规。 |

### 5.3 可部署性（NFR-D）

| 编号 | 需求语句（EARS） |
|---|---|
| NFR-D.1 | **WHILE** 采用前后端不分离部署，**THE SYSTEM SHALL** 仅通过 `nuxt build` 产物（Nitro 一体）对外提供服务，**SHALL NOT** 要求额外启动独立后端服务。 |
| NFR-D.2 | **WHEN** 服务在全新环境首次启动且未安装，**THE SYSTEM SHALL** 可正常监听并提供 `/install` 页面，不因缺少数据库而启动失败。 |
| NFR-D.3 | **WHEN** 完成初始化后重启服务，**THE SYSTEM SHALL** 从持久化配置中恢复数据库连接与会话密钥，登录态与数据保持有效。 |
| NFR-D.4 | **WHEN** 部署到自有服务器，**THE SYSTEM SHALL** 所需持久化目录（如 `data/`、`.data/`）可被配置且具备写入权限。 |
| NFR-D.5 | **WHEN** 提供部署交付物，**THE SYSTEM SHALL** 附带不含敏感值的配置示例文件（`.env.example`）与初始化说明。 |

### 5.4 兼容性（NFR-C）

| 编号 | 需求语句（EARS） |
|---|---|
| NFR-C.1 | **WHILE** 修改既有接口，**THE SYSTEM SHALL** 保持 §3.2 记录的主要对外字段兼容，或按第 8 章 DEP-7 的用户决策同步适配调用方。 |
| NFR-C.2 | **WHEN** 本任务完成后，**THE SYSTEM SHALL** 兼容现有 Node.js 运行时（`better-sqlite3 ^12.11.1` 等既有依赖所要求的版本），不降低对现有环境的支持。 |
| NFR-C.3 | **WHEN** 新增共享类型或校验函数，**THE SYSTEM SHALL** 保持与 `shared/utils/validate.ts` 同样的纯逻辑约束（不访问 `window`/`document`/`process`/`fs`）。 |
| NFR-C.4 | **WHILE** 数据模型演进，**THE SYSTEM SHALL** 通过幂等迁移支持平滑升级，**SHALL NOT** 要求手工删库重建。 |

### 5.5 可测试性（NFR-T）

| 编号 | 需求语句（EARS） |
|---|---|
| NFR-T.1 | **WHEN** 为数据访问层编写测试，**THE SYSTEM SHALL** 支持在临时/内存数据库上运行（Vitest `unit` 项目）。 |
| NFR-T.2 | **WHEN** 为接口编写测试，**THE SYSTEM SHALL** 支持通过 `@nuxt/test-utils` 或直接 HTTP 请求验证响应结构与错误码。 |
| NFR-T.3 | **WHEN** 为密码哈希与会话签名编写测试，**THE SYSTEM SHALL** 验证"哈希不可逆比对正确"与"签名被篡改即失效"。 |
| NFR-T.4 | **WHEN** 为 install 向导编写 E2E 测试，**THE SYSTEM SHALL** 可通过 Playwright 覆盖"未安装 → 引导 → 初始化 → 可登录"的主干流程。 |
| NFR-T.5 | **WHEN** 测试未安装/已安装两种状态，**THE SYSTEM SHALL** 允许通过配置或环境变量模拟，无需真实手工改文件。 |

### 5.6 性能与可靠性（NFR-P / NFR-R）

| 编号 | 需求语句（EARS） |
|---|---|
| NFR-P.1 | **WHILE** 系统已安装，**WHEN** 处理登录接口请求（本地/同类自建服务器环境），**THE SYSTEM SHALL** 在合理时间内返回（建议 P95 < 500ms，不含网络抖动）。 |
| NFR-P.2 | **WHILE** 服务端运行，**THE SYSTEM SHALL** 复用数据库连接，**SHALL NOT** 在每个请求内重复建立/销毁连接。 |
| NFR-R.1 | **IF** 数据库连接临时不可用，**THEN THE SYSTEM SHALL** 返回可读错误并保持进程存活，**SHALL NOT** 导致整个服务崩溃。 |
| NFR-R.2 | **WHEN** 初始化流程失败，**THE SYSTEM SHALL** 保证系统仍可通过 `/install` 重试，**SHALL NOT** 留下无法修复的中间状态。 |
| NFR-R.3 | **WHEN** 会话凭证过期，**THE SYSTEM SHALL** 视为未登录并要求重新登录，不影响其他用户会话。 |

---

## 6. 约束

| 编号 | 约束内容 |
|---|---|
| CON-1 | **零回归保护**：禁止修改 `app/app.vue`、`app/error.vue`、`app/layouts/default.vue`、`app/plugins/01.init.ts`、`app/utils/auth.ts`、`server/middleware/log.ts`、`server/api/health.get.ts` 的核心逻辑。`app/composables/useAuth.ts`、`app/middleware/a.CheckUser.global.ts`、`server/api/auth/*`、`server/utils/session.ts` 允许改造，但须保持/兼容既有对外契约（见 FR-2.6、FR-4.4）。 |
| CON-2 | **前后端不分离**：所有能力基于 Nuxt/Nitro 一体部署实现，不引入独立后端服务、不拆分端口/域。 |
| CON-3 | **依赖选型必须询问用户**：本规格**严禁直接确定依赖方案**，所有候选方案列入第 8 章，由用户决策后才可进入设计与实现。 |
| CON-4 | **TypeScript 优先**：所有 `.ts`/`.vue`（`lang="ts"`）提供类型标注，复用 `shared/types` 类型。 |
| CON-5 | **代码风格**：Tab 缩进 + 双引号 + 无分号（项目实测风格，勿套用 2 空格/单引号）。 |
| CON-6 | **接口规范**：统一响应结构（`ApiResponse`）、统一错误码、参数校验（复用/扩展 `shared/utils/validate.ts`）。 |
| CON-7 | **安全底线**：密码不明文存储；会话 cookie httpOnly；install 页防重复初始化；敏感配置不进 git。 |
| CON-8 | **可测试**：数据库层与接口应可被 Vitest 覆盖；install 主流程应可被 Playwright 覆盖。 |
| CON-9 | **不破坏现有依赖**：不得移除或降级 `package.json` 中现有依赖（含已声明未使用的 `better-sqlite3`），新增依赖须先经用户确认。 |
| CON-10 | **配置持久化**：初始化配置须写入服务器可持久化且不被 git 跟踪的位置，重启后生效。 |
| CON-11 | **shared/ 纯逻辑**：`shared/` 下代码不得依赖 Vue 或 Node 特有 API。 |
| CON-12 | **仅本规格不做实现**：本规格只定义"做什么"，不涉及具体代码实现；实现细节归设计/任务阶段。 |

---

## 7. 依赖选型待确认清单（**必须由用户决策**）

> ⚠️ 本章为本任务**阻断项**。以下每一项均**不得**由本规格或后续步骤擅自决定。请用户逐项确认后，再进入设计阶段。

### 7.1 决策项总览

| 编号 | 决策项 | 候选方案 | 是否新增依赖（取决于决策） |
|---|---|---|---|
| DEP-1 | 数据库类型 | SQLite / MySQL / PostgreSQL | SQLite 零新增；MySQL、PG 需新增 |
| DEP-2 | 数据访问方式 | 原生 SQL / Drizzle / Prisma / Kysely | 原生 SQL 零新增；其余需新增 |
| DEP-3 | 密码哈希 | Node `crypto.scrypt` / bcryptjs / bcrypt / argon2 | scrypt 零新增；其余需新增 |
| DEP-4 | 会话签名 | Node `crypto` HMAC / jose / jsonwebtoken | crypto 零新增；其余需新增 |
| DEP-5 | 配置持久化位置/格式 | `.env` / `data/config.json` / 数据库表 | 均零新增（视读取方式） |
| DEP-6 | 迁移方案 | 手写幂等 SQL / 依赖 ORM 迁移工具 | 取决于 DEP-2 |
| DEP-7 | 接口响应结构 | 保持既有契约 / 全量 `ApiResponse` 包裹 | 均零新增（但影响 `useAuth.ts` 改造） |

### 7.2 DEP-1 数据库类型

| 候选方案 | 优点 | 缺点 | 是否新增依赖 | 备注 |
|---|---|---|---|---|
| **SQLite**（`better-sqlite3 ^12.11.1` 已声明） | 零新增依赖；单文件、免运维；适合中小型 CMS 与自有服务器单机部署；同步 API 简单直接；`.data/` 已存在可用作落盘目录 | 高并发写入受限；不支持多实例共享（多副本部署需共享文件系统）；需注意原生模块在目标平台的编译/预编译二进制 | **否** | 项目已声明该依赖但未使用；选用即"激活" |
| **MySQL**（`mysql2` 驱动） | 生产环境常见、生态成熟；支持多实例共享；运维人员熟悉 | 需新增依赖 + 需自备数据库实例；连接池/字符集/时区需额外配置 | **是**（`mysql2`） | install 表单中 host/port/库名/账号/密码更贴合 MySQL |
| **PostgreSQL**（`pg` 驱动） | 功能强大、类型系统严谨；适合复杂查询与未来扩展 | 需新增依赖 + 需自备实例；相对重 | **是**（`pg`） | 同上 |

### 7.3 DEP-2 数据访问方式

| 候选方案 | 优点 | 缺点 | 是否新增依赖 | 备注 |
|---|---|---|---|---|
| **原生 SQL**（基于 DEP-1 的驱动） | 零新增依赖；完全可控、性能透明；表结构少时最简 | 手写 SQL 易出错；无类型推导；迁移需自管 | **否** | 本任务表数量少（用户/会话/可选配置），成本低 |
| **Drizzle ORM** | TypeScript 原生、类型安全、接近 SQL；轻量；可与 better-sqlite3/mysql2/pg 共用 | 需新增依赖；引入 schema 定义范式与学习成本 | **是**（`drizzle-orm`，+ 可选 `drizzle-kit`） | 与"TS 优先"契合度较高 |
| **Prisma** | 工具链完善（schema/migrate/studio）；DX 好 | 需新增依赖 + 客户端生成步骤；构建体积与冷启动开销较大；对 Nitro 打包需注意 `prisma generate` 与二进制产物 | **是**（`prisma`、`@prisma/client`） | 部署产物更复杂，需评估 |
| **Kysely** | 纯 TS 查询构建器、类型安全、无代码生成 | 需新增依赖；需自行维护迁移 | **是**（`kysely`） | 介于原生与 ORM 之间 |

### 7.4 DEP-3 密码哈希

| 候选方案 | 优点 | 缺点 | 是否新增依赖 | 备注 |
|---|---|---|---|---|
| **Node 内置 `crypto.scrypt`** | 零新增依赖；抗 GPU 暴力破解（内存硬）；Node 官方支持 | 需自行实现盐生成、参数编码、比对与升级策略；API 为非 Promise 回调/需自行封装 | **否** | 需要额外小心实现 `timingSafeEqual` 比对 |
| **`bcryptjs`** | 纯 JS、零编译；API 简单；广泛使用 | 需新增依赖；纯 JS 实现较原生慢 | **是**（`bcryptjs`） | 无需原生编译，跨平台友好 |
| **`bcrypt`** | 性能好、生态成熟 | 需新增依赖 + 原生编译（与 better-sqlite3 一样有平台产物问题） | **是**（`bcrypt`） | 需评估目标服务器构建环境 |
| **`argon2`** | 现代推荐算法、抗暴力最强 | 需新增依赖 + 原生编译 | **是**（`argon2`） | 同上 |

### 7.5 DEP-4 会话签名

| 候选方案 | 优点 | 缺点 | 是否新增依赖 | 备注 |
|---|---|---|---|---|
| **Node 内置 `crypto` HMAC** | 零新增依赖；完全可控；可直接实现"签名 + 过期时间"的自包含 token | 需自行实现编码、签名、校验、防时序攻击比对与过期处理 | **否** | 与现有 `session.ts` 结构最接近，改造成本可控 |
| **`jose`** | 现代 JWT 库、符合标准、TS 友好、支持多算法与密钥管理 | 需新增依赖；引入 JWT 规范心智 | **是**（`jose`） | Nuxt 生态常见 |
| **`jsonwebtoken`** | 使用广泛、API 熟 | 需新增依赖；回调式 API、类型支持较弱 | **是**（`jsonwebtoken`） | — |

### 7.6 DEP-5 配置持久化位置 / 格式

| 候选方案 | 优点 | 缺点 | 是否新增依赖 | 备注 |
|---|---|---|---|---|
| **`.env` 文件** | Node/Nuxt 天然支持；运维熟悉；`.gitignore` 已忽略 `.env` | 运行时写入 `.env` 后需重新读取才生效；多行/特殊字符需转义 | **否** | 需注意"写入后如何让当前进程立即生效" |
| **`data/config.json`** | 结构化、易读写；可承载非敏感站点常量；与数据库配置分离更清晰 | 需自建读取/写入与权限控制；需确保目录被 git 忽略 | **否** | 需在 `.gitignore` 增加 `data/`（或复用 `.data/`） |
| **写入数据库表** | 配置集中、随库迁移 | 鸡生蛋问题：数据库连接本身需要配置；至少会话密钥需另存 | **否** | 通常仅用于存放非连接类配置 |

### 7.7 DEP-6 迁移方案

| 候选方案 | 优点 | 缺点 | 是否新增依赖 | 备注 |
|---|---|---|---|---|
| **手写幂等 SQL（`CREATE TABLE IF NOT EXISTS` + 版本表）** | 零新增依赖、透明可控；表少时成本低 | 复杂演进时需自管版本与回滚 | **否** | 与 DEP-2"原生 SQL"配套 |
| **依赖 ORM 迁移工具**（Drizzle Kit / Prisma Migrate / Kysely Migrator） | 迁移可版本化、可回滚、DX 好 | 需新增工具依赖与构建流程 | **是**（随 DEP-2 而定） | 与 DEP-2 选择强相关 |

### 7.8 DEP-7 接口响应结构（影响既有契约）

| 候选方案 | 优点 | 缺点 | 是否新增依赖 | 备注 |
|---|---|---|---|---|
| **保持既有契约**（`login → { user }`、`me → user`、`logout → { ok }`），新接口采用 `ApiResponse` | 零回归、无需改 `useAuth.ts`；改动面最小 | 接口风格不统一（新旧并存） | **否** | 推荐用于降低回归风险 |
| **全量 `ApiResponse` 包裹**（含 auth 三接口） | 全站接口风格统一 | 需同步改造 `app/composables/useAuth.ts` 与调用方；存在回归风险 | **否** | 需用户确认接受 `useAuth.ts` 改动 |

### 7.9 建议（仅供参考，最终由用户决策）

- 若追求"最小改动 + 零新增依赖"：**SQLite + 原生 SQL + crypto.scrypt + crypto HMAC + `.env`/`data/config.json` + 手写幂等迁移 + 保持既有契约**（DEP-7 选"保持既有契约"）。
- 若追求"类型安全 + 长期可维护"：**Drizzle ORM + `jose`/`scrypt` 混搭**，并引入 Drizzle Kit 迁移。
- 无论何种选择，均须满足 CON-3：**未经用户确认不得擅自新增依赖**。

---

## 8. 验收标准

### 8.1 数据库持久层验收

| 编号 | 验收条件 |
|---|---|
| AC-1 | 全新环境（无配置、无库）启动服务成功，进程不崩溃 |
| AC-2 | 初始化后数据库中存在用户表，且管理员记录已写入 |
| AC-3 | 查询数据库可确认管理员密码字段为哈希值（非明文、非空） |
| AC-4 | 使用正确密码校验通过、错误密码校验失败 |
| AC-5 | 服务重启后，已写入的用户数据与配置仍然存在、连接可恢复 |
| AC-6 | 迁移脚本幂等：重复执行不报错、不重复建表 |
| AC-7 | 数据库访问层可在临时/内存库上被 Vitest 独立测试通过 |

### 8.2 网络接口验收

| 编号 | 验收条件 |
|---|---|
| AC-8 | 新接口响应符合 `ApiResponse<T>`（`{ code, message, data }`）结构 |
| AC-9 | 参数非法时返回 400 且 message 可读，业务逻辑不继续执行 |
| AC-10 | `POST /api/auth/login`（已安装）用正确凭证返回成功并设置 `fsp_session` cookie（httpOnly） |
| AC-11 | `POST /api/auth/login` 用错误凭证返回统一失败提示（不泄露账号是否存在） |
| AC-12 | `GET /api/auth/me` 在无/伪造/过期会话时返回 401；有效会话时返回当前用户 |
| AC-13 | `POST /api/auth/logout` 清除会话，随后 `me` 返回 401 |
| AC-14 | 篡改 cookie 内容后 `me` 返回 401（签名校验生效） |
| AC-15 | `GET /api/install/status` 返回 `{ installed: boolean }` 且不含敏感字段 |
| AC-16 | 既有 auth 三接口对外 JSON 契约与 §3.2 一致（若 DEP-7 选择"保持既有契约"） |

### 8.3 install 向导验收

| 编号 | 验收条件 |
|---|---|
| AC-17 | 未安装状态下访问 `/`、`/login`、`/account` 均被重定向至 `/install` |
| AC-18 | `/install` 页面可填写数据库类型、host、port、库名、账号、密码 |
| AC-19 | 点击"测试连接"：成功/失败均有明确反馈，且不写入任何配置 |
| AC-20 | 提交初始化后按序完成：测连接 → 建表 → 写管理员 → 持久化配置 → 标记已安装 |
| AC-21 | 初始化过程中某步失败时，无残留半成品管理员，系统仍为"未安装"可重试 |
| AC-22 | 初始化成功后，配置文件已在服务器持久化位置生成且重启后生效 |
| AC-23 | 敏感配置文件未被 git 跟踪（`git status` 不出现该文件），且存在不含敏感值的示例文件 |
| AC-24 | 已安装状态下访问 `/install` 被拒绝/重定向 |
| AC-25 | 已安装状态下调用 `/api/install/*` 被拒绝 |
| AC-26 | 并发提交初始化不会产生重复管理员或重复建表 |
| AC-27 | 初始化成功后可用新管理员在 `/login` 完成登录并进入受保护页面 |
| AC-28 | 管理员密码强度不足时（如 <8 位或无字母数字组合）被拒绝 |
| AC-29 | 未提供会话密钥时系统自动生成高强度随机密钥并持久化 |

### 8.4 零回归与质量验收

| 编号 | 验收条件 |
|---|---|
| AC-30 | `npm run build` 成功，退出码 0 |
| AC-31 | `npm test` 无新增失败 |
| AC-32 | `npx eslint .` 无 error 级别违规 |
| AC-33 | 已安装并登录后，`/`、`/login`、`/account`、内容路由渲染与改造前一致 |
| AC-34 | 非 dev 环境不再存在"任意非空账号密码放行"逻辑 |
| AC-35 | 新增文件均含 TSDoc/JSDoc 注释 |
| AC-36 | 代码风格符合 Tab 缩进 + 双引号 + 无分号 |
| AC-37 | Playwright 可覆盖"未安装引导 → 初始化 → 登录"主干流程 |

---

## 9. 附录 A：数据库表结构草案（**建议，供设计阶段参考**）

> 说明：以下为逻辑草案，**非最终物理设计**。字段类型、索引、外键、长度等以设计阶段与 DEP-1/DEP-2 决策为准。表名/字段名为建议。

### A.1 `users`（管理员/用户）

| 字段 | 说明 | 约束建议 |
|---|---|---|
| `id` | 主键 | 自增或 UUID，唯一 |
| `account` | 登录账号 | 必填、唯一、去空白后非空 |
| `password_hash` | 密码哈希（含盐/参数编码） | 必填、非明文 |
| `name` | 昵称/显示名 | 可选，缺省回退为 `account` |
| `email` | 邮箱 | 可选、格式合法、建议唯一 |
| `role` | 角色（如 `admin`） | 必填、默认 `admin`，为后续 RBAC 预留 |
| `status` | 状态（`active`/`disabled`） | 必填、默认 `active` |
| `created_at` | 创建时间 | 必填 |
| `updated_at` | 更新时间 | 必填 |
| `last_login_at` | 最近登录时间 | 可选 |

### A.2 `sessions`（可选，仅当 DEP-4 选择"服务端会话存储"时）

| 字段 | 说明 | 约束建议 |
|---|---|---|
| `id` | 会话主键/令牌标识 | 唯一 |
| `token_hash` | 令牌哈希（不存明文令牌） | 唯一、非空 |
| `user_id` | 关联用户 | 非空（外键语义） |
| `expires_at` | 过期时间 | 非空 |
| `created_at` | 创建时间 | 非空 |
| `user_agent` | 客户端 UA（可选，用于审计） | 可选 |
| `ip` | 客户端 IP（可选） | 可选 |

### A.3 `settings`（可选，站点级非敏感配置 KV）

| 字段 | 说明 | 约束建议 |
|---|---|---|
| `key` | 配置键（如 `site_name`） | 主键/唯一、非空 |
| `value` | 配置值 | 可选 |
| `updated_at` | 更新时间 | 非空 |

### A.4 `schema_migrations`（可选，迁移版本记录）

| 字段 | 说明 | 约束建议 |
|---|---|---|
| `version` | 迁移版本号 | 主键/唯一 |
| `applied_at` | 应用时间 | 非空 |

### A.5 安装标记

安装标记建议存于**持久化配置文件**（`.env` 或 `data/config.json`），字段形如 `installed: true` / `FSP_INSTALLED=true`，而非仅存于数据库——以保证"库未就绪/连接失败"时也能判定状态、避免误判。

---

## 10. 附录 B：建议文件清单（**待创建/修改**）

### B.1 需新建文件

| 序号 | 文件路径 | 说明 |
|---|---|---|
| 1 | `server/utils/db.ts` | 数据库连接初始化与单例获取（按 DEP-1 选型实现） |
| 2 | `server/utils/schema.ts` | 幂等建表/迁移逻辑（按 DEP-6 选型实现） |
| 3 | `server/repositories/user.repository.ts` | 用户数据访问层（查询/创建/按账号查找/更新登录时间） |
| 4 | `server/repositories/session.repository.ts` | 会话记录访问层（仅当 DEP-4 选服务端会话存储时） |
| 5 | `server/utils/password.ts` | 密码哈希与比对封装（按 DEP-3 选型实现） |
| 6 | `server/utils/crypto.ts` | 会话签名/校验工具（按 DEP-4 选型实现） |
| 7 | `server/utils/installer.ts` | 安装编排：测连接 → 建表 → 写管理员 → 持久化配置 → 打标记（含回滚/幂等/锁） |
| 8 | `server/utils/config.ts` | 配置读写：加载/持久化 `.env` 或 `data/config.json`（按 DEP-5 选型实现） |
| 9 | `server/utils/api-response.ts` | 统一响应与错误码封装（`ok()` / `fail()` / 错误码常量） |
| 10 | `server/middleware/install-guard.ts` | 服务端未安装/已安装守卫（拦截 `/api/install/*` 与业务接口） |
| 11 | `server/api/install/status.get.ts` | 安装状态查询接口 `{ installed: boolean }` |
| 12 | `server/api/install/test-connection.post.ts` | 数据库连通性测试接口 |
| 13 | `server/api/install/setup.post.ts` | 初始化提交接口（编排执行 installer） |
| 14 | `app/pages/install.vue` | 首次部署 install 向导页（分步表单 + 进度反馈） |
| 15 | `app/middleware/b.Install.global.ts` | 前端全局安装守卫（未安装 → `/install`；已安装访问 `/install` → 拒绝） |
| 16 | `app/composables/useInstall.ts` | 安装向导前端状态与接口调用封装 |
| 17 | `shared/types/install.ts` | 安装相关共享类型（数据库配置、管理员、站点配置、接口出入参） |
| 18 | `shared/types/user.ts` | 用户相关共享类型（或扩展 `shared/types/index.ts`） |
| 19 | `shared/utils/validate-install.ts` | 安装表单校验（端口范围、host、账号、库名等；纯逻辑） |
| 20 | `.env.example` | 不含敏感值的配置示例文件 |
| 21 | `test/unit/db.test.ts` | 数据访问层单元测试（临时/内存库） |
| 22 | `test/unit/password.test.ts` | 密码哈希与比对测试 |
| 23 | `test/unit/session-sign.test.ts` | 会话签名与篡改失效测试 |
| 24 | `test/nuxt/install-api.test.ts` | 安装接口与状态接口测试 |
| 25 | `tests/install.spec.ts` | install 向导 E2E（Playwright） |
| 26 | `data/.gitkeep`（或 `.data/` 复用） | 持久化目录占位（若 DEP-5 选 `data/config.json`） |

### B.2 需修改文件

| 序号 | 文件路径 | 修改说明 | 回归风险 |
|---|---|---|---|
| 1 | `server/utils/session.ts` | 重写为签名会话 + 可选服务端校验，保留 cookie 名 `fsp_session` 与属性约定 | 中（FR-4.4 要求兼容） |
| 2 | `server/api/auth/login.post.ts` | 移除占位放行，改为查库校验 + 哈希比对 + 未安装判定 | 中（FR-2.4/FR-2.6） |
| 3 | `server/api/auth/me.get.ts` | 改为签名校验（+ 可选查库）后返回用户 | 中 |
| 4 | `server/api/auth/logout.post.ts` | 清除 cookie + 可选失效服务端会话 | 低 |
| 5 | `server/api/health.get.ts` | **可选**附加数据库连通状态；契约保持 | 低（保持 `status/timestamp`） |
| 6 | `app/middleware/a.CheckUser.global.ts` | 叠加"未安装 → `/install`"引导；已安装逻辑保持 | 中（注意避免重定向死循环） |
| 7 | `app/composables/useAuth.ts` | **仅当 DEP-7 选"全量 ApiResponse"时**同步适配响应结构 | 高（否则不改） |
| 8 | `shared/types/index.ts` | 扩展用户/安装相关类型（或新增独立文件） | 低 |
| 9 | `shared/utils/validate.ts` | 扩展端口、host、库名等校验（保持纯逻辑） | 低 |
| 10 | `nuxt.config.ts` | **仅追加**：`runtimeConfig`（暴露站点配置/安装状态）等；不删改现有项 | 低 |
| 11 | `.gitignore` | 若新增持久化文件/目录（如 `data/`），追加忽略；确保 `.env` 已忽略 | 低 |
| 12 | `README.md` | 补充"首次部署初始化"使用说明 | 低 |

### B.3 保持不变（零回归保护对象）

- `app/app.vue`、`app/app.config.ts`、`app/error.vue`、`app/layouts/default.vue`
- `app/plugins/01.init.ts`、`app/utils/auth.ts`、`app/utils/format.ts`、`app/types/page-meta.d.ts`
- `app/pages/index.vue`、`app/pages/account.vue`、`app/pages/login.vue`、`app/pages/test.vue`、`app/pages/[...slug].vue`
- `server/middleware/log.ts`
- `content.config.ts`、`vitest.config.ts`、`playwright.config.ts`、`tsconfig.json`

---

## 11. 变更记录

| 版本 | 日期 | 变更说明 | 作者 |
|---|---|---|---|
| 1.0 | 2026-10-18 | 初始版本：定义数据库持久层、网络接口封装、首次部署 install 向导三部分需求；输出 EARS 功能/非功能需求、约束、依赖选型待确认清单、验收标准，并附数据库表结构草案与建议文件清单 | spec-requirement-agent |
| 1.1 | 2026-10-18 | 依赖选型经用户确认，采用**零新增依赖**路线：DEP-1 SQLite（better-sqlite3，既有）/ DEP-2 原生 SQL / DEP-3 crypto.scrypt / DEP-4 crypto HMAC / DEP-5 data/config.json / DEP-6 手写幂等迁移 / DEP-7 保持既有契约。已按此实现：数据库层（app-config/db/schema/password/crypto/session/installer/api-response + user.repository）、接口层（install/status·test-connection·setup + auth/login 对接数据库）、install 向导页与前后端安装守卫、.env.example 与 data/ 忽略规则。验证：build ✅、20 项单测 ✅、ESLint ✅、12 项运行时冒烟 ✅（含伪造 cookie 401、重复安装 409）。 | CodeArts |

---

**文档结束**
