# FSP — Nuxt 4 内容管理系统

基于 **Nuxt 4** 的内容驱动型 Web 项目，使用 `@nuxt/content` 管理 Markdown 内容，集成 `@nuxt/ui` 组件库与 TipTap 富文本编辑器，配套 Vitest + Playwright 双层测试体系。

> 本 README 为项目快速入口。**完整开发指南见 [docs/TDD-Nuxt-Dev-Guide-202610181252.md](./docs/TDD-Nuxt-Dev-Guide-202610181252.md)**。

---

## 如何部署 -> 开发

### 安装依赖

终端运行：

```
npm install
```

### 运行以验证

终端运行：

```
npm run dev
```

启动后访问 `http://localhost:3000`。

> 完整环境要求与多包管理器（pnpm/yarn/bun）用法见 [开发文档 §3 环境准备](./docs/TDD-Nuxt-Dev-Guide-202610181252.md#3-环境准备)。

---

## 首次部署（install 向导）

项目**首次部署**到服务器后，需在浏览器内完成初始化：

1. 启动服务：

```
npm run build
node .output/server/index.mjs
```

2. 访问服务器地址（任意页面），会自动引导至 `/install`
3. 在 `/install` 填写：
   - **数据库配置**：SQLite 数据文件路径（默认 `data/fsp.db`），可点「测试连接」验证
   - **管理员账号**：账号、密码（≥8 位且含字母和数字）、昵称、邮箱
   - **站点信息**：站点名称、站点地址（用于邮件验证链接与 OAuth 回调）
   - **SMTP 邮件配置（可选）**：预设 Gmail/QQ/163 或自定义，配置后注册用户可收到验证邮件
   - **OAuth 第三方登录（可选）**：GitHub/QQ/微信凭证，可跳过后续在管理后台配置
4. 点击「开始安装」，系统依次执行：测试连接 → 建表 → 创建管理员 → 写入配置 → 可选保存 SMTP/OAuth → 标记已安装
5. 配置持久化在 `data/config.json`（已被 gitignore），重启后生效；已安装后 `/install` 不可再访问

> 部署形态为 **Nitro 一体（前后端不分离）**，页面与接口同进程。无需手工建库，SQLite 文件在安装时自动生成。
> 可选环境变量见 [.env.example](./.env.example)（`FSP_DATA_DIR` 数据目录、`FSP_SESSION_SECRET` 会话密钥）。

---

## 功能概览

| 功能 | 说明 |
|---|---|
| **账号密码登录** | 管理员与注册用户均可通过 `/login` 登录，支持「记住我」7 天会话 |
| **邮箱注册** | 访客通过 `/register` 自助注册，注册后需邮件验证激活（status: pending → active） |
| **邮件验证** | 注册后发送验证邮件（需配置 SMTP），点击链接激活账号并自动登录；SMTP 未配置时提示联系管理员 |
| **第三方登录** | GitHub / QQ / 微信 OAuth 登录（需在管理后台配置凭证）；凭证未配置时返回 501 |
| **管理后台** | `/admin` 路由（仅管理员），可配置 SMTP 邮件与 OAuth 凭证、测试邮件发送 |
| **安装向导** | `/install` 首次部署向导，支持数据库/管理员/站点/SMTP/OAuth 一步配置 |
| **内容管理** | 基于 `@nuxt/content` 的 Markdown 内容驱动（待后续迭代） |

> 安全特性：scrypt 密码哈希、HMAC-SHA256 签名会话、AES-256-GCM 加密敏感配置、防账号枚举（统一 409）、注册限流（60s/5 次）。

---

## 技术栈

| 分类 | 技术 | 版本 |
|---|---|---|
| 框架 | [Nuxt](https://nuxt.com) | ^4.6.1 |
| 视图 | [Vue](https://vuejs.org) | ^3.5.43 |
| 内容 | [@nuxt/content](https://content.nuxt.com) | ^3.16.1 |
| UI | [@nuxt/ui](https://ui.nuxt.com) | ^4.12.0 |
| 样式 | [TailwindCSS](https://tailwindcss.com) | ^4.3.3 |
| 富文本 | [TipTap](https://tiptap.dev) | ^3.32.0 |
| 单元测试 | [Vitest](https://vitest.dev) | ^5.0.5 |
| E2E 测试 | [Playwright](https://playwright.dev) | ^1.64.1 |
| 语言 | TypeScript | ^6.0.3 |

完整依赖见 [package.json](./package.json)。

---

## 项目结构

```
fsp/
├── app/                    # 应用源码（Nuxt 4 目录结构）
│   ├── app.vue             #   根组件
│   ├── error.vue           #   错误页（401/403/404/500）
│   ├── app.config.ts       #   应用配置（UI 主题色）
│   ├── assets/css/         #   全局样式入口
│   ├── components/         #   自动导入组件
│   ├── composables/        #   useAuth / useToggle / useInstall
│   ├── layouts/            #   布局（default.vue）
│   ├── middleware/         #   登录守卫 + 安装守卫
│   ├── pages/              #   index / login / account / test / install / [...slug]
│   ├── plugins/            #   插件（01.init.ts）
│   ├── types/              #   PageMeta 类型扩展
│   └── utils/              #   工具函数（auth / format）
├── server/                 # 服务端代码（Nitro）
│   ├── api/                #   auth/*、install/*、health
│   ├── middleware/         #   请求日志、安装守卫
│   ├── repositories/       #   数据访问层（user.repository）
│   └── utils/              #   db / schema / password / crypto / session / installer / app-config
├── shared/                 # 前后端共享代码
│   ├── types/              #   index / install
│   └── utils/              #   validate / validate-install
├── data/                   # 运行时数据（config.json + sqlite，gitignore）
├── content/                # Markdown 内容源（当前为空，待填充）
├── public/                 # 静态资源
├── test/                   # 单元测试与 Nuxt 环境测试
├── tests/                  # E2E 测试（Playwright）
├── docs/                   # 项目文档
├── nuxt.config.ts          # Nuxt 配置
├── content.config.ts       # 内容集合配置
├── .env.example            # 环境变量示例
└── package.json
```

> 完整 Nuxt 4 标准目录结构说明见 [开发文档 §2.4](./docs/TDD-Nuxt-Dev-Guide-202610181252.md#24-目录结构nuxt-4)。

---

## 生产构建

```
npm run build       # 生产构建（SSR）
npm run generate    # 静态站点生成（推荐内容站点）
npm run preview     # 本地预览生产构建
```

部署详情见 [开发文档 §12 构建与部署](./docs/TDD-Nuxt-Dev-Guide-202610181252.md#12-构建与部署)。

---

## 测试

本项目采用三层测试体系：

| 类型 | 命令 | 目录 |
|---|---|---|
| 全部测试 | `npm test` | — |
| 单元测试 | `npm run test:unit` | `test/unit/` |
| Nuxt 环境测试 | `npm run test:nuxt` | `test/nuxt/` |
| E2E 测试 | `npm run test:e2e` | `tests/` |
| E2E UI 面板 | `npm run test:e2e:ui` | `tests/` |

测试体系详解见 [开发文档 §11 测试体系](./docs/TDD-Nuxt-Dev-Guide-202610181252.md#11-测试体系)。

---

## 内容管理

在 `content/` 目录下创建 Markdown 文件即可自动生成页面（路径即 URL）：

- `content/hello.md` → `/hello`
- `content/about.md` → `/about`

支持 MDC 语法，可在 Markdown 中嵌入 `app/components/` 下的 Vue 组件：

```
::my-component{title="示例"}
组件内容
::
```

> 注：Nuxt Starter 自带的示例内容（`content/index.md`、`about.md`）与示例组件（Alert / Counter）已移除，`content/` 目录当前为空。

内容管理详解见 [开发文档 §7 内容管理](./docs/TDD-Nuxt-Dev-Guide-202610181252.md#7-内容管理nuxtcontent)。

---

## 文档索引

| 文档 | 说明 | 路径 |
|---|---|---|
| 开发指南 | Nuxt 框架完整开发文档（架构/配置/路由/组件/内容/测试/部署/FAQ） | [docs/TDD-Nuxt-Dev-Guide-202610181252.md](./docs/TDD-Nuxt-Dev-Guide-202610181252.md) |
| Nuxt 官方文档 | 框架使用指南 | https://nuxt.com/docs |
| Nuxt Content | 内容模块文档 | https://content.nuxt.com |
| Nuxt UI | UI 组件库文档 | https://ui.nuxt.com |

**开发文档章节速查：**

- [§2 技术架构](./docs/TDD-Nuxt-Dev-Guide-202610181252.md#2-技术架构) — 技术栈/模块体系/目录结构
- [§4 核心配置](./docs/TDD-Nuxt-Dev-Guide-202610181252.md#4-核心配置详解) — nuxt.config / content.config / tsconfig / eslint
- [§5 路由与页面](./docs/TDD-Nuxt-Dev-Guide-202610181252.md#5-路由与页面) — 文件路由 / catch-all / 导航
- [§6 组件开发](./docs/TDD-Nuxt-Dev-Guide-202610181252.md#6-组件开发) — 自动导入 / 通信规范
- [§7 内容管理](./docs/TDD-Nuxt-Dev-Guide-202610181252.md#7-内容管理nuxtcontent) — 查询 API / MDC / ContentRenderer
- [§8 UI 组件库](./docs/TDD-Nuxt-Dev-Guide-202610181252.md#8-ui-组件库nuxtui) — @nuxt/ui 使用
- [§11 测试体系](./docs/TDD-Nuxt-Dev-Guide-202610181252.md#11-测试体系) — Vitest / Playwright
- [§12 构建与部署](./docs/TDD-Nuxt-Dev-Guide-202610181252.md#12-构建与部署) — 构建/部署目标
- [§15 常见问题](./docs/TDD-Nuxt-Dev-Guide-202610181252.md#15-常见问题faq) — FAQ 排查指南

---

## 许可证

私有项目（`"private": true`）。
