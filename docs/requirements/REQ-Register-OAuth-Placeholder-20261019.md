# 需求规格说明书：邮箱+账号注册 与 第三方登录占位

| 字段 | 值 |
| --- | --- |
| 文档编号 | REQ-Register-OAuth-Placeholder-20261019 |
| 版本 | v1.0 |
| 创建日期 | 2026-10-19 |
| 状态 | 待评审（Pending Review） |
| 所属项目 | FSP（基于 Nuxt 4.6.1 的内容管理系统） |
| 关联模块 | 认证体系（`server/api/auth/*`、`app/pages/login.vue`、`app/composables/useAuth.ts`） |
| 关联迁移 | 数据库 schema v2（`server/utils/schema.ts`） |

> 本文档采用 **EARS（Easy Approach to Requirements Syntax）** 格式表述需求，使用以下关键字：
> - **WHEN** *触发事件* **THE** *系统* **SHALL** *响应*（事件驱动）
> - **WHILE** *状态* **THE** *系统* **SHALL** *响应*（状态驱动）
> - **IF** *前置条件* **THEN THE** *系统* **SHALL** *响应*（条件分支）
> - **UNLESS** *例外条件* **THE** *系统* **SHALL** *响应*（例外）
> - **WHERE** *特性被纳入* **THE** *系统* **SHALL** *响应*（可选特性）
> - 复合形式：**WHEN** *触发* **IF** *条件* **THEN THE** *系统* **SHALL** *响应*

---

## 1. 任务描述与范围

### 1.1 背景

FSP 是一个基于 Nuxt 4.6.1 的前后端不分离内容管理系统（CMS），采用 Nuxt/Nitro 一体部署。当前认证体系已实现「安装向导 → 管理员账号 → 账号密码登录 → 签名会话 cookie」的完整闭环，但尚无用户自助注册入口，且登录页的第三方登录按钮仅为前端文案占位（无对应接口）。

本需求在**零回归、零新增依赖**的前提下，补齐两块能力：

1. **邮箱 + 账号注册**：访客可通过账号、邮箱、密码自助注册成为系统用户，注册成功后可立即登录。
2. **GitHub / QQ / 微信 注册与登录占位**：在登录页与注册页呈现三个第三方入口，并提供返回 501 的占位接口，为后续真实接入 OAuth 预留契约与 UI 位置。

### 1.2 范围内（In Scope）

- 注册页面 `app/pages/register.vue`（与 `login.vue` 视觉与交互风格一致）。
- 注册接口 `POST /api/auth/register`（账号 + 邮箱 + 密码，含校验、防枚举、防刷记录）。
- 数据库 schema v2 幂等迁移：`users.email` 由可空改为 `NOT NULL + UNIQUE`，并妥善处理存量数据。
- 用户仓库扩展：新增按邮箱查询能力（`findUserByEmail`）。
- 登录页与注册页的三个第三方入口（GitHub / QQ / 微信）按钮 UI。
- 三个占位接口：`GET /api/auth/github`、`GET /api/auth/qq`、`GET /api/auth/wechat`，统一返回 501 Not Implemented。
- 注册页的游客守卫复用（已登录用户访问 `/register` 重定向回站内）。
- 注册成功后建立会话的策略确认（自动登录 vs. 跳登录页）。

### 1.3 范围外（Out of Scope）

- **不**实现真实 OAuth 授权流程（不引入任何 OAuth SDK、不调用第三方 `/authorize`、不交换 token、不拉取用户资料）。
- **不**实现邮件发送与邮箱验证流程（不引入 nodemailer 等邮件依赖；是否需要邮件验证列入「依赖选型待确认清单」）。
- **不**实现找回密码、修改密码、邮箱变更、账号停用/启用等用户管理功能。
- **不**改动现有登录接口 `POST /api/auth/login` 的请求/响应契约（仅可能在登录页新增「去注册」链接与第三方按钮）。
- **不**改动安装向导逻辑与安装接口契约。
- **不**引入新的第三方依赖（ORM、校验库、限流库、OAuth 库、邮件库等均不引入）。
- **不**实现注册接口的分布式限流或验证码（仅做进程内简单防刷记录，复杂限流列入待确认）。

---

## 2. 利益相关者与目标

### 2.1 利益相关者

| 角色 | 关注点 |
| --- | --- |
| **访客（未登录用户）** | 能自助注册账号；注册流程简单、有清晰错误提示；注册后能立即使用系统。 |
| **已登录用户** | 访问注册页时被引导回站内，不出现「已登录还能注册」的矛盾态。 |
| **管理员（安装时创建）** | 注册功能不破坏其现有账号与登录能力；存量数据迁移不丢失其信息。 |
| **后端开发者** | 注册接口与现有登录接口风格一致；迁移幂等可重复执行；不引入新依赖。 |
| **前端开发者** | 注册页与登录页组件复用、风格统一；第三方按钮有稳定占位契约。 |
| **安全评审方** | 密码强哈希存储；注册接口防账号枚举；有基础防刷；无开放重定向。 |
| **产品负责人** | 第三方登录的 UI 与接口占位为未来真实接入预留低成本扩展点。 |

### 2.2 目标

1. **G1 — 注册闭环可用**：访客可在 `/register` 提交账号+邮箱+密码完成注册，注册成功后可凭同一账号密码通过 `/api/auth/login` 登录成功。
2. **G2 — 唯一性约束落地**：账号全局唯一、邮箱全局唯一且非空，由数据库约束与接口校验双重保证。
3. **G3 — 零回归**：现有安装、登录、登出、会话、守卫、内容浏览等功能行为不变。
4. **G4 — 占位契约稳定**：三个第三方入口在 UI 与接口层面有明确、统一的占位行为（501），后续真实接入时只需替换实现，无需改契约。
5. **G5 — 迁移安全**：v2 迁移幂等，对存量数据库（含 email 为 NULL 的管理员）安全可执行。
6. **G6 — 零新增依赖**：全部能力基于现有依赖（better-sqlite3、Node 内置 crypto、Nuxt/Nitro、@nuxt/ui）实现。

---

## 3. 功能需求

### 3.1 邮箱 + 账号注册

#### FR-REG-01 注册页面呈现

**WHEN** 访客在浏览器地址栏输入 `/register` 或点击登录页「注册」链接 **THE** 系统 **SHALL** 渲染注册页面 `register.vue`，页面包含账号、邮箱、密码、确认密码四个输入项，以及可选的昵称输入项与「注册」提交按钮。

**WHILE** 系统已安装且当前用户未登录 **THE** 系统 **SHALL** 允许访问 `/register` 且不触发登录重定向。

**WHEN** 已登录用户访问 `/register` **THE** 系统 **SHALL** 重定向至来源页或首页（复用 `guestOnly` 机制与 `safeRedirect`），且不写入浏览器历史栈（`replace: true`）。

**WHERE** 注册页被纳入 **THE** 系统 **SHALL** 在页面底部提供返回登录页的链接，并在「或」分隔线下方展示三个第三方注册入口按钮（GitHub / QQ / 微信）。

#### FR-REG-02 注册接口契约

**WHEN** 客户端向 `POST /api/auth/register` 提交 JSON 体 `{ account, email, password, name? }` **THE** 系统 **SHALL** 校验全部字段并在校验通过后创建用户，返回 HTTP 200 与响应体 `{ user: { account, name } }`。

**IF** 请求体缺失 `account`、`email` 或 `password` 任一字段 **THEN THE** 系统 **SHALL** 返回 HTTP 400 与错误提示「账号、邮箱和密码不能为空」。

**IF** `email` 不满足邮箱格式（复用 `isValidEmail`） **THEN THE** 系统 **SHALL** 返回 HTTP 400 与错误提示「邮箱格式不正确」。

**IF** `password` 不满足强度规则（复用 `isStrongPassword`：至少 8 位且同时含字母与数字） **THEN THE** 系统 **SHALL** 返回 HTTP 400 与错误提示「密码至少 8 位，需同时包含字母和数字」。

**IF** 客户端提交的 `password` 与 `confirmPassword` 不一致 **THEN THE** 系统 **SHALL** 在前端拦截并提示「两次输入的密码不一致」，不发起请求。

**WHERE** `name`（昵称）字段被提供且非空 **THE** 系统 **SHALL** 以提供的昵称创建用户；**UNLESS** `name` 为空或未提供 **THE** 系统 **SHALL** 以 `account` 作为用户 `name` 的默认值。

#### FR-REG-03 唯一性与防账号枚举

**IF** 提交的 `account` 已存在于 users 表 **THEN THE** 系统 **SHALL** 返回 HTTP 409 与统一提示「注册失败，请检查输入或更换账号/邮箱后重试」。

**IF** 提交的 `email` 已存在于 users 表 **THEN THE** 系统 **SHALL** 返回 HTTP 409 与同一统一提示「注册失败，请检查输入或更换账号/邮箱后重试」。

> **防枚举说明**：账号已存在与邮箱已存在返回**完全相同**的错误码与文案，且响应耗时无明显差异，避免攻击者通过差异化响应枚举已注册账号或邮箱。

**UNLESS** `account` 与 `email` 均不存在于 users 表 **THE** 系统 **SHALL** 创建新用户，其 `account`、`email` 唯一，`password_hash` 由 `hashPassword`（scrypt）生成，`role` 默认为 `admin`，`status` 默认为 `active`。

#### FR-REG-04 注册成功后会话策略

**WHEN** 注册接口成功创建用户 **THE** 系统 **SHALL** 在响应中返回 `{ user: { account, name } }`。

> **待确认项 [CONFIRM-01]**：注册成功后是否**自动建立会话**（服务端调 `setSession` 写入签名 cookie，用户无需再登录）？还是仅创建账号、引导用户跳转登录页自行登录？
> - 方案 A（自动登录）：体验更顺滑，注册即登录，复用 `setSession`。
> - 方案 B（跳登录页）：流程更保守，与「注册后可登录」语义一致，复用现有 `login` 接口。
> - 本文档默认采用**方案 A**，待用户确认后定稿。

**WHERE** 方案 A 被采纳 **THE** 系统 **SHALL** 在注册成功后调用 `setSession(event, { account, name })` 写入会话 cookie（会话级，不勾选记住我），前端随后跳转至来源页或首页。

#### FR-REG-05 注册接口防刷

**WHEN** 同一来源（按客户端 IP 标识）在短时间窗口内多次调用 `POST /api/auth/register` **THE** 系统 **SHALL** 记录注册请求日志（含时间、IP、目标账号/邮箱脱敏），并在超过阈值时返回 HTTP 429 与提示「注册请求过于频繁，请稍后再试」。

> **实现约束**：防刷采用进程内简单计数（不引入 Redis 等外部依赖），单实例生效；具体阈值与窗口大小列入「依赖选型待确认清单」由用户确认。**UNLESS** 用户确认需要分布式限流 **THE** 系统 **SHALL** 仅做进程内限流与日志记录。

#### FR-REG-06 注册页与登录页的互通

**WHEN** 注册页渲染 **THE** 系统 **SHALL** 提供「已有账号？登录」链接，指向 `/login`。

**WHEN** 登录页渲染 **THE** 系统 **SHALL** 将现有「注册」占位链接（当前为 `placeholder('注册')`）替换为真实跳转至 `/register` 的导航。

---

### 3.2 GitHub / QQ / 微信 注册与登录占位

#### FR-OAUTH-01 第三方入口 UI 呈现

**WHEN** 登录页或注册页渲染 **THE** 系统 **SHALL** 在「或」分隔线下方展示三个第三方按钮：GitHub、QQ、微信，按钮使用 `@nuxt/ui` 的 `UButton` 组件，`color="neutral"`、`variant="outline"`，风格与现有登录页按钮一致。

**WHEN** 用户点击任一第三方按钮 **THE** 系统 **SHALL** 调用对应占位接口（`GET /api/auth/github` / `GET /api/auth/qq` / `GET /api/auth/wechat`），并在接口返回 501 后向用户展示提示「{平台} 登录尚未接入，敬请期待」。

> **UI 行为待确认项 [CONFIRM-02]**：点击第三方按钮是直接发请求到占位接口，还是仅在前端弹出提示（与现有 `placeholder()` 函数行为一致）？
> - 现有 `login.vue` 的微信/GitHub 按钮仅前端 `placeholder()` 提示，不发请求。
> - 需求要求「占位接口」存在，意味着至少有一次接口调用以验证契约。
> - 建议方案：点击按钮 → 调占位接口 → 捕获 501 → 展示提示。这样既验证了接口存在性，又给用户清晰反馈。待用户确认。

#### FR-OAUTH-02 占位接口契约

**WHEN** 客户端请求 `GET /api/auth/github` **THE** 系统 **SHALL** 返回 HTTP 501 与 JSON 体 `{ code: 501, message: "GitHub 登录尚未接入", data: null }`。

**WHEN** 客户端请求 `GET /api/auth/qq` **THE** 系统 **SHALL** 返回 HTTP 501 与 JSON 体 `{ code: 501, message: "QQ 登录尚未接入", data: null }`。

**WHEN** 客户端请求 `GET /api/auth/wechat` **THE** 系统 **SHALL** 返回 HTTP 501 与 JSON 体 `{ code: 501, message: "微信登录尚未接入", data: null }`。

**WHILE** 第三方登录尚未真实接入 **THE** 系统 **SHALL** 保证三个占位接口不创建任何用户、不写入任何会话、不调用任何外部服务。

#### FR-OAUTH-03 占位接口与安装守卫

**IF** 系统尚未安装 **THEN THE** 系统 **SHALL** 对三个占位接口返回 HTTP 503 与提示「系统尚未安装，请先访问 /install 完成初始化」。

> **守卫策略说明**：当前 `server/middleware/install-guard.ts` 拦截所有 `/api/`（放行 `/api/install/`、`/api/health`、`/_`、`/__`）。占位接口 `/api/auth/{github,qq,wechat}` 不在放行列表，未安装时会被拦截返回 503。
>
> **待确认项 [CONFIRM-03]**：占位接口在未安装时是否需要**放行**（返回 501 而非 503）？
> - 倾向方案：**不放行**，保持 503。理由：系统未安装时，任何业务接口（含占位）都应引导用户先完成安装；占位接口本身不提供任何可用功能，放行无实际收益，反而模糊了「未安装」这一前置状态的语义。
> - 若用户坚持放行，则需在 `install-guard.ts` 的放行规则中追加 `/api/auth/github`、`/api/auth/qq`、`/api/auth/wechat`。
> - 本文档默认采用**不放行（返回 503）**，待用户确认。

#### FR-OAUTH-04 占位接口的统一性

**WHERE** 未来真实接入任一第三方 OAuth **THE** 系统 **SHALL** 能够在不动占位接口路径与响应契约的前提下，替换其内部实现为真实授权流程，且前端按钮调用方式不变。

---

## 4. 非功能需求

### 4.1 安全性

**NFR-SEC-01** **WHEN** 用户提交密码 **THE** 系统 **SHALL** 使用 `hashPassword`（scrypt，内存硬算法）对密码进行哈希后存储，**禁止**以明文或可逆形式存储密码。

**NFR-SEC-02** **WHEN** 注册因账号或邮箱已存在而失败 **THE** 系统 **SHALL** 返回与「校验通过但冲突」语义一致的统一错误码（409）与统一文案，**禁止**在响应中区分「账号已存在」与「邮箱已存在」，以防账号枚举。

**NFR-SEC-03** **WHEN** 注册接口被调用 **THE** 系统 **SHALL** 对回跳地址（若有）使用 `safeRedirect` 校验，**禁止**接受站外地址，防止开放重定向。

**NFR-SEC-04** **WHILE** 第三方登录处于占位状态 **THE** 系统 **SHALL** 不在响应中泄露任何内部路径、堆栈或未接入原因的技术细节，仅返回面向用户的固定文案。

**NFR-SEC-05** **WHEN** 注册接口记录防刷日志 **THE** 系统 **SHALL** 对账号与邮箱做脱敏处理（如仅保留首末字符与域名），**禁止**在日志中完整记录用户凭据。

### 4.2 可维护性

**NFR-MAINT-01** **WHEN** 数据库启动并执行 `migrate()` **THE** 系统 **SHALL** 幂等地将 schema 升级至 v2，重复执行不报错、不重复写入 `schema_migrations`。

**NFR-MAINT-02** **WHEN** 需要扩展用户仓库查询能力 **THE** 系统 **SHALL** 在 `server/repositories/user.repository.ts` 内集中新增 SQL（如 `findUserByEmail`），**禁止**在接口处理函数内直接写 SQL。

**NFR-MAINT-03** **THE** 系统 **SHALL** 复用 `shared/utils/validate.ts` 中的 `isValidEmail`、`isBlank`、`isStrongPassword` 进行前后端一致的校验，**禁止**在注册接口与注册页各自重复实现校验正则。

**NFR-MAINT-04** **THE** 系统 **SHALL** 保持注册接口与登录接口的错误处理风格一致（使用 `createError({ statusCode, message })` 抛错），**禁止**混用 `statusMessage` 与 `message`。

### 4.3 兼容性

**NFR-COMPAT-01** **WHEN** v2 迁移在已存在 v1 数据库上执行 **THE** 系统 **SHALL** 保留全部存量用户记录的 `id`、`account`、`password_hash`、`name`、`role`、`status`、`created_at`、`updated_at`、`last_login_at` 不变。

**NFR-COMPAT-02** **IF** 存量用户记录的 `email` 为 NULL **THEN THE** 系统 **SHALL** 在 v2 迁移中为其填充一个合法且唯一的占位邮箱（形如 `account__legacy@local.invalid`），使其满足 `NOT NULL + UNIQUE` 约束，且不与任何真实邮箱冲突。

> **存量数据处理说明**：安装向导中管理员 email 为可选字段（`form.admin.email || undefined`），存量数据库可能存在 `email IS NULL` 的行。SQLite 不支持 `ALTER TABLE ... ALTER COLUMN` 直接改 NOT NULL，需通过「重建表」或「先填充再重建」完成。具体 SQL 见本文档第 7 节「建议的数据库迁移方案」。

**NFR-COMPAT-03** **WHEN** 现有登录接口 `POST /api/auth/login` 被调用 **THE** 系统 **SHALL** 保持其原有请求体与响应体契约不变，v2 迁移与注册功能不改变其行为。

**NFR-COMPAT-04** **THE** 系统 **SHALL** 保持代码风格与现有代码库一致：服务端 TypeScript 文件使用 Tab 缩进 + 双引号 + 无分号；Vue 单文件组件沿用现有 `login.vue` 的缩进风格。

### 4.4 可测试性

**NFR-TEST-01** **THE** 系统 **SHALL** 为注册接口提供可独立测试的纯函数校验入口（复用 `shared/utils/validate.ts`），使单元测试可不依赖数据库验证校验逻辑。

**NFR-TEST-02** **THE** 系统 **SHALL** 使 v2 迁移函数可被单元测试重复调用并断言幂等性（连续两次 `migrate` 后 `schema_migrations` 中 v2 仅一条记录）。

**NFR-TEST-03** **THE** 系统 **SHALL** 使占位接口可通过 HTTP 请求直接断言其状态码（501）与响应体结构，无需任何 mock。

**NFR-TEST-04** **THE** 系统 **SHALL** 使注册接口的防枚举行为可被测试断言：对「账号已存在」与「邮箱已存在」两种场景，响应的 `statusCode` 与 `message` 完全相等。

---

## 5. 约束

| 编号 | 约束 | 来源 |
| --- | --- | --- |
| C-01 | **零新增依赖**：注册与占位功能仅使用现有依赖（better-sqlite3、Node crypto、Nuxt/Nitro、@nuxt/ui、TailwindCSS）。引入任何新依赖前必须经用户确认。 | 项目约束 |
| C-02 | **前后端不分离**：所有能力基于 Nuxt/Nitro 一体实现，不另起后端服务。 | 用户偏好 |
| C-03 | **零回归**：不破坏现有认证、安装、数据库、内容浏览、会话守卫功能。 | 项目约束 |
| C-04 | **迁移幂等**：v2 迁移重复执行安全，`schema_migrations` 不产生重复记录。 | 项目约束 |
| C-05 | **TypeScript 优先**：复用 `shared/utils` 与 `shared/types`，前后端共享校验与类型。 | 项目约束 |
| C-06 | **注册页为游客页**：`/register` 已在 `GUEST_ONLY_PATHS` 中登记，已登录用户访问应被重定向。 | 现有机制 |
| C-07 | **第三方占位不引入 SDK**：仅 UI 按钮 + 返回 501 的接口占位，不引入任何 OAuth SDK。 | 任务目标 |
| C-08 | **代码风格**：Tab 缩进 + 双引号 + 无分号（服务端 TS）；错误用 `createError({ statusCode, message })`。 | 项目实测 |
| C-09 | **密码哈希复用**：注册接口必须复用 `server/utils/password.ts` 的 `hashPassword`，**禁止**引入其他哈希方案。 | 安全约束 |
| C-10 | **会话复用**：注册后若自动登录，必须复用 `server/utils/session.ts` 的 `setSession`，**禁止**另造会话机制。 | 安全约束 |

---

## 6. 依赖选型待确认清单

> 以下各项**均未在本次需求中引入依赖**，仅列出候选方案与决策点，供用户确认后再决定是否纳入后续迭代。

### [CONFIRM-01] 注册成功后是否自动建立会话

- **方案 A（默认推荐）**：注册成功后服务端调 `setSession` 写入会话 cookie，前端跳转首页。零新增依赖。
- **方案 B**：注册成功仅创建账号，前端跳转 `/login` 引导用户自行登录。零新增依赖。
- **是否需要新增依赖**：否。
- **决策影响**：影响注册接口是否调用 `setSession`、前端跳转目标。

### [CONFIRM-02] 第三方按钮点击行为

- **方案 A（默认推荐）**：点击 → 调占位接口 → 捕获 501 → 展示提示。验证接口契约存在性。
- **方案 B**：点击 → 仅前端 `placeholder()` 提示，不发请求（与现有 `login.vue` 行为一致）。
- **是否需要新增依赖**：否。
- **决策影响**：影响前端按钮事件处理逻辑；方案 A 会真实触发占位接口（可用于联调验证）。

### [CONFIRM-03] 占位接口在未安装时的守卫策略

- **方案 A（默认推荐）**：不放行，未安装时返回 503（与现有 `install-guard` 行为一致，无需改守卫）。
- **方案 B**：放行，未安装时也返回 501（需在 `install-guard.ts` 追加放行规则）。
- **是否需要新增依赖**：否。
- **决策影响**：影响 `server/middleware/install-guard.ts` 是否修改。

### [CONFIRM-04] 邮件验证是否需要

- **背景**：本需求范围内**不实现**邮件验证。但需确认未来是否需要「注册后发送验证邮件、点击链接激活账号」。
- **若需要，候选方案**：
  - 方案 A：`nodemailer`（最通用，零编译依赖，需配置 SMTP）。**需新增依赖** `nodemailer`。
  - 方案 B：`@nestjs-modules/mailer`（Nest 生态，FSP 非 Nest，不适用）。
  - 方案 C：直接使用 Node 内置 `net`/`tls` 手写 SMTP（零依赖但维护成本高，不推荐）。
  - 方案 D：接入第三方邮件 SaaS（Resend / SendGrid / 阿里云邮件推送）HTTP API（需 `fetch`，零新增依赖但需账号与配额）。
- **是否需要新增依赖**：方案 A 需新增 `nodemailer`；方案 D 零新增依赖但需外部服务账号。
- **决策影响**：若现在确认不需要，本次需求按「注册即激活（status=active）」实现；若确认需要，应作为独立后续需求单独立项，本次不实现。

### [CONFIRM-05] OAuth 真实接入时机与方案

- **背景**：本需求仅做占位。需确认 GitHub / QQ / 微信 真实接入的时机。
- **若需要，候选方案**：
  - 方案 A：`arctic`（Nuxt 官方 OAuth 模块，支持 GitHub/QQ/微信等多家）。**需新增依赖** `arctic`。
  - 方案 B：`lucia-auth`（通用认证库，配合适配器）。**需新增依赖**。
  - 方案 C：手写 OAuth 流程（零依赖，按各平台文档实现 `/authorize` 跳转 + token 交换 + 资料拉取，维护成本高）。
- **是否需要新增依赖**：方案 A/B 需新增依赖；方案 C 零新增依赖但工作量大。
- **决策影响**：本次按占位实现；真实接入作为独立后续需求。需确认是否在 `users` 表预留 `oauth_provider`、`oauth_subject` 字段（属于设计决策，由 design 阶段定）。

### [CONFIRM-06] 注册接口限流阈值与策略

- **背景**：本需求要求「简单防刷」。需确认具体阈值与是否需要分布式限流。
- **候选方案**：
  - 方案 A（默认推荐）：进程内计数，同一 IP 60 秒内最多 5 次注册请求，超出返回 429。零新增依赖，单实例生效。
  - 方案 B：进程内计数 + 滑动窗口（更精确，仍零依赖）。
  - 方案 C：分布式限流（需 Redis 或类似，**需新增依赖**，不推荐在当前部署形态下引入）。
- **是否需要新增依赖**：方案 A/B 否；方案 C 是。
- **决策影响**：影响注册接口防刷实现复杂度。

---

## 7. 建议的数据库迁移方案（v2）

> 本节为**建议**，供 design 阶段参考与用户确认。需求文档原则上不包含实现细节，但用户明确要求提供迁移 SQL 建议。

### 7.1 迁移目标

将 `users.email` 由 `TEXT`（可空、无唯一约束）改为 `TEXT NOT NULL UNIQUE`，并妥善处理存量 `email IS NULL` 的记录。

### 7.2 存量数据处理策略

安装向导中管理员 `email` 为可选字段，存量数据库可能存在 `email IS NULL` 的行。迁移前需先将其填充为合法且唯一的占位邮箱：

```sql
-- 为 email 为 NULL 的存量记录填充占位邮箱（基于 account 保证唯一性）
UPDATE users
SET email = account || '__legacy@local.invalid'
WHERE email IS NULL;
```

> 说明：`account` 本身具有 UNIQUE 约束，故 `account || '__legacy@local.invalid'` 天然唯一；`.invalid` 为 RFC 6761 保留 TLD，不会与真实邮箱冲突；`__legacy` 后缀便于后续识别并引导用户补填真实邮箱。

### 7.3 SQLite 表重建迁移 SQL（建议）

SQLite 不支持直接 `ALTER COLUMN` 改 NOT NULL/UNIQUE，采用「新建临时表 → 复制数据 → 删旧表 → 重命名」标准模式：

```sql
-- 1. 新建符合 v2 约束的临时表
CREATE TABLE users_v2 (
	id            INTEGER PRIMARY KEY AUTOINCREMENT,
	account       TEXT    NOT NULL UNIQUE,
	password_hash TEXT    NOT NULL,
	name          TEXT    NOT NULL,
	email         TEXT    NOT NULL UNIQUE,
	role          TEXT    NOT NULL DEFAULT 'admin',
	status        TEXT    NOT NULL DEFAULT 'active',
	created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
	updated_at    TEXT    NOT NULL DEFAULT (datetime('now')),
	last_login_at TEXT
);

-- 2. 复制存量数据（此时 email 已无 NULL，见 7.2）
INSERT INTO users_v2 (id, account, password_hash, name, email, role, status, created_at, updated_at, last_login_at)
SELECT id, account, password_hash, name, email, role, status, created_at, updated_at, last_login_at
FROM users;

-- 3. 删除旧表并重命名
DROP TABLE users;
ALTER TABLE users_v2 RENAME TO users;
```

### 7.4 迁移注册方式

在 `server/utils/schema.ts` 的 `MIGRATIONS` 数组追加 v2 项，复用现有幂等迁移框架（`schema_migrations` 版本表保证只执行一次）：

```ts
{
	version: 2,
	name: "users_email_not_null_unique",
	sql: `
		UPDATE users SET email = account || '__legacy@local.invalid' WHERE email IS NULL;
		CREATE TABLE users_v2 ( ... );  -- 同 7.3
		INSERT INTO users_v2 (...) SELECT ... FROM users;
		DROP TABLE users;
		ALTER TABLE users_v2 RENAME TO users;
	`,
}
```

> **幂等性保证**：v2 整体包裹在 `db.transaction()` 中（现有 `migrate()` 已如此处理），且 `schema_migrations` 记录 version=2 后不再重复执行。建议在事务内加 `SELECT COUNT(*) FROM users WHERE email IS NULL` 断言为 0 后再建表，双重保险。

### 7.5 风险与回滚

- **风险**：若存量 `account` 含特殊字符导致占位邮箱格式异常，需在迁移前校验。建议占位邮箱用 `account` 的安全编码（如 base64 或正则替换非字母数字）。
- **回滚**：v2 迁移不支持自动回滚（SQLite 表重建后旧表已 DROP）。建议迁移前备份 `data/` 目录下的 SQLite 文件。回滚方式为恢复备份文件并删除 `schema_migrations` 中 version=2 记录。

---

## 8. 验收标准

### 8.1 邮箱 + 账号注册

| 编号 | 验收条件 | 关联需求 |
| --- | --- | --- |
| AC-REG-01 | 访客访问 `/register`，页面渲染账号、邮箱、密码、确认密码输入项与注册按钮，风格与 `/login` 一致。 | FR-REG-01 |
| AC-REG-02 | 已登录用户访问 `/register`，被重定向至首页（或来源页），URL 不残留 `/register`。 | FR-REG-01 |
| AC-REG-03 | 提交合法的账号+邮箱+密码，返回 200 与 `{ user: { account, name } }`，users 表新增一条记录，`email` 非空且唯一，`password_hash` 以 `scrypt$` 开头。 | FR-REG-02, FR-REG-03 |
| AC-REG-04 | 提交缺失字段，返回 400 与「账号、邮箱和密码不能为空」。 | FR-REG-02 |
| AC-REG-05 | 提交非法邮箱格式，返回 400 与「邮箱格式不正确」。 | FR-REG-02 |
| AC-REG-06 | 提交弱密码（如 `12345678`、`abcdefgh`），返回 400 与「密码至少 8 位，需同时包含字母和数字」。 | FR-REG-02 |
| AC-REG-07 | 两次密码不一致，前端拦截并提示「两次输入的密码不一致」，不发请求。 | FR-REG-02 |
| AC-REG-08 | 提交已存在的账号，返回 409 与统一提示。提交已存在的邮箱，返回 409 与**同一**统一提示（statusCode 与 message 完全相等）。 | FR-REG-03, NFR-SEC-02 |
| AC-REG-09 | 注册成功后，使用同一账号+密码调用 `POST /api/auth/login`，返回 200 并成功建立会话。 | G1 |
| AC-REG-10 | 若采纳方案 A：注册成功后浏览器持有 `fsp_session` cookie，刷新页面仍为登录态。若采纳方案 B：注册成功后跳转 `/login`。 | FR-REG-04, CONFIRM-01 |
| AC-REG-11 | 同一 IP 60 秒内连续注册超过阈值（默认 5 次），返回 429 与「注册请求过于频繁，请稍后再试」。 | FR-REG-05 |
| AC-REG-12 | 注册页「已有账号？登录」链接跳转 `/login`；登录页「注册」链接跳转 `/register`。 | FR-REG-06 |
| AC-REG-13 | 现有登录、登出、安装、内容浏览功能行为不变（回归测试全绿）。 | G3, NFR-COMPAT-03 |

### 8.2 GitHub / QQ / 微信 占位

| 编号 | 验收条件 | 关联需求 |
| --- | --- | --- |
| AC-OAUTH-01 | 登录页与注册页均展示 GitHub、QQ、微信三个按钮，风格一致。 | FR-OAUTH-01 |
| AC-OAUTH-02 | `GET /api/auth/github` 返回 501 与 `{ code: 501, message: "GitHub 登录尚未接入", data: null }`。 | FR-OAUTH-02 |
| AC-OAUTH-03 | `GET /api/auth/qq` 返回 501 与对应文案。 | FR-OAUTH-02 |
| AC-OAUTH-04 | `GET /api/auth/wechat` 返回 501 与对应文案。 | FR-OAUTH-02 |
| AC-OAUTH-05 | 调用三个占位接口后，users 表无新增记录，无会话 cookie 写入，无外部网络请求发出。 | FR-OAUTH-02 |
| AC-OAUTH-06 | 系统未安装时调用占位接口，返回 503（若采纳方案 A）或 501（若采纳方案 B）。 | FR-OAUTH-03, CONFIRM-03 |
| AC-OAUTH-07 | 点击第三方按钮后，用户可见「{平台} 登录尚未接入，敬请期待」提示。 | FR-OAUTH-01 |

### 8.3 迁移与数据

| 编号 | 验收条件 | 关联需求 |
| --- | --- | --- |
| AC-MIG-01 | 在已存在 v1 数据库上启动应用，`migrate()` 自动执行 v2，`users.email` 变为 NOT NULL UNIQUE。 | NFR-MAINT-01 |
| AC-MIG-02 | v2 迁移后，存量用户记录的 id/account/password_hash/name/role/status/created_at/updated_at/last_login_at 完全不变。 | NFR-COMPAT-01 |
| AC-MIG-03 | v2 迁移后，无任何 `email IS NULL` 的记录；原 NULL 记录的 email 为 `account__legacy@local.invalid` 形式。 | NFR-COMPAT-02 |
| AC-MIG-04 | 连续两次启动应用（执行两次 `migrate()`），`schema_migrations` 中 version=2 仅一条记录，不报错。 | NFR-MAINT-01, NFR-TEST-02 |
| AC-MIG-05 | 在全新空数据库上启动，v1 与 v2 依次执行，最终结构与存量库一致。 | NFR-MAINT-01 |

---

## 9. 数据约束（领域对象）

> 本节定义核心领域对象的逻辑约束，不含数据库实现细节（类型、索引）。

### 9.1 注册请求体（RegisterPayload）

1. **account**：必填，非空字符串，前后端共享校验 `!isBlank(account)`；全局唯一。
2. **email**：必填，合法邮箱格式（`isValidEmail(email) === true`）；全局唯一。
3. **password**：必填，强密码（`isStrongPassword(password) === true`）。
4. **confirmPassword**：必填，须与 `password` 完全相等（前端校验）。
5. **name**：可选，为空时默认取 `account` 值。

### 9.2 注册成功响应体

1. **user.account**：等于请求体 `account`。
2. **user.name**：等于最终入库的 `name`（用户提供或默认 account）。

### 9.3 第三方占位响应体

1. **code**：固定 501。
2. **message**：固定文案「{平台} 登录尚未接入」，{平台} ∈ {GitHub, QQ, 微信}。
3. **data**：固定 `null`。

---

## 10. 建议的文件清单（待创建/修改）

> 本节为**建议**，供 design 与 task 阶段参考。需求文档原则上不涉及实现文件，但用户明确要求提供。

### 10.1 新建文件

| 文件路径 | 说明 |
| --- | --- |
| `app/pages/register.vue` | 注册页面，与 `login.vue` 风格一致，含账号/邮箱/密码/确认密码/昵称表单与三个第三方按钮。 |
| `server/api/auth/register.post.ts` | 注册接口 `POST /api/auth/register`，含校验、防枚举、防刷、创建用户、（可选）建立会话。 |
| `server/api/auth/github.get.ts` | GitHub 占位接口，返回 501。 |
| `server/api/auth/qq.get.ts` | QQ 占位接口，返回 501。 |
| `server/api/auth/wechat.get.ts` | 微信占位接口，返回 501。 |

### 10.2 修改文件

| 文件路径 | 修改内容 |
| --- | --- |
| `server/utils/schema.ts` | 在 `MIGRATIONS` 数组追加 v2 迁移项（email 改 NOT NULL UNIQUE + 存量数据处理）。 |
| `server/repositories/user.repository.ts` | 新增 `findUserByEmail(email)`；`createUser` 的 `email` 参数由可选改为必填（类型收紧）。 |
| `app/pages/login.vue` | 「注册」链接由 `placeholder('注册')` 改为真实跳转 `/register`；第三方按钮补齐 QQ（若当前仅微信+GitHub）。 |
| `app/utils/auth.ts` | `/register` 已在 `GUEST_ONLY_PATHS`，**无需修改**（确认即可）。 |
| `server/middleware/install-guard.ts` | **仅当 CONFIRM-03 采纳方案 B 时**修改：追加放行 `/api/auth/github`、`/api/auth/qq`、`/api/auth/wechat`。默认不改。 |

### 10.3 无需修改（确认即可）

| 文件路径 | 说明 |
| --- | --- |
| `app/middleware/a.CheckUser.global.ts` | 游客守卫已通过 `GUEST_ONLY_PATHS` 覆盖 `/register`，无需修改。 |
| `shared/utils/validate.ts` | `isValidEmail`、`isStrongPassword`、`isBlank` 已就绪，直接复用。 |
| `server/utils/password.ts` | `hashPassword` 直接复用。 |
| `server/utils/session.ts` | `setSession` 直接复用（若采纳自动登录）。 |
| `server/api/auth/login.post.ts` | 契约不变，无需修改。 |

---

## 11. 假设与待确认事项汇总

| 编号 | 事项 | 默认方案 | 影响 |
| --- | --- | --- | --- |
| CONFIRM-01 | 注册成功后是否自动登录 | 方案 A（自动登录） | 注册接口是否调 `setSession` |
| CONFIRM-02 | 第三方按钮点击行为 | 方案 A（调占位接口→提示） | 前端按钮事件逻辑 |
| CONFIRM-03 | 占位接口未安装时守卫策略 | 方案 A（不放行，返回 503） | 是否改 `install-guard.ts` |
| CONFIRM-04 | 邮件验证是否需要 | 本次不实现 | 是否引入 `nodemailer` 等 |
| CONFIRM-05 | OAuth 真实接入时机 | 本次仅占位 | 是否引入 `arctic` 等 |
| CONFIRM-06 | 注册限流阈值与策略 | 方案 A（进程内 60s/5 次） | 防刷实现复杂度 |

---

*文档结束。请评审上述需求规格，确认或提出修改意见后，将转入 design 阶段生成技术设计文档。*
