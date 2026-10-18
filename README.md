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
├── app/                # 应用源码（Nuxt 4 目录结构）
│   ├── app.vue         #   根组件
│   ├── components/     #   自动导入组件（Alert / Counter）
│   └── pages/          #   文件路由（[...slug].vue catch-all）
├── content/            # Markdown 内容源
├── public/             # 静态资源
├── server/             # 服务端代码（API/中间件）
├── test/               # 单元测试与 Nuxt 环境测试
├── tests/              # E2E 测试（Playwright）
├── docs/               # 项目文档
├── nuxt.config.ts      # Nuxt 配置
├── content.config.ts   # 内容集合配置
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

在 `content/` 目录下创建 Markdown 文件即可自动生成页面：

- `content/index.md` → `/`
- `content/about.md` → `/about`

支持 MDC 语法，可在 Markdown 中嵌入 Vue 组件：

```
::alert{color="green"}
这是 Alert 组件
::

::counter
::
```

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
