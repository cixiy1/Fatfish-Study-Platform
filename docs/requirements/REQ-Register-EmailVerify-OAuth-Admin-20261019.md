# 需求规格说明书：邮箱注册 + 邮件验证 + 真实 OAuth + 管理员后台

| 字段 | 值 |
| --- | --- |
| 文档编号 | REQ-Register-EmailVerify-OAuth-Admin-20261019 |
| 版本 | v1.0 |
| 创建日期 | 2026-10-19 |
| 状态 | 已实施（Implemented） |
| 所属项目 | FSP（基于 Nuxt 4.6.1 的前后端不分离内容管理系统） |
| 关联模块 | 认证体系（`server/api/auth/*`）、安装向导（`server/api/install/*`）、管理员后台（`app/pages/admin/*`）、数据库 schema v2/v3（`server/utils/schema.ts`） |
| 上游文档 | REQ-Register-OAuth-Placeholder-20261019（本文档为其超集扩展，将其中的占位升级为真实实现并新增邮件验证、SMTP、管理员后台） |
| 新增依赖 | `nodemailer` ^6（邮件发送）、`arctic` ^3（OAuth 接入） |

> 本文档采用 **EARS（Easy Approach to Requirements Syntax）** 格式表述需求，使用以下关键字：
> - **WHEN** *触发事件* **THE** 系统 **SHALL** *响应*（事件驱动）
> - **WHILE** *状态* **THE** 系统 **SHALL** *响应*（状态驱动）
> - **IF** *前置条件* **THEN THE** 系统 **SHALL** *响应*（条件分支）
> - **UNLESS** *例外条件* **THE** 系统 **SHALL** *响应*（例外）
> - **WHERE** *特性被纳入* **THE** 系统 **SHALL** *响应*（可选特性）
> - 复合形式：**WHEN** *触发* **IF** *条件* **THEN THE** 系统 **SHALL** *响应*

> **代码风格约束（实测，必须遵守）**：
> - 服务端 TypeScript：**Tab 缩进 + 双引号 + 无分号**
> - 错误抛出：`throw createError({ statusCode, message })`，使用 `message` 而非 `statusMessage`
> - Vue 单文件组件沿用现有 `login.vue` 的缩进风格（2 空格）
> - 校验复用 `shared/utils/validate.ts`，前后端共享，禁止重复实现

---

## 1. 任务描述与范围

### 1.1 背景

FSP 是一个基于 Nuxt 4.6.1 + Nitro 的前后端不分离内容管理系统（CMS），一体部署到自有服务器。当前认证体系已实现「安装向导 → 管理员账号 → 账号密码登录 → 签名会话 cookie（HMAC-SHA256）」的完整闭环，但尚无用户自助注册入口，登录页第三方按钮仅为前端文案占位，且无邮件验证、无 OAuth 真实接入、无管理员后台配置入口。

本需求在**一次交付**内补齐七大能力模块，将上一版（REQ-Register-OAuth-Placeholder-20261019）中的占位升级为真实实现，并新增邮件验证、SMTP 配置、管理员后台。引入两个新依赖：`nodemailer` ^6（邮件发送）、`arctic` ^3（OAuth 接入）。

### 1.2 范围内（In Scope）

1. **邮箱 + 账号注册**：注册页 `app/pages/register.vue`、注册接口 `POST /api/auth/register`（校验 + 防枚举 + 进程内限流 + 创建用户 + 自动登录）。
2. **邮件验证**：注册后创建 `status=pending` 用户 → 生成验证 token → 发送验证邮件 → 用户点击链接激活（`status=active`）；未验证用户不能登录。
3. **SMTP 配置**：支持 Gmail/QQ/163/自定义预设，存数据库 `settings` 表，密码加密存储；install 向导可选配置；管理员后台可修改。
4. **真实 OAuth 接入**：GitHub / QQ / 微信 三平台，发起授权跳转 + 回调处理 + 用户创建/匹配 + 自动登录；凭证未配置返回 501。
5. **install 向导扩展**：新增 SMTP + OAuth 凭证可选配置步骤，向后兼容。
6. **管理员后台**：`/admin` 路由 + 管理员权限守卫 + 概览页 + SMTP 配置页 + OAuth 凭证页 + settings 读写接口 + 测试 SMTP 接口。
7. **数据库迁移**：v2（users 表重建：email NOT NULL UNIQUE + 新增 email_verified_at / oauth_provider / oauth_subject）+ v3（新增 email_verification_tokens 表），幂等，存量数据安全迁移。

### 1.3 范围外（Out of Scope）

- **不**实现找回密码、修改密码、邮箱变更、账号停用/启用等用户管理功能（留后续迭代）。
- **不**实现分布式限流（不引入 Redis），仅进程内限流，单实例生效。
- **不**实现图形/短信验证码。
- **不**实现 OAuth 平台资料同步与定期刷新（仅首次登录拉取资料创建/匹配用户）。
- **不**实现多语言邮件模板（仅中文纯文本 + HTML）。
- **不**实现管理员用户管理列表（仅做配置页：SMTP + OAuth 凭证，不做用户增删改查）。
- **不**改动现有登出 `POST /api/auth/logout`、当前用户 `GET /api/auth/me`、内容浏览 `app/pages/index.vue` / `[...slug].vue` 的契约。
- **不**引入除 `nodemailer`、`arctic` 之外的第三方依赖（不引入 ORM、限流库、CSRF 库等）。

---

## 2. 利益相关者与目标

### 2.1 利益相关者

| 角色 | 关注点 |
| --- | --- |
| **访客（未登录用户）** | 能自助注册；注册后收到验证邮件，点击链接激活；能用 GitHub/QQ/微信 一键登录；流程清晰、错误提示明确。 |
| **已验证用户** | 能正常登录使用系统；不会被未验证状态误拦。 |
| **管理员（安装时创建）** | 无需邮件验证即可登录；能在后台配置 SMTP 与 OAuth 凭证；存量数据迁移不丢失信息。 |
| **后端开发者** | 接口风格与现有一致；迁移幂等；新依赖引入有明确理由；SMTP 密码加密存储安全。 |
| **前端开发者** | 注册页/后台页与现有风格统一；OAuth 跳转与回调链路清晰。 |
| **安全评审方** | 密码 scrypt 哈希；注册防账号枚举；注册进程内限流；验证 token 高熵单次有效；OAuth state 防 CSRF；SMTP 密码加密存储；管理员后台权限隔离；无开放重定向。 |
| **运维方** | install 向导可选配置 SMTP/OAuth，可跳过后续在后台补；迁移可重复执行；单实例部署即可工作。 |

### 2.2 目标

1. **G1 — 注册闭环可用**：访客在 `/register` 提交账号+邮箱+密码 → 收到验证邮件 → 点击链接激活 → 可凭账号密码登录。
2. **G2 — 邮件验证落地**：未验证用户（status=pending）不能登录；验证后 status=active 可登录；管理员免验证。
3. **G3 — OAuth 真实可用**：配置凭证后，GitHub/QQ/微信 三平台可完成授权跳转 → 回调 → 创建/匹配用户 → 自动登录。
4. **G4 — SMTP 可配置可测试**：SMTP 配置存数据库，支持预设，管理员后台可改可测试发送。
5. **G5 — 管理员后台可用**：`/admin` 仅管理员可访问，提供概览 + SMTP 配置 + OAuth 凭证配置。
6. **G6 — 唯一性约束落地**：账号全局唯一、邮箱全局唯一且非空、OAuth (provider, subject) 联合唯一。
7. **G7 — 零回归**：现有安装、登录、登出、会话、守卫、内容浏览等功能行为不变（登录接口仅新增 status 检查，管理员不受影响）。
8. **G8 — 迁移安全**：v2/v3 迁移幂等，对存量数据库（含 email 为 NULL 的管理员）安全可执行。
9. **G9 — 依赖最小化**：仅新增 `nodemailer` ^6 与 `arctic` ^3，其余复用现有依赖。

---

## 3. 功能需求

### 3.1 邮箱 + 账号注册

#### FR-REG-01 注册页面呈现

**WHEN** 访客在浏览器地址栏输入 `/register` 或点击登录页「注册」链接 **THE** 系统 **SHALL** 渲染注册页面 `register.vue`，页面包含账号、邮箱、密码、确认密码四个输入项，以及可选的昵称输入项与「注册」提交按钮。

**WHILE** 系统已安装且当前用户未登录 **THE** 系统 **SHALL** 允许访问 `/register` 且不触发登录重定向。

**WHEN** 已登录用户访问 `/register` **THE** 系统 **SHALL** 重定向至来源页或首页（复用 `guestOnly` 机制与 `safeRedirect`），且 `replace: true` 不写入浏览器历史栈。

**WHERE** 注册页被纳入 **THE** 系统 **SHALL** 在页面底部提供返回登录页的链接，并在「或」分隔线下方展示三个第三方注册入口按钮（GitHub / QQ / 微信）。

#### FR-REG-02 注册接口契约

**WHEN** 客户端向 `POST /api/auth/register` 提交 JSON 体 `{ account, email, password, name? }` **THE** 系统 **SHALL** 校验全部字段并在校验通过后创建用户（status=pending），生成验证 token，发送验证邮件，返回 HTTP 200 与响应体 `{ user: { account, name } }`。

**IF** 请求体缺失 `account`、`email` 或 `password` 任一字段 **THEN THE** 系统 **SHALL** 返回 HTTP 400 与错误提示「账号、邮箱和密码不能为空」。

**IF** `email` 不满足邮箱格式（复用 `isValidEmail`） **THEN THE** 系统 **SHALL** 返回 HTTP 400 与错误提示「邮箱格式不正确」。

**IF** `password` 不满足强度规则（复用 `isStrongPassword`：至少 8 位且同时含字母与数字） **THEN THE** 系统 **SHALL** 返回 HTTP 400 与错误提示「密码至少 8 位，需同时包含字母和数字」。

**IF** 客户端提交的 `password` 与 `confirmPassword` 不一致 **THEN THE** 系统 **SHALL** 在前端拦截并提示「两次输入的密码不一致」，不发起请求。

**WHERE** `name`（昵称）字段被提供且非空 **THE** 系统 **SHALL** 以提供的昵称创建用户；**UNLESS** `name` 为空或未提供 **THE** 系统 **SHALL** 以 `account` 作为用户 `name` 的默认值。

#### FR-REG-03 唯一性与防账号枚举

**IF** 提交的 `account` 已存在于 users 表 **THEN THE** 系统 **SHALL** 返回 HTTP 409 与统一提示「注册失败，请检查输入或更换账号/邮箱后重试」。

**IF** 提交的 `email` 已存在于 users 表 **THEN THE** 系统 **SHALL** 返回 HTTP 409 与同一统一提示「注册失败，请检查输入或更换账号/邮箱后重试」。

> **防枚举说明**：账号已存在与邮箱已存在返回**完全相同**的错误码与文案，且响应耗时无明显差异，避免攻击者通过差异化响应枚举已注册账号或邮箱。

**UNLESS** `account` 与 `email` 均不存在于 users 表 **THE** 系统 **SHALL** 创建新用户，其 `account`、`email` 唯一，`password_hash` 由 `hashPassword`（scrypt）生成，`role` 默认为 `admin`，`status` 默认为 `pending`（待邮件验证）。

#### FR-REG-04 注册成功后自动登录（CONFIRM-01 = A）

**WHEN** 注册接口成功创建用户 **THE** 系统 **SHALL** 在响应中返回 `{ user: { account, name } }`。

> **决策已确认**：注册成功后**不立即自动登录**，因为用户 status=pending 尚未通过邮件验证。自动登录发生在邮件验证成功之后（见 FR-VERIFY-03）。注册成功后前端跳转至登录页或显示「验证邮件已发送，请查收」提示页。

**WHEN** 注册成功 **THE** 系统 **SHALL** 向用户返回「验证邮件已发送，请查收邮箱完成激活」提示，前端跳转至登录页（`/login`）并携带提示参数，**不**写入会话 cookie。

#### FR-REG-05 注册接口进程内限流（CONFIRM-06 = A）

**WHEN** 同一来源 IP 在 60 秒时间窗口内调用 `POST /api/auth/register` 超过 5 次 **THE** 系统 **SHALL** 返回 HTTP 429 与提示「注册请求过于频繁，请稍后再试」，且不创建用户、不发送邮件。

**WHILE** 限流计数器在进程内维护 **THE** 系统 **SHALL** 不引入 Redis 等外部依赖，单实例生效；进程重启后计数器重置。

**WHEN** 注册接口被调用 **THE** 系统 **SHALL** 记录注册请求日志（含时间、IP、目标账号/邮箱脱敏），**禁止**在日志中完整记录用户凭据。

#### FR-REG-06 注册页与登录页的互通

**WHEN** 注册页渲染 **THE** 系统 **SHALL** 提供「已有账号？登录」链接，指向 `/login`。

**WHEN** 登录页渲染 **THE** 系统 **SHALL** 将现有「注册」占位链接（当前为 `placeholder('注册')`）替换为真实跳转至 `/register` 的导航。

---

### 3.2 邮件验证（CONFIRM-04 = B）

#### FR-VERIFY-01 注册流程改为待验证

**WHEN** 注册接口创建用户 **THE** 系统 **SHALL** 将用户 `status` 置为 `pending`，`email_verified_at` 置为 NULL，并生成一个高熵随机验证 token（使用 Node 内置 `crypto.randomBytes`，长度 ≥ 32 字节，base64url 编码）。

**WHEN** 验证 token 生成 **THE** 系统 **SHALL** 将其写入 `email_verification_tokens` 表，记录 `user_id`、`token`、`expires_at`（当前时间 + 24 小时）、`used_at` = NULL。

#### FR-VERIFY-02 验证邮件发送

**WHEN** 注册成功且 SMTP 已配置 **THE** 系统 **SHALL** 通过 `nodemailer` 发送验证邮件至用户邮箱，邮件含验证链接 `{baseUrl}/api/auth/verify-email?token={token}`，其中 `baseUrl` 取自站点配置（`AppConfig.site.url`，缺省回退到请求来源 Origin）。

**IF** SMTP 未配置（settings 表中无 SMTP 配置或配置不完整） **THEN THE** 系统 **SHALL** 仍创建用户（status=pending）并返回注册成功，但**不**发送邮件，并在服务端日志记录「SMTP 未配置，验证邮件未发送」警告；前端提示用户「验证邮件暂未发送，请联系管理员」。

> **设计权衡**：SMTP 未配置时不阻断注册，避免在未配置 SMTP 的环境下完全无法注册。用户可联系管理员手动激活或配置 SMTP 后重发。此行为需在响应中区分提示。

**WHEN** 邮件发送失败（SMTP 连接错误、认证失败等） **THE** 系统 **SHALL** 捕获异常并记录日志，注册仍返回成功（用户已创建），前端提示「验证邮件发送失败，请联系管理员或稍后重试」。

#### FR-VERIFY-03 验证接口

**WHEN** 用户点击验证链接，客户端请求 `GET /api/auth/verify-email?token=xxx` **THE** 系统 **SHALL** 校验 token 有效性。

**IF** token 不存在、已使用（used_at IS NOT NULL）或已过期（expires_at < 当前时间） **THEN THE** 系统 **SHALL** 渲染验证失败页面（或跳转登录页带错误参数），提示「验证链接无效或已过期，请重新注册或联系管理员」。

**UNLESS** token 无效 **THE** 系统 **SHALL** 执行激活：将对应用户 `status` 置为 `active`，`email_verified_at` 置为当前时间，将 token 的 `used_at` 置为当前时间（单次有效），随后自动登录（调 `setSession` 写会话 cookie）并跳转首页。

**WHEN** 验证成功并自动登录 **THE** 系统 **SHALL** 调用 `setSession(event, { account, name })` 写入会话 cookie（会话级），前端跳转至首页。

#### FR-VERIFY-04 未验证用户不能登录

**WHEN** 用户调用 `POST /api/auth/login` 提交账号密码 **IF** 账号存在且密码正确且 `status === 'pending'` **THEN THE** 系统 **SHALL** 返回 HTTP 403 与提示「账号尚未验证邮箱，请查收验证邮件或联系管理员」。

> **⚠️ 防枚举冲突提示（需用户确认权衡）**：现有 `login.post.ts` 对「账号不存在 / 密码错误 / 账号停用」统一返回 401「账号或密码错误」以防止账号枚举。本需求要求 pending 返回 403 明确提示，这会让攻击者能区分「账号不存在」（401）与「账号存在但未验证」（403），**破坏防枚举**。
>
> 候选权衡方案：
> - **方案 X（本需求默认）**：仅在密码校验通过后才返回 403（即攻击者需先知道正确密码才能探测验证状态，风险可控）。
> - **方案 Y**：统一返回 401，登录成功后若 pending 再清除会话并提示验证（体验差）。
> - **方案 Z**：403 提示模糊化，返回「账号或密码错误，或尚未验证邮箱」（兼顾防枚举与提示）。
>
> 本文档默认采用**方案 X**：仅当账号存在且密码正确时才区分 pending（403）与 active（200），账号不存在或密码错误仍统一 401。这样攻击者必须先获取正确密码才能探测验证状态，防枚举强度可接受。

#### FR-VERIFY-05 邮件模板

**WHEN** 发送验证邮件 **THE** 系统 **SHALL** 同时提供纯文本与 HTML 两种格式，内容包含：站点名称、用户昵称、验证链接、链接有效期（24 小时）、「本邮件由系统自动发送」页脚。

**WHERE** HTML 模板被纳入 **THE** 系统 **SHALL** 使用内联样式（不依赖外部 CSS），链接可点击，结构简洁兼容主流邮件客户端。

#### FR-VERIFY-06 安装向导管理员免验证

**WHEN** 安装向导创建管理员 **THE** 系统 **SHALL** 将管理员 `status` 置为 `active`，`email_verified_at` 置为当前时间，**不**发送验证邮件，管理员可立即登录。

---

### 3.3 SMTP 配置

#### FR-SMTP-01 配置存储

**WHEN** SMTP 配置被保存 **THE** 系统 **SHALL** 将其存入数据库 `settings` 表（key-value 结构，v1 已存在），使用约定 key 前缀（如 `smtp.host`、`smtp.port`、`smtp.user`、`smtp.pass`、`smtp.from`、`smtp.preset`）。

> **实现说明**：`settings` 表在 v1 迁移中已创建（`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT)`），**无需新建专用表**，直接复用。

#### FR-SMTP-02 预设类型

**WHERE** 用户选择 SMTP 预设 **THE** 系统 **SHALL** 支持以下预设：
- **Gmail**：host=`smtp.gmail.com`，port=587，需用户填 user/pass（建议应用专用密码）。
- **QQ**：host=`smtp.qq.com`，port=587，需用户填 user/pass（授权码）。
- **163**：host=`smtp.163.com`，port=587，需用户填 user/pass（授权码）。
- **自定义**：host/port/user/pass/from 全自填。

**WHEN** 选择预设 **THE** 系统 **SHALL** 自动填充对应 host/port，用户仅需补充凭据与 from。

#### FR-SMTP-03 install 向导 SMTP 步骤

**WHERE** install 向导新增 SMTP 配置步骤被纳入 **THE** 系统 **SHALL** 将其设为**可选**，用户可跳过（后续在管理员后台配置）；跳过时不写入任何 SMTP 配置到 settings 表。

#### FR-SMTP-04 管理员后台修改 SMTP

**WHEN** 管理员在后台 SMTP 配置页提交配置 **THE** 系统 **SHALL** 通过 `PUT /api/admin/settings` 更新 settings 表中 SMTP 相关键值，并返回更新后的配置（密码字段脱敏返回，如 `****` 或掩码）。

#### FR-SMTP-05 SMTP 密码加密存储

**WHEN** SMTP 密码（`smtp.pass`）被写入 settings 表 **THE** 系统 **SHALL** 使用对称加密（AES-256-GCM，密钥派生自会话密钥或独立配置密钥）加密后存储，**禁止**明文存储。

> **⚠️ 潜在风险（需设计阶段明确）**：现有 `server/utils/crypto.ts` 仅含 HMAC 签名能力（`sign` / `verify` / `encodePayload` / `decodePayload`），**无对称加密函数**。实现 SMTP 密码加密需在 `crypto.ts` 新增 `encrypt(plaintext)` / `decrypt(ciphertext)` 函数（基于 `node:crypto` 的 `createCipheriv` / `createDecipheriv`，AES-256-GCM），加密密钥需有明确来源（建议复用 `AppConfig.security.sessionSecret` 或新增独立 `encryptionKey`）。此为新增能力，列入文件清单的修改项。

---

### 3.4 真实 OAuth 接入（CONFIRM-05 = B）

#### FR-OAUTH-01 三平台发起授权

**WHEN** 客户端请求 `GET /api/auth/github` **THE** 系统 **SHALL** 使用 `arctic` 生成 GitHub OAuth authorize 跳转 URL（含 state 防 CSRF），并返回 302 重定向至 GitHub 授权页。

**WHEN** 客户端请求 `GET /api/auth/qq` **THE** 系统 **SHALL** 同上生成 QQ 授权跳转。

**WHEN** 客户端请求 `GET /api/auth/wechat` **THE** 系统 **SHALL** 同上生成微信授权跳转。

#### FR-OAUTH-02 凭证未配置返回 501

**IF** GitHub 凭证（Client ID / Client Secret）未在 settings 表配置 **THEN THE** 系统 **SHALL** 对 `GET /api/auth/github` 返回 HTTP 501 与 `{ code: 501, message: "GitHub 登录尚未配置", data: null }`。

**IF** QQ 凭证未配置 **THEN THE** 系统 **SHALL** 对 `GET /api/auth/qq` 返回 501 与「QQ 登录尚未配置」。

**IF** 微信凭证未配置 **THEN THE** 系统 **SHALL** 对 `GET /api/auth/wechat` 返回 501 与「微信登录尚未配置」。

#### FR-OAUTH-03 回调处理

**WHEN** OAuth 平台回调至 `GET /api/auth/github/callback?code=xxx&state=yyy` **THE** 系统 **SHALL** 校验 state（防 CSRF），用 code 交换 access_token，拉取用户资料（账号 id、昵称、邮箱（若有）），随后查找或创建用户，调 `setSession` 写会话 cookie，跳转首页。

**WHEN** QQ / 微信回调至对应 `/callback` 路由 **THE** 系统 **SHALL** 执行相同流程。

**IF** state 校验失败、code 交换失败或资料拉取失败 **THEN THE** 系统 **SHALL** 跳转登录页并携带错误参数，提示「{平台} 登录失败，请重试」。

#### FR-OAUTH-04 OAuth 用户创建与匹配

**WHEN** OAuth 回调拉取到用户资料 **THE** 系统 **SHALL** 以 `(oauth_provider, oauth_subject)` 联合查找 users 表：
- **若存在**：直接复用该用户，更新 `last_login_at`，建立会话。
- **若不存在**：创建新用户，`oauth_provider` = 平台标识，`oauth_subject` = 平台用户 id，`status` = `active`（OAuth 用户免邮件验证），`account` 随机生成（如 `{provider}_{randomId}`，保证唯一），`email` 取平台返回邮箱（若有）或占位邮箱（`{provider}_{subject}@oauth.local.invalid`，满足 NOT NULL UNIQUE），`password_hash` 为空串或随机不可用值（OAuth 用户无密码登录），`email_verified_at` 置为当前时间。

**WHERE** OAuth 用户被创建 **THE** 系统 **SHALL** 保证 `(oauth_provider, oauth_subject)` 联合唯一，避免同一第三方账号重复创建。

> **⚠️ 技术风险（需设计阶段验证）**：`arctic` ^3 主要面向标准 OAuth2 / OIDC 提供商（GitHub、Google 等）。微信使用自定义协议（含 unionid、扫码登录、网页授权等变体），QQ 也有部分非标准实现。需在 design 阶段确认 `arctic` ^3 是否原生支持微信与 QQ：
> - 若支持：直接使用对应 provider。
> - 若不支持：需基于 `arctic` 的 `OAuth2Client` 基类自定义微信/QQ provider，或对微信采用手写流程。
> 此风险列入第 11 节「假设与待确认事项」。

#### FR-OAUTH-05 凭证存储

**WHEN** OAuth 凭证被保存 **THE** 系统 **SHALL** 存入 settings 表，使用约定 key（如 `oauth.github.client_id`、`oauth.github.client_secret`、`oauth.qq.app_id`、`oauth.qq.app_key`、`oauth.wechat.app_id`、`oauth.wechat.app_secret`）；Client Secret / App Key 等敏感字段**加密存储**（复用 FR-SMTP-05 的对称加密能力）。

#### FR-OAUTH-06 前端按钮跳转（CONFIRM-02 = A）

**WHEN** 用户在登录页或注册页点击 GitHub / QQ / 微信 按钮 **THE** 系统 **SHALL** 跳转至对应 `/api/auth/{platform}` 接口（由浏览器发起 GET，服务端返回 302 或 501）。

**IF** 接口返回 501 **THEN THE** 前端 **SHALL** 捕获并提示「{平台} 登录尚未配置，请联系管理员或在后台开启」。

---

### 3.5 install 向导扩展

#### FR-INSTALL-01 新增可选配置步骤

**WHERE** install 向导新增「可选配置」步骤被纳入 **THE** 系统 **SHALL** 在现有「数据库 + 管理员 + 站点」步骤之后，新增 SMTP 配置与 OAuth 凭证配置（三平台各自可选），所有新增步骤均可跳过。

**WHEN** 用户在 install 向导跳过 SMTP / OAuth 配置 **THE** 系统 **SHALL** 不写入任何相关配置到 settings 表，后续可在管理员后台补配。

#### FR-INSTALL-02 setup 接口扩展

**WHEN** 客户端调用 `POST /api/install/setup` **THE** 系统 **SHALL** 在现有 `{ database, admin, site }` 基础上，可选接收 `{ smtp?, oauth? }` 字段；`smtp` 含 preset/host/port/user/pass/from，`oauth` 含 github/qq/wechat 各自的 client_id/client_secret（或 app_id/app_key）。

**IF** 请求体不含 `smtp` 或 `oauth` 字段 **THEN THE** 系统 **SHALL** 视为跳过，不写入对应配置，安装仍成功。

#### FR-INSTALL-03 向后兼容

**WHEN** 现有仅含 `{ database, admin, site }` 的安装请求被提交 **THE** 系统 **SHALL** 正常完成安装，行为与扩展前一致（零回归）。

**WHEN** 现有 `GET /api/install/status` 被调用 **THE** 系统 **SHALL** 保持其响应契约不变。

---

### 3.6 管理员后台

#### FR-ADMIN-01 /admin 路由与权限守卫

**WHEN** 用户访问 `/admin` 及其子路由（`/admin/smtp`、`/admin/oauth`） **IF** 当前用户未登录或 `role !== 'admin'` **THEN THE** 系统 **SHALL** 返回 HTTP 403 或重定向至首页（前端中间件拦截），且不渲染后台内容。

**WHILE** 用户已登录且 `role === 'admin'` **THE** 系统 **SHALL** 允许访问 `/admin` 及其子路由。

> **实现说明**：需新增管理员守卫中间件 `app/middleware/admin.global.ts`（或复用现有 `a.CheckUser.global.ts` 扩展），在路由匹配 `/admin` 前缀时校验 `role`。当前 `SessionUser` 仅含 `{ account, name }`，**不含 role**。需确认：方案一为扩展 SessionPayload 携带 role（改动 session.ts）；方案二为后台中间件通过 `/api/auth/me` 或新增 `/api/admin/me` 二次查询用户 role。建议方案二以最小化会话改动，列入待确认。

#### FR-ADMIN-02 后台首页

**WHEN** 管理员访问 `/admin` **THE** 系统 **SHALL** 渲染后台概览页 `app/pages/admin/index.vue`，展示站点基本信息、SMTP 配置状态（已配置/未配置）、OAuth 各平台配置状态、用户总数等概览指标。

#### FR-ADMIN-03 SMTP 配置页

**WHEN** 管理员访问 `/admin/smtp` **THE** 系统 **SHALL** 渲染 SMTP 配置表单，含预设选择（Gmail/QQ/163/自定义）、host、port、user、pass、from 字段，密码字段以掩码显示已存配置，提供「保存」与「测试发送」按钮。

#### FR-ADMIN-04 OAuth 凭证配置页

**WHEN** 管理员访问 `/admin/oauth` **THE** 系统 **SHALL** 渲染三平台（GitHub / QQ / 微信）凭证配置表单，各平台含 Client ID / Client Secret（或 App ID / App Key）字段，敏感字段掩码显示，提供「保存」按钮，各平台可独立启用/禁用。

#### FR-ADMIN-05 settings 读写接口

**WHEN** 管理员调用 `GET /api/admin/settings` **THE** 系统 **SHALL** 返回当前 SMTP + OAuth 全部配置，敏感字段（密码、secret）脱敏返回（掩码或空）。

**WHEN** 管理员调用 `PUT /api/admin/settings` 提交配置 **THE** 系统 **SHALL** 更新 settings 表对应键值，敏感字段加密存储；**IF** 提交的敏感字段为掩码占位值（如 `****`） **THEN THE** 系统 **SHALL** 保留原值不变（避免掩码覆盖真实密码）。

**IF** 调用者非管理员 **THEN THE** 系统 **SHALL** 返回 HTTP 403。

#### FR-ADMIN-06 测试 SMTP 接口

**WHEN** 管理员调用 `POST /api/admin/test-smtp` 提交 `{ to }`（收件地址） **THE** 系统 **SHALL** 使用当前 SMTP 配置发送一封测试邮件至 `to`，成功返回 200 与「测试邮件已发送」，失败返回 500 与错误原因（连接失败、认证失败等，不泄露堆栈）。

**IF** SMTP 未配置 **THEN THE** 系统 **SHALL** 返回 400 与「请先配置 SMTP」。

---

### 3.7 数据库迁移（功能层面）

#### FR-MIG-01 v2 迁移：users 表重建

**WHEN** 应用启动并执行 `migrate()` **IF** schema_migrations 中无 version=2 记录 **THEN THE** 系统 **SHALL** 执行 v2 迁移：将 `users.email` 改为 `NOT NULL UNIQUE`，新增 `email_verified_at`（TEXT，可空）、`oauth_provider`（TEXT，可空）、`oauth_subject`（TEXT，可空）字段，妥善处理存量 `email IS NULL` 记录。

#### FR-MIG-02 v3 迁移：验证 token 表

**WHEN** 应用启动并执行 `migrate()` **IF** schema_migrations 中无 version=3 记录 **THEN THE** 系统 **SHALL** 执行 v3 迁移：创建 `email_verification_tokens` 表（id, user_id, token, expires_at, used_at, created_at）。

> **说明**：`settings` 表在 v1 已创建，**无需在 v2/v3 重建**。v2/v3 仅涉及 users 表重建与 email_verification_tokens 表新增。

#### FR-MIG-03 幂等与存量安全

**WHEN** v2/v3 迁移重复执行 **THE** 系统 **SHALL** 保证幂等：`schema_migrations` 中 version=2/3 各仅一条记录，重复启动不报错、不重复执行 SQL。

**WHEN** v2 迁移在存量数据库执行 **THE** 系统 **SHALL** 保留全部存量用户记录的 `id`、`account`、`password_hash`、`name`、`role`、`status`、`created_at`、`updated_at`、`last_login_at` 不变；存量 `email IS NULL` 记录填充为 `account__legacy@local.invalid` 形式占位邮箱。

---

## 4. 非功能需求

### 4.1 安全性

**NFR-SEC-01** **WHEN** 用户提交密码 **THE** 系统 **SHALL** 使用 `hashPassword`（scrypt，内存硬算法）哈希后存储，**禁止**明文或可逆存储密码。

**NFR-SEC-02** **WHEN** 注册因账号或邮箱已存在而失败 **THE** 系统 **SHALL** 返回统一错误码（409）与统一文案，**禁止**区分「账号已存在」与「邮箱已存在」，防账号枚举。

**NFR-SEC-03** **WHEN** 注册或 OAuth 回调涉及回跳地址 **THE** 系统 **SHALL** 使用 `safeRedirect` 校验，**禁止**接受站外地址，防开放重定向。

**NFR-SEC-04** **WHEN** 注册接口记录日志 **THE** 系统 **SHALL** 对账号与邮箱脱敏，**禁止**完整记录用户凭据或密码。

**NFR-SEC-05** **WHEN** 验证 token 生成 **THE** 系统 **SHALL** 使用 `crypto.randomBytes`（≥32 字节）保证高熵不可预测；token 单次有效（used_at 标记），过期失效（24 小时）。

**NFR-SEC-06** **WHEN** OAuth 发起授权 **THE** 系统 **SHALL** 生成随机 state 参数并在回调时校验，防 CSRF；state 应与用户会话或短期 cookie 绑定。

**NFR-SEC-07** **WHEN** SMTP 密码与 OAuth Client Secret 被存储 **THE** 系统 **SHALL** 使用 AES-256-GCM 对称加密，**禁止**明文存储；加密密钥需有明确安全来源。

**NFR-SEC-08** **WHILE** 管理员后台接口被调用 **THE** 系统 **SHALL** 校验调用者 `role === 'admin'`，非管理员返回 403；敏感字段在读取时脱敏返回。

**NFR-SEC-09** **WHEN** OAuth 用户被创建 **THE** 系统 **SHALL** 保证 `(oauth_provider, oauth_subject)` 联合唯一，避免重复绑定。

**NFR-SEC-10** **WHEN** 邮件验证链接被点击 **THE** 系统 **SHALL** 在激活后立即标记 token 已使用（used_at），**禁止**同一 token 二次激活。

### 4.2 可维护性

**NFR-MAINT-01** **WHEN** 数据库启动并执行 `migrate()` **THE** 系统 **SHALL** 幂等地将 schema 升级至 v3，重复执行不报错、不重复写入 `schema_migrations`。

**NFR-MAINT-02** **WHEN** 需要扩展数据访问能力 **THE** 系统 **SHALL** 在对应 repository 文件内集中新增 SQL（如 `findUserByEmail`、`findUserByOauth`、`createOAuthUser`、`activateUser`、token 的 CRUD），**禁止**在接口处理函数内直接写 SQL。

**NFR-MAINT-03** **THE** 系统 **SHALL** 复用 `shared/utils/validate.ts` 的 `isValidEmail`、`isBlank`、`isStrongPassword` 进行前后端一致校验，**禁止**重复实现校验正则。

**NFR-MAINT-04** **THE** 系统 **SHALL** 保持错误处理风格一致（`createError({ statusCode, message })`），**禁止**混用 `statusMessage` 与 `message`。

**NFR-MAINT-05** **THE** 系统 **SHALL** 将 `nodemailer` 封装集中于 `server/utils/email.ts`，将 `arctic` provider 配置集中于 `server/utils/oauth.ts`，**禁止**在多个接口内分散初始化。

### 4.3 兼容性

**NFR-COMPAT-01** **WHEN** v2 迁移在已存在 v1 数据库上执行 **THE** 系统 **SHALL** 保留全部存量用户记录核心字段不变（见 FR-MIG-03）。

**NFR-COMPAT-02** **IF** 存量用户 `email` 为 NULL **THEN THE** 系统 **SHALL** 在 v2 迁移中填充 `account__legacy@local.invalid` 占位邮箱，满足 NOT NULL UNIQUE。

**NFR-COMPAT-03** **WHEN** 现有登录接口 `POST /api/auth/login` 被合法 active 用户调用 **THE** 系统 **SHALL** 保持其原有响应契约 `{ user: { account, name } }` 不变。

**NFR-COMPAT-04** **WHEN** 现有 `POST /api/install/setup` 收到仅含 `{ database, admin, site }` 的请求 **THE** 系统 **SHALL** 正常完成安装（向后兼容）。

**NFR-COMPAT-05** **THE** 系统 **SHALL** 保持代码风格一致：服务端 TS 使用 Tab 缩进 + 双引号 + 无分号；Vue SFC 沿用 `login.vue` 风格。

**NFR-COMPAT-06** **WHEN** 现有登出 `POST /api/auth/logout`、当前用户 `GET /api/auth/me`、内容浏览页被调用 **THE** 系统 **SHALL** 保持其行为不变。

### 4.4 可测试性

**NFR-TEST-01** **THE** 系统 **SHALL** 为注册接口校验逻辑提供可独立测试的纯函数入口（复用 `shared/utils/validate.ts`），单元测试可不依赖数据库。

**NFR-TEST-02** **THE** 系统 **SHALL** 使 v2/v3 迁移函数可被单元测试重复调用并断言幂等性（连续两次 `migrate` 后 schema_migrations 中 v2/v3 各仅一条）。

**NFR-TEST-03** **THE** 系统 **SHALL** 使 OAuth 凭证未配置时各平台接口返回 501 可被 HTTP 请求直接断言，无需 mock 第三方。

**NFR-TEST-04** **THE** 系统 **SHALL** 使注册接口防枚举行为可被测试断言：「账号已存在」与「邮箱已存在」响应的 statusCode 与 message 完全相等。

**NFR-TEST-05** **THE** 系统 **SHALL** 使邮件验证 token 的生成、校验、激活、过期、单次有效逻辑可被单元测试覆盖（mock nodemailer 发送）。

**NFR-TEST-06** **THE** 系统 **SHALL** 使管理员权限守卫可被测试断言：非管理员访问 `/api/admin/*` 返回 403。

**NFR-TEST-07** **THE** 系统 **SHALL** 使进程内限流可被测试断言：连续超阈值请求返回 429。

---

## 5. 约束

| 编号 | 约束 | 来源 |
| --- | --- | --- |
| C-01 | **依赖最小化**：仅新增 `nodemailer` ^6 与 `arctic` ^3，其余复用现有依赖（better-sqlite3、Node crypto、Nuxt/Nitro、@nuxt/ui、TailwindCSS）。引入任何其他新依赖前必须经用户确认。 | 项目约束 |
| C-02 | **前后端不分离**：所有能力基于 Nuxt/Nitro 一体实现，不另起后端服务。 | 用户偏好 |
| C-03 | **零回归**：不破坏现有认证（管理员登录）、安装、数据库、内容浏览、会话守卫功能；登录接口仅新增 pending 检查。 | 项目约束 |
| C-04 | **迁移幂等**：v2/v3 迁移重复执行安全，schema_migrations 不产生重复记录。 | 项目约束 |
| C-05 | **TypeScript 优先**：复用 `shared/utils` 与 `shared/types`，前后端共享校验与类型。 | 项目约束 |
| C-06 | **注册页为游客页**：`/register` 已在 `GUEST_ONLY_PATHS` 中登记，已登录用户访问应被重定向。 | 现有机制 |
| C-07 | **代码风格**：服务端 TS 使用 Tab 缩进 + 双引号 + 无分号；错误用 `createError({ statusCode, message })`。 | 项目实测 |
| C-08 | **密码哈希复用**：注册接口必须复用 `server/utils/password.ts` 的 `hashPassword`，**禁止**引入其他哈希方案。 | 安全约束 |
| C-09 | **会话复用**：验证成功 / OAuth 登录后自动登录必须复用 `setSession`，**禁止**另造会话机制。 | 安全约束 |
| C-10 | **进程内限流**：注册限流零依赖、单实例生效，**不引入 Redis**。 | CONFIRM-06 |
| C-11 | **settings 表复用**：SMTP / OAuth 配置存入已有 settings 表（v1 已建），**不新建专用配置表**。 | 现有实现 |
| C-12 | **管理员免验证**：安装向导创建的管理员 status=active，无需邮件验证。 | CONFIRM-04 |
| C-13 | **OAuth 用户免验证**：OAuth 创建的用户 status=active，无需邮件验证。 | 任务目标 |
| C-14 | **install 可选配置**：SMTP / OAuth 在 install 向导均可跳过，向后兼容。 | 任务目标 |

---

## 6. 依赖清单

### 6.1 现有依赖（复用，不改动）

| 依赖 | 用途 |
| --- | --- |
| `nuxt` ^4.6.1 / `nitro` | 一体部署框架 |
| `better-sqlite3` ^12.11.1 | SQLite 数据库驱动 |
| `@nuxt/ui` + TailwindCSS | UI 组件与样式 |
| Node 内置 `crypto` | HMAC 签名、随机 token、AES 加密 |

### 6.2 新增依赖（已确认）

| 依赖 | 版本 | 用途 | 引入理由 |
| --- | --- | --- | --- |
| `nodemailer` | ^6 | 邮件发送 | 邮件验证流程必需。`nodemailer` 是 Node 生态最通用邮件库，零编译依赖，支持 SMTP/SMTPS/STARTTLS，配置简单。替代方案（手写 SMTP / 第三方 SaaS HTTP API）维护成本高或需外部账号配额。**用户已确认引入（CONFIRM-04 = B）**。 |
| `arctic` | ^3 | OAuth 接入 | GitHub / QQ / 微信 三平台 OAuth 接入。`arctic` 是 Nuxt 官方推荐的 OAuth 客户端库，支持标准 OAuth2 流程与 state 防 CSRF，API 简洁。替代方案（手写 OAuth / `lucia-auth`）工作量大或引入额外抽象层。**用户已确认引入（CONFIRM-05 = B）**。 |

> **⚠️ arctic 对微信/QQ 支持风险**：`arctic` 主要面向标准 OAuth2 提供商。微信使用自定义协议变体，QQ 也有部分非标准实现。需在 design 阶段验证 `arctic` ^3 是否原生支持，若不支持需自定义 provider 或对微信手写流程。详见第 11 节。

---

## 7. 数据约束（领域对象）

> 本节定义核心领域对象的逻辑约束，不含数据库实现细节（类型、索引）。

### 7.1 注册请求体（RegisterPayload）

1. **account**：必填，非空字符串（`!isBlank(account)`），全局唯一。
2. **email**：必填，合法邮箱格式（`isValidEmail(email) === true`），全局唯一。
3. **password**：必填，强密码（`isStrongPassword(password) === true`）。
4. **confirmPassword**：必填，须与 `password` 完全相等（前端校验）。
5. **name**：可选，为空时默认取 `account` 值。

### 7.2 注册成功响应体

1. **user.account**：等于请求体 `account`。
2. **user.name**：等于最终入库的 `name`（用户提供或默认 account）。

### 7.3 用户领域对象（User，扩展后）

1. **id**：主键，自增。
2. **account**：非空，全局唯一。
3. **password_hash**：非空（OAuth 用户为占位值）；scrypt 哈希。
4. **name**：非空。
5. **email**：非空（v2 后 NOT NULL），全局唯一，合法邮箱格式或占位邮箱（`*@local.invalid` / `*@oauth.local.invalid`）。
6. **role**：`admin`（当前仅此一种，预留扩展）。
7. **status**：`pending`（待验证）/ `active`（已激活）；注册用户初始 pending，验证后 active；管理员与 OAuth 用户初始 active。
8. **email_verified_at**：可空；激活时写入当前时间；管理员与 OAuth 用户创建时即写入。
9. **oauth_provider**：可空；`github` / `qq` / `wechat`；非空时 oauth_subject 必须非空。
10. **oauth_subject**：可空；第三方平台用户 id。
11. **(oauth_provider, oauth_subject)**：联合唯一（当两者均非空时）。
12. **created_at / updated_at / last_login_at**：时间戳，沿用现有语义。

### 7.4 邮件验证 token（EmailVerificationToken）

1. **id**：主键，自增。
2. **user_id**：非空，关联 users.id。
3. **token**：非空，全局唯一，高熵随机（≥32 字节 base64url）。
4. **expires_at**：非空，创建时间 + 24 小时。
5. **used_at**：可空；激活时写入当前时间；非空表示已使用。
6. **created_at**：创建时间。

### 7.5 SMTP 配置（SmtpConfig，存 settings 表）

1. **preset**：`gmail` / `qq` / `163` / `custom`。
2. **host**：非空，SMTP 服务器地址。
3. **port**：非空，端口号（通常 587）。
4. **user**：可空（部分 SMTP 允许匿名）。
5. **pass**：可空；非空时加密存储；读取时脱敏返回。
6. **from**：非空，发件人地址。

### 7.6 OAuth 凭证（OAuthCredentials，存 settings 表）

1. **github.client_id / github.client_secret**：可空；secret 加密存储。
2. **qq.app_id / qq.app_key**：可空；app_key 加密存储。
3. **wechat.app_id / app_secret**：可空；app_secret 加密存储。
4. 各平台凭证独立可选，未配置则对应接口返回 501。

### 7.7 管理员 settings 读写响应体

1. **smtp**：SMTP 配置，pass 字段脱敏（掩码）。
2. **oauth**：三平台凭证，secret/key 字段脱敏。

---

## 8. 建议的数据库迁移方案（v2 / v3）

> 本节为**建议**，供 design 阶段参考与用户确认。需求文档原则上不包含实现细节，但用户明确要求提供迁移 SQL 建议。

### 8.1 v2 迁移目标

将 `users.email` 由 `TEXT`（可空、无唯一约束）改为 `TEXT NOT NULL UNIQUE`，新增 `email_verified_at`、`oauth_provider`、`oauth_subject` 字段，妥善处理存量 `email IS NULL` 记录。

### 8.2 v2 存量数据处理

```sql
-- 为 email 为 NULL 的存量记录填充占位邮箱（基于 account 保证唯一性）
UPDATE users
SET email = account || '__legacy@local.invalid'
WHERE email IS NULL;
```

> 说明：`account` 本身具有 UNIQUE 约束，故 `account || '__legacy@local.invalid'` 天然唯一；`.invalid` 为 RFC 6761 保留 TLD，不会与真实邮箱冲突；`__legacy` 后缀便于后续识别并引导用户补填真实邮箱。

### 8.3 v2 SQLite 表重建迁移 SQL（建议）

SQLite 不支持直接 `ALTER COLUMN` 改 NOT NULL/UNIQUE，采用「新建临时表 → 复制数据 → 删旧表 → 重命名」标准模式：

```sql
-- 1. 新建符合 v2 约束的临时表
CREATE TABLE users_v2 (
	id                INTEGER PRIMARY KEY AUTOINCREMENT,
	account           TEXT    NOT NULL UNIQUE,
	password_hash     TEXT    NOT NULL,
	name              TEXT    NOT NULL,
	email             TEXT    NOT NULL UNIQUE,
	role              TEXT    NOT NULL DEFAULT 'admin',
	status            TEXT    NOT NULL DEFAULT 'active',
	email_verified_at TEXT,
	oauth_provider    TEXT,
	oauth_subject     TEXT,
	created_at        TEXT    NOT NULL DEFAULT (datetime('now')),
	updated_at        TEXT    NOT NULL DEFAULT (datetime('now')),
	last_login_at     TEXT
);

-- 2. 复制存量数据（此时 email 已无 NULL，见 8.2；存量记录无 oauth 字段，置 NULL）
INSERT INTO users_v2 (id, account, password_hash, name, email, role, status, created_at, updated_at, last_login_at)
SELECT id, account, password_hash, name, email, role, status, created_at, updated_at, last_login_at
FROM users;

-- 3. 删除旧表并重命名
DROP TABLE users;
ALTER TABLE users_v2 RENAME TO users;
```

### 8.4 v2 迁移注册方式

在 `server/utils/schema.ts` 的 `MIGRATIONS` 数组追加 v2 项：

```ts
{
	version: 2,
	name: "users_rebuild_with_email_oauth_fields",
	sql: `
		UPDATE users SET email = account || '__legacy@local.invalid' WHERE email IS NULL;
		CREATE TABLE users_v2 ( /* 同 8.3 */ );
		INSERT INTO users_v2 (...) SELECT ... FROM users;
		DROP TABLE users;
		ALTER TABLE users_v2 RENAME TO users;
	`,
}
```

> **幂等性保证**：v2 整体包裹在 `db.transaction()` 中（现有 `migrate()` 已如此处理），且 `schema_migrations` 记录 version=2 后不再重复执行。建议在事务内加 `SELECT COUNT(*) FROM users WHERE email IS NULL` 断言为 0 后再建表，双重保险。

### 8.5 v3 迁移目标

新增 `email_verification_tokens` 表。

> **说明**：`settings` 表在 v1 已创建，**v3 不涉及 settings 表**。

### 8.6 v3 迁移 SQL（建议）

```sql
CREATE TABLE IF NOT EXISTS email_verification_tokens (
	id         INTEGER PRIMARY KEY AUTOINCREMENT,
	user_id    INTEGER NOT NULL,
	token      TEXT    NOT NULL UNIQUE,
	expires_at TEXT    NOT NULL,
	used_at    TEXT,
	created_at TEXT    NOT NULL DEFAULT (datetime('now')),
	FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_email_ver_tokens_token ON email_verification_tokens(token);
CREATE INDEX IF NOT EXISTS idx_email_ver_tokens_user ON email_verification_tokens(user_id);
```

### 8.7 v3 迁移注册方式

```ts
{
	version: 3,
	name: "create_email_verification_tokens",
	sql: `
		CREATE TABLE IF NOT EXISTS email_verification_tokens ( /* 同 8.6 */ );
		CREATE INDEX IF NOT EXISTS idx_email_ver_tokens_token ON email_verification_tokens(token);
		CREATE INDEX IF NOT EXISTS idx_email_ver_tokens_user ON email_verification_tokens(user_id);
	`,
}
```

### 8.8 风险与回滚

- **风险 1**：若存量 `account` 含特殊字符导致占位邮箱格式异常，需在迁移前校验。建议占位邮箱用 `account` 的安全编码（如正则替换非字母数字为下划线）。
- **风险 2**：v2 表重建后，若 users 表上存在其他依赖（如外键、触发器、视图），需在重建后重新创建。当前 schema 仅有 users 与 settings 两表，无外键依赖，风险低。
- **回滚**：v2/v3 迁移不支持自动回滚（SQLite 表重建后旧表已 DROP）。建议迁移前备份 `data/` 目录下 SQLite 文件。回滚方式为恢复备份文件并删除 `schema_migrations` 中 version=2/3 记录。

---

## 9. 验收标准

### 9.1 邮箱 + 账号注册

| 编号 | 验收条件 | 关联需求 |
| --- | --- | --- |
| AC-REG-01 | 访客访问 `/register`，页面渲染账号、邮箱、密码、确认密码、可选昵称输入项与注册按钮，风格与 `/login` 一致。 | FR-REG-01 |
| AC-REG-02 | 已登录用户访问 `/register`，被重定向至首页，URL 不残留 `/register`。 | FR-REG-01 |
| AC-REG-03 | 提交合法账号+邮箱+密码，返回 200 与 `{ user: { account, name } }`，users 表新增一条 status=pending 记录，email 非空且唯一，password_hash 以 `scrypt$` 开头。 | FR-REG-02, FR-REG-03 |
| AC-REG-04 | 提交缺失字段，返回 400 与「账号、邮箱和密码不能为空」。 | FR-REG-02 |
| AC-REG-05 | 提交非法邮箱格式，返回 400 与「邮箱格式不正确」。 | FR-REG-02 |
| AC-REG-06 | 提交弱密码，返回 400 与「密码至少 8 位，需同时包含字母和数字」。 | FR-REG-02 |
| AC-REG-07 | 两次密码不一致，前端拦截并提示「两次输入的密码不一致」，不发请求。 | FR-REG-02 |
| AC-REG-08 | 提交已存在账号，返回 409 与统一提示。提交已存在邮箱，返回 409 与**同一**统一提示（statusCode 与 message 完全相等）。 | FR-REG-03, NFR-SEC-02 |
| AC-REG-09 | 注册成功后，前端显示「验证邮件已发送」提示并跳转 `/login`，浏览器**不**持有 `fsp_session` cookie（未自动登录）。 | FR-REG-04 |
| AC-REG-10 | 同一 IP 60 秒内连续注册超过 5 次，第 6 次返回 429 与「注册请求过于频繁，请稍后再试」。 | FR-REG-05 |
| AC-REG-11 | 注册页「已有账号？登录」链接跳转 `/login`；登录页「注册」链接跳转 `/register`。 | FR-REG-06 |

### 9.2 邮件验证

| 编号 | 验收条件 | 关联需求 |
| --- | --- | --- |
| AC-VERIFY-01 | 注册成功后，`email_verification_tokens` 表新增一条记录，token 为 ≥32 字节 base64url，expires_at 为当前时间 +24 小时，used_at 为 NULL。 | FR-VERIFY-01 |
| AC-VERIFY-02 | SMTP 已配置时，注册用户邮箱收到验证邮件，含验证链接 `{baseUrl}/api/auth/verify-email?token={token}`。 | FR-VERIFY-02 |
| AC-VERIFY-03 | SMTP 未配置时，注册仍成功，用户创建为 pending，不发送邮件，日志记录警告，前端提示「验证邮件暂未发送」。 | FR-VERIFY-02 |
| AC-VERIFY-04 | 点击有效验证链接，用户 status 变为 active，email_verified_at 写入当前时间，token used_at 写入当前时间，浏览器持有会话 cookie，跳转首页。 | FR-VERIFY-03 |
| AC-VERIFY-05 | 点击已使用 token，提示「验证链接无效或已过期」。点击过期 token（>24h），提示「验证链接无效或已过期」。点击不存在 token，提示「验证链接无效或已过期」。 | FR-VERIFY-03 |
| AC-VERIFY-06 | 未验证用户（pending）用正确密码登录，返回 403 与「账号尚未验证邮箱，请查收验证邮件或联系管理员」。 | FR-VERIFY-04 |
| AC-VERIFY-07 | 未验证用户用错误密码登录，返回 401 与「账号或密码错误」（不泄露 pending 状态，防枚举）。 | FR-VERIFY-04 |
| AC-VERIFY-08 | 验证后的用户用正确密码登录，返回 200 与会话。 | FR-VERIFY-04 |
| AC-VERIFY-09 | 安装向导创建的管理员 status=active，email_verified_at 非空，可立即登录，无验证邮件发送。 | FR-VERIFY-06 |

### 9.3 SMTP 配置

| 编号 | 验收条件 | 关联需求 |
| --- | --- | --- |
| AC-SMTP-01 | SMTP 配置保存后，settings 表存在 `smtp.host`、`smtp.port`、`smtp.user`、`smtp.pass`、`smtp.from`、`smtp.preset` 键。 | FR-SMTP-01 |
| AC-SMTP-02 | settings 表中 `smtp.pass` 为加密密文，**非**明文。 | FR-SMTP-05, NFR-SEC-07 |
| AC-SMTP-03 | 选择 Gmail 预设，host 自动填 `smtp.gmail.com`，port 填 587。QQ/163 同理。 | FR-SMTP-02 |
| AC-SMTP-04 | install 向导可跳过 SMTP 配置，跳过后 settings 表无 SMTP 键，安装成功。 | FR-SMTP-03 |
| AC-SMTP-05 | 管理员后台修改 SMTP 配置，`PUT /api/admin/settings` 返回成功，settings 表更新，密码字段脱敏返回。 | FR-SMTP-04 |
| AC-SMTP-06 | 非管理员调用 `PUT /api/admin/settings`，返回 403。 | FR-ADMIN-05, NFR-SEC-08 |

### 9.4 真实 OAuth 接入

| 编号 | 验收条件 | 关联需求 |
| --- | --- | --- |
| AC-OAUTH-01 | GitHub 凭证已配置，访问 `GET /api/auth/github`，返回 302 重定向至 GitHub 授权页（含 state 参数）。 | FR-OAUTH-01 |
| AC-OAUTH-02 | GitHub 凭证未配置，访问 `GET /api/auth/github`，返回 501 与「GitHub 登录尚未配置」。QQ/微信同理。 | FR-OAUTH-02 |
| AC-OAUTH-03 | GitHub 回调 `GET /api/auth/github/callback?code=&state=`，state 校验通过，交换 token 成功，拉取资料，首次登录创建用户（oauth_provider=github, status=active），建立会话，跳转首页。 | FR-OAUTH-03, FR-OAUTH-04 |
| AC-OAUTH-04 | 同一 GitHub 账号二次登录，不创建新用户，复用已有 (github, subject) 记录，更新 last_login_at。 | FR-OAUTH-04 |
| AC-OAUTH-05 | OAuth state 校验失败，跳转登录页带错误参数，提示「GitHub 登录失败，请重试」。 | FR-OAUTH-03, NFR-SEC-06 |
| AC-OAUTH-06 | OAuth 创建的用户 email 为占位邮箱（`github_{subject}@oauth.local.invalid`）当平台未返回 email 时。 | FR-OAUTH-04 |
| AC-OAUTH-07 | OAuth Client Secret 在 settings 表加密存储。 | FR-OAUTH-05, NFR-SEC-07 |
| AC-OAUTH-08 | 前端点击 GitHub 按钮，浏览器跳转至 `/api/auth/github`；若返回 501，前端提示「GitHub 登录尚未配置」。 | FR-OAUTH-06 |

### 9.5 install 向导扩展

| 编号 | 验收条件 | 关联需求 |
| --- | --- | --- |
| AC-INSTALL-01 | install 向导在数据库+管理员+站点步骤后，呈现可选的 SMTP 与 OAuth 配置步骤，均可跳过。 | FR-INSTALL-01 |
| AC-INSTALL-02 | 提交含 `{ database, admin, site, smtp, oauth }` 的完整安装请求，安装成功，settings 表写入 SMTP 与 OAuth 配置。 | FR-INSTALL-02 |
| AC-INSTALL-03 | 提交仅含 `{ database, admin, site }` 的请求（无 smtp/oauth），安装成功，settings 表无 SMTP/OAuth 键。 | FR-INSTALL-03 |
| AC-INSTALL-04 | 现有 `GET /api/install/status` 响应契约不变。 | FR-INSTALL-03 |

### 9.6 管理员后台

| 编号 | 验收条件 | 关联需求 |
| --- | --- | --- |
| AC-ADMIN-01 | 未登录用户访问 `/admin`，被重定向至首页或登录页。 | FR-ADMIN-01 |
| AC-ADMIN-02 | 已登录非管理员用户访问 `/admin`，被拒绝（403 或重定向）。 | FR-ADMIN-01 |
| AC-ADMIN-03 | 管理员访问 `/admin`，渲染概览页，展示 SMTP/OAuth 配置状态与用户总数。 | FR-ADMIN-02 |
| AC-ADMIN-04 | 管理员访问 `/admin/smtp`，渲染 SMTP 配置表单，密码字段掩码显示。 | FR-ADMIN-03 |
| AC-ADMIN-05 | 管理员访问 `/admin/oauth`，渲染三平台凭证配置表单，敏感字段掩码显示。 | FR-ADMIN-04 |
| AC-ADMIN-06 | 管理员调用 `GET /api/admin/settings`，返回 SMTP+OAuth 配置，敏感字段脱敏。 | FR-ADMIN-05 |
| AC-ADMIN-07 | 管理员调用 `PUT /api/admin/settings` 提交配置（敏感字段为掩码占位），原敏感值保留不变，非敏感字段更新。 | FR-ADMIN-05 |
| AC-ADMIN-08 | 管理员调用 `POST /api/admin/test-smtp` 提交 `{ to }`，SMTP 已配置时发送测试邮件，返回 200；SMTP 未配置返回 400。 | FR-ADMIN-06 |
| AC-ADMIN-09 | 非管理员调用 `/api/admin/*` 任一接口，返回 403。 | FR-ADMIN-05, NFR-SEC-08 |

### 9.7 数据库迁移

| 编号 | 验收条件 | 关联需求 |
| --- | --- | --- |
| AC-MIG-01 | 在已存在 v1 数据库上启动应用，`migrate()` 自动执行 v2/v3，`users.email` 变为 NOT NULL UNIQUE，新增 email_verified_at/oauth_provider/oauth_subject 字段，email_verification_tokens 表存在。 | FR-MIG-01, FR-MIG-02 |
| AC-MIG-02 | v2 迁移后，存量用户记录的 id/account/password_hash/name/role/status/created_at/updated_at/last_login_at 完全不变。 | NFR-COMPAT-01 |
| AC-MIG-03 | v2 迁移后，无任何 `email IS NULL` 记录；原 NULL 记录 email 为 `account__legacy@local.invalid` 形式。 | NFR-COMPAT-02 |
| AC-MIG-04 | 连续两次启动应用，`schema_migrations` 中 version=2/3 各仅一条记录，不报错。 | FR-MIG-03, NFR-MAINT-01 |
| AC-MIG-05 | 在全新空数据库上启动，v1/v2/v3 依次执行，最终结构与存量库一致。 | FR-MIG-03 |

### 9.8 回归

| 编号 | 验收条件 | 关联需求 |
| --- | --- | --- |
| AC-REG-RET-01 | 现有管理员账号登录、登出、会话保持、内容浏览功能行为不变。 | G7, NFR-COMPAT-03 |
| AC-REG-RET-02 | 现有 `POST /api/auth/logout`、`GET /api/auth/me` 响应契约不变。 | NFR-COMPAT-06 |
| AC-REG-RET-03 | 现有 install 向导（不含 SMTP/OAuth）流程可正常完成。 | NFR-COMPAT-04 |

---

## 10. 建议的文件清单（新建 / 修改 / 无需修改）

> 本节为**建议**，供 design 与 task 阶段参考。需求文档原则上不涉及实现文件，但用户明确要求提供详尽清单。

### 10.1 新建文件

| 文件路径 | 说明 |
| --- | --- |
| `app/pages/register.vue` | 注册页面，与 `login.vue` 风格一致，含账号/邮箱/密码/确认密码/可选昵称表单与三个第三方按钮。 |
| `app/pages/admin/index.vue` | 管理员后台概览页（SMTP/OAuth 状态、用户总数）。 |
| `app/pages/admin/smtp.vue` | SMTP 配置页（预设选择 + 字段表单 + 保存 + 测试发送）。 |
| `app/pages/admin/oauth.vue` | OAuth 凭证配置页（三平台独立表单）。 |
| `app/middleware/admin.global.ts` | 管理员权限守卫中间件，拦截 `/admin` 前缀路由，校验 role。 |
| `server/api/auth/register.post.ts` | 注册接口 `POST /api/auth/register`：校验 + 防枚举 + 限流 + 创建 pending 用户 + 生成 token + 发送邮件。 |
| `server/api/auth/verify-email.get.ts` | 邮件验证接口 `GET /api/auth/verify-email?token=`：校验 token + 激活用户 + 自动登录 + 跳转。 |
| `server/api/auth/github.get.ts` | GitHub OAuth 发起授权跳转（凭证未配置返回 501）。 |
| `server/api/auth/github/callback.get.ts` | GitHub OAuth 回调处理（state 校验 + token 交换 + 资料拉取 + 用户创建/匹配 + setSession）。 |
| `server/api/auth/qq.get.ts` | QQ OAuth 发起授权跳转。 |
| `server/api/auth/qq/callback.get.ts` | QQ OAuth 回调处理。 |
| `server/api/auth/wechat.get.ts` | 微信 OAuth 发起授权跳转。 |
| `server/api/auth/wechat/callback.get.ts` | 微信 OAuth 回调处理。 |
| `server/api/admin/settings.get.ts` | 管理员读取 SMTP + OAuth 配置（敏感字段脱敏）。 |
| `server/api/admin/settings.put.ts` | 管理员更新 SMTP + OAuth 配置（敏感字段加密，掩码占位保留原值）。 |
| `server/api/admin/test-smtp.post.ts` | 测试 SMTP 连接/发送测试邮件。 |
| `server/utils/email.ts` | `nodemailer` 封装：发送验证邮件、发送测试邮件、邮件模板（纯文本 + HTML）。 |
| `server/utils/oauth.ts` | `arctic` provider 配置封装：GitHub/QQ/微信 客户端初始化、authorize URL 生成、token 交换、资料拉取。 |
| `server/utils/rate-limit.ts` | 进程内限流封装：基于 IP 的滑动计数，60s/5 次，零依赖。 |
| `server/utils/encrypt.ts` 或扩展 `crypto.ts` | 对称加密（AES-256-GCM）封装：encrypt/decrypt，用于 SMTP 密码与 OAuth Secret 加密存储。 |
| `server/repositories/settings.repository.ts` | settings 表读写封装：getSetting/setSetting/getSmtpConfig/setSmtpConfig/getOAuthConfig/setOAuthConfig。 |
| `server/repositories/email-verification.repository.ts` | email_verification_tokens 表 CRUD：createToken/findToken/markUsed/findActiveTokenByUser。 |
| `shared/types/auth.ts` 或扩展 `shared/types/index.ts` | 新增类型：RegisterPayload、SmtpConfig、OAuthCredentials、AdminSettings 等。 |

### 10.2 修改文件

| 文件路径 | 修改内容 |
| --- | --- |
| `server/utils/schema.ts` | 在 `MIGRATIONS` 数组追加 v2（users 表重建）与 v3（email_verification_tokens 表）迁移项。 |
| `server/utils/crypto.ts` | 新增对称加密函数 `encrypt(plaintext)` / `decrypt(ciphertext)`（AES-256-GCM），用于 SMTP 密码与 OAuth Secret 加密。**⚠️ 当前仅有 HMAC 签名，无对称加密，需新增。** |
| `server/utils/installer.ts` | `runInstall` 扩展接收 `smtp?` / `oauth?`，安装时可选写入 settings 表；管理员创建时 status=active、email_verified_at 置当前时间。 |
| `server/api/install/setup.post.ts` | 扩展接收 `{ database, admin, site, smtp?, oauth? }`，校验并透传给 `runInstall`。 |
| `server/api/auth/login.post.ts` | 新增 status 检查：账号存在且密码正确且 status=pending 时返回 403「账号尚未验证邮箱」（方案 X，仅密码正确时区分）。 |
| `server/repositories/user.repository.ts` | 新增 `findUserByEmail(email)`、`findUserByOauth(provider, subject)`、`createOAuthUser(input)`、`activateUser(id)`、`setEmailVerifiedAt(id)`；`createUser` 的 email 参数由可选改为必填，新增 status 参数（默认 pending）。 |
| `app/pages/login.vue` | 「注册」链接由 `placeholder('注册')` 改为真实跳转 `/register`；三个第三方按钮改为真实跳转 `/api/auth/{platform}`（GitHub/QQ/微信），补齐 QQ 按钮（当前仅微信+GitHub）。 |
| `shared/types/install.ts` | `InstallPayload` 新增可选 `smtp?` / `oauth?` 字段；新增 `InstallSmtpInput`、`InstallOAuthInput` 类型。 |
| `shared/utils/validate-install.ts` | 扩展校验 SMTP 与 OAuth 配置字段（可选，存在时校验合法性）。 |
| `app/composables/useAuth.ts` | 可能新增 `register(payload)` 方法与 OAuth 跳转辅助（视设计而定）。 |
| `app/middleware/a.CheckUser.global.ts` | 可能需调整以兼容 `/admin` 路由的游客/登录态判断（视设计而定）。 |

### 10.3 无需修改（确认即可）

| 文件路径 | 说明 |
| --- | --- |
| `app/utils/auth.ts` | `GUEST_ONLY_PATHS` 已含 `/register`，`safeRedirect` 已就绪，无需修改。 |
| `server/utils/password.ts` | `hashPassword` / `verifyPassword` 直接复用。 |
| `server/utils/session.ts` | `setSession` / `readSession` / `clearUserSession` 直接复用。**注**：SessionUser 不含 role，管理员守卫需通过二次查询获取 role（见 FR-ADMIN-01 说明）。 |
| `server/utils/db.ts` | `getDb` / `closeDb` 直接复用。 |
| `server/utils/app-config.ts` | `readConfig` / `writeConfig` 直接复用；SMTP/OAuth 配置存数据库 settings 表而非 config.json，不改 AppConfig 结构。 |
| `server/utils/api-response.ts` | `ok` / `fail` / `ErrorCode` 直接复用。 |
| `server/api/auth/logout.post.ts` | 契约不变，无需修改。 |
| `server/api/auth/me.get.ts` | 契约不变，无需修改。 |
| `server/api/install/status.get.ts` | 契约不变，无需修改。 |
| `server/api/install/test-connection.post.ts` | 契约不变，无需修改。 |
| `server/middleware/log.ts` | 日志中间件不变。 |
| `server/middleware/install-guard.ts` | **无需修改**：未安装时 `/api/auth/*` 与 `/api/admin/*` 返回 503 合理（verify-email 未安装时 503 也合理）。CONFIRM-03 = A 保持不放行。 |
| `app/middleware/b.Install.global.ts` | 安装守卫不变。 |
| `shared/utils/validate.ts` | `isValidEmail` / `isStrongPassword` / `isBlank` 直接复用。 |
| `app/pages/index.vue` / `[...slug].vue` / `account.vue` / `test.vue` | 内容浏览页不变。 |

---

## 11. 假设与待确认事项汇总

| 编号 | 事项 | 已确认决策 | 影响 / 备注 |
| --- | --- | --- | --- |
| CONFIRM-01 | 注册成功后是否自动登录 | **方案 A**：注册成功**不**立即自动登录（因 pending），自动登录发生在邮件验证成功后 | 注册接口不调 setSession；验证接口调 setSession |
| CONFIRM-02 | 第三方按钮点击行为 | **方案 A**：点击 → 跳转 `/api/auth/{platform}` → 302 或 501 → 提示 | 前端按钮真实跳转 |
| CONFIRM-03 | 占位/未配置接口未安装时守卫策略 | **方案 A**：不放行，未安装时返回 503 | install-guard.ts 不改 |
| CONFIRM-04 | 邮件验证是否需要 | **方案 B**：实现邮件验证，引入 `nodemailer` ^6 | 新增依赖、新增表、改注册流程 |
| CONFIRM-05 | OAuth 真实接入 | **方案 B**：真实接入，引入 `arctic` ^3 | 新增依赖、新增字段、新增路由 |
| CONFIRM-06 | 注册限流阈值与策略 | **方案 A**：进程内 60s/5 次 → 429 | 零依赖，单实例生效 |
| 歧义1 | OAuth 凭证未配置行为 | **方案 A**：返回 501「{平台} 登录尚未配置」 | 区分于 503（未安装） |
| 歧义2 | 管理员后台 | **方案 A**：新建 `/admin` 路由 + 后台配置页 | 新增页面、中间件、接口 |
| 歧义3 | 交付范围 | **方案 B**：一次做完全部 7 个模块 | 本文档覆盖全部范围 |

### 11.1 潜在风险与需进一步确认的点

| 编号 | 风险 / 待确认点 | 建议处理 |
| --- | --- | --- |
| RISK-01 | **`crypto.ts` 无对称加密能力**：当前仅有 HMAC 签名（sign/verify/encodePayload/decodePayload），SMTP 密码与 OAuth Secret 加密存储需新增 AES-256-GCM 加解密函数。加密密钥来源需明确（复用 sessionSecret 或新增独立 encryptionKey）。 | design 阶段在 `crypto.ts` 或新建 `encrypt.ts` 实现 AES-256-GCM；密钥来源建议复用 `AppConfig.security.sessionSecret`（已存在且持久化），或新增 `security.encryptionKey` 字段在安装时生成。 |
| RISK-02 | **未验证用户登录的防枚举冲突**：login.post.ts 现有防枚举（账号不存在/密码错误/停用统一 401），pending 返回 403 会破坏防枚举。 | 本文档默认**方案 X**：仅当账号存在且密码正确时才返回 403，账号不存在或密码错误仍统一 401。攻击者需先知道正确密码才能探测验证状态，风险可控。若用户要求更强防枚举，可改方案 Z（403 文案模糊化）。**需用户确认方案 X 可接受。** |
| RISK-03 | **`arctic` ^3 对微信/QQ 的原生支持**：arctic 主要面向标准 OAuth2（GitHub/Google）。微信使用自定义协议（unionid、扫码、网页授权变体），QQ 有部分非标准实现。 | design 阶段需验证 arctic ^3 是否原生支持微信/QQ。若不支持，需基于 `OAuth2Client` 自定义 provider，或对微信手写流程（不引入新依赖，工作量增加）。**建议 design 阶段优先验证此项。** |
| RISK-04 | **SessionUser 不含 role**：当前 `SessionUser = { account, name }`，管理员守卫需获取 role。方案一扩展 SessionPayload 携带 role（改 session.ts，影响存量会话）；方案二后台中间件二次查询用户 role（不改 session，但每次后台请求多一次 DB 查询）。 | 建议方案二（最小改动）：新增 `/api/admin/me` 或在 admin 中间件内通过 account 查 users 表获取 role。存量会话 cookie 不受影响。**需 design 阶段确认。** |
| RISK-05 | **OAuth 用户 email 占位与 NOT NULL UNIQUE 冲突**：v2 要求 email NOT NULL UNIQUE，OAuth 用户若平台未返回 email 需占位（`{provider}_{subject}@oauth.local.invalid`）。需保证占位邮箱不与真实邮箱或注册用户邮箱冲突。 | 占位邮箱使用 `.local.invalid` 保留 TLD，与真实邮箱天然不冲突；`{provider}_{subject}` 前缀保证 OAuth 用户间唯一。风险低。 |
| RISK-06 | **邮件验证 token 泄露风险**：验证链接含 token，若邮件被转发或拦截，token 可被他人使用激活账号。 | token 单次有效（used_at）+ 24h 过期，激活后即失效。可接受。若需更强安全，可绑定注册时 IP 或要求激活后重新登录（不自动登录），但体验下降。**当前默认自动登录，可接受。** |
| RISK-07 | **SMTP 配置缺失时注册流程的体验**：SMTP 未配置时注册仍创建 pending 用户但不发邮件，用户无法激活，需联系管理员。 | 已在 FR-VERIFY-02 明确：前端提示「验证邮件暂未发送，请联系管理员」。管理员可在后台手动激活（**注：手动激活接口不在本次范围，留后续**）。**建议后续迭代补「管理员手动激活用户」接口。** |
| RISK-08 | **install 向导步骤数增加的 UX**：新增 SMTP + OAuth 可选步骤，向导变长。 | 均为可选可跳过，可合并为一个「可选配置」步骤。design 阶段决定分步或合并。 |
| RISK-09 | **better-sqlite3 外键约束**：v3 email_verification_tokens 表含 `FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE`，需确认 db 连接开启 `foreign_keys = ON`（installer.ts 已开启，运行时 db.ts 需确认）。 | design 阶段确认 `db.ts` 的连接 pragma 包含 `foreign_keys = ON`。 |

---

*文档结束。请评审上述需求规格，确认或提出修改意见后，将转入 design 阶段生成技术设计文档。*
