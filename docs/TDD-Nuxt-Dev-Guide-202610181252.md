---
name: Nuxt 框架开发文档
description: FSP 项目 Nuxt 4 框架开发指南，涵盖架构、配置、路由、组件、内容管理、测试与部署
type: TDD
---

# Nuxt 框架开发文档 — FSP 项目

| 项 | 值 |
|---|---|
| 文档类型 | TDD（技术设计/开发指南） |
| 项目名称 | FSP |
| 框架版本 | Nuxt 4.6.1 / Vue 3.5.43 |
| 文档日期 | 2026-10-18 |
| 适用读者 | 前端开发工程师、内容开发者、测试工程师 |

---

## 1. 文档概述

### 1.1 文档目的

本文档为 FSP 项目的 Nuxt 框架开发指南，旨在为开发团队提供以下支持：

- 统一开发环境与工具链认知
- 明确项目架构与目录约定
- 规范页面、组件、内容的开发流程
- 提供测试、构建、部署的标准操作方式
- 沉淀常见问题与排查思路

**文档关系：** 本文档为详细开发指南；项目根目录 [`README.md`](../README.md) 为快速入口，含技术栈速览、快速开始与本文档的章节索引。两份文档互为补充，日常速查用 README，深入开发参考本文档。

### 1.2 项目背景

FSP 是一个基于 **Nuxt 4** 的内容驱动型 Web 项目，使用 `@nuxt/content` 管理 Markdown 内容，集成 `@nuxt/ui` 组件库与 TipTap 富文本编辑器，并配套 Vitest + Playwright 双层测试体系。项目定位为竞赛作品（见 `.gitignore` 中关于"比赛项目"的注释），需上传至码道云平台。

### 1.3 核心特性一览

- 基于 Nuxt 4 的应用目录结构（`app/` 目录）
- Markdown 内容管理（`@nuxt/content` v3）
- MDC 语法支持（在 Markdown 中嵌入 Vue 组件）
- UI 组件库（`@nuxt/ui` v4）+ TailwindCSS v4
- 富文本编辑器（TipTap v3，含协同、提及、图片等扩展）
- 无障碍支持（`@nuxt/a11y`）
- 图片优化（`@nuxt/image`）
- 三层测试体系（单元 / Nuxt 环境 / E2E）
- 全 TypeScript 开发

---

## 2. 技术架构

### 2.1 技术栈

| 分类 | 技术 | 版本 | 用途 |
|---|---|---|---|
| 框架 | nuxt | ^4.6.1 | 全栈 Vue 框架 |
| 视图 | vue | ^3.5.43 | 视图层 |
| 路由 | vue-router | ^5.3.1 | 客户端路由 |
| 语言 | typescript | ^6.0.3 | 类型系统 |
| 样式 | tailwindcss | ^4.3.3 | 原子化 CSS |
| 内容 | @nuxt/content | ^3.16.1 | Markdown 内容管理 |
| UI | @nuxt/ui | ^4.12.0 | UI 组件库 |
| 图片 | @nuxt/image | ^2.1.0 | 图片优化 |
| 无障碍 | @nuxt/a11y | ^1.0.0-alpha.1 | 可访问性 |
| 规范 | @nuxt/eslint | ^1.17.0 | ESLint 集成 |
| 提示 | @nuxt/hints | ^1.1.5 | 开发提示 |
| 测试工具 | @nuxt/test-utils | ^4.3.4 | Nuxt 测试辅助 |
| 单元测试 | vitest | ^5.0.5 | 单元/组件测试 |
| E2E 测试 | @playwright/test | ^1.64.1 | 端到端测试 |
| DOM 模拟 | happy-dom | ^21.0.3 | 测试 DOM 环境 |
| 富文本 | @tiptap/* | ^3.32.0 | 富文本编辑器 |
| 数据库 | better-sqlite3 | ^13.0.3 | SQLite（内容存储） |

### 2.2 Nuxt 模块体系

项目在 `nuxt.config.ts` 中注册了以下模块：

    @nuxt/content        // 内容管理
    @nuxt/a11y           // 无障碍
    @nuxt/eslint         // ESLint
    @nuxt/hints          // 开发提示
    @nuxt/image          // 图片优化
    @nuxt/test-utils/module  // 测试工具
    @nuxt/ui             // UI 组件库

### 2.3 渲染模式

Nuxt 4 默认采用 **混合渲染** 策略：

- **SSR（服务端渲染）**：默认渲染模式，首屏由服务端生成 HTML
- **CSR（客户端渲染）**：通过 `ssr: false` 可切换
- **SSG（静态站点生成）**：通过 `nuxt generate` 生成静态站点
- **ISR（增量静态再生）**：通过路由规则配置

本项目作为内容站点，推荐使用 SSG 部署（`npm run generate`）。

### 2.4 目录结构（Nuxt 4）

Nuxt 4 引入了 `app/` 目录作为应用源码根目录，这是与 Nuxt 3 的主要区别之一。同时新增 `shared/` 目录用于前后端共享代码。

#### 2.4.1 Nuxt 4 标准目录结构（完整）

    project-root/
    ├── app/                         # 【应用源码】Nuxt 4 应用根目录
    │   ├── app.vue                  #   根组件（必需，注入 <NuxtPage>）
    │   ├── error.vue                #   错误页面（404/500 等统一展示）
    │   ├── app.config.ts            #   应用运行时配置（响应式，客户端可改）
    │   ├── assets/                  #   需构建处理的资源（CSS/字体/图片）
    │   │   └── css/
    │   │       └── main.css         #     全局样式入口
    │   ├── components/              #   Vue 组件（自动导入）
    │   │   ├── AppHeader.vue        #     → <AppHeader>
    │   │   └── ui/
    │   │       └── Button.vue       #     → <UiButton>（目录名作前缀）
    │   ├── composables/             #   组合式函数（自动导入）
    │   │   └── useUser.ts           #     → useUser()
    │   ├── layouts/                 #   布局组件
    │   │   ├── default.vue          #     默认布局
    │   │   └── admin.vue            #     → definePageMeta({ layout: 'admin' })
    │   ├── middleware/              #   路由中间件（命名约定决定执行时机）
    │   │   ├── auth.ts              #     全局中间件（文件名无 .global）
    │   │   └── setup.global.ts      #     全局中间件（.global 后缀，每次导航执行）
    │   ├── pages/                   #   文件路由页面
    │   │   ├── index.vue            #     → /
    │   │   ├── about.vue            #     → /about
    │   │   ├── users/
    │   │   │   ├── index.vue        #     → /users
    │   │   │   └── [id].vue         #     → /users/:id（动态路由）
    │   │   └── [...slug].vue        #     → /*（catch-all 路由）
    │   ├── plugins/                 #   插件（按文件名顺序执行）
    │   │   └── 01.init.ts           #     数字前缀控制执行顺序
    │   ├── utils/                   #   工具函数（自动导入）
    │   │   └── format.ts            #     → format() 等导出函数
    │   ├── stores/                  #   Pinia stores（需安装 @pinia/nuxt）
    │   │   └── user.ts              #     → useUserStore()
    │   └── modules/                 #   本地模块（项目级自定义模块）
    │       └── my-module/
    │           └── index.ts
    ├── server/                      # 【服务端源码】Nitro 服务端
    │   ├── api/                     #   API 路由（自动映射 /api/*）
    │   │   ├── users.get.ts         #     GET  /api/users
    │   │   ├── users.post.ts        #     POST /api/users
    │   │   └── users/[id].get.ts    #     GET  /api/users/:id
    │   ├── routes/                  #   服务端路由（映射根路径，非 /api）
    │   │   └── sitemap.xml.ts       #     GET  /sitemap.xml
    │   ├── middleware/              #   服务端中间件（每次请求执行）
    │   │   └── log.ts
    │   ├── plugins/                 #   服务端插件（启动时执行一次）
    │   │   └── db.ts
    │   ├── utils/                   #   服务端工具函数（自动导入）
    │   │   └── db.ts
    │   └── assets/                  #   服务端静态资源
    ├── shared/                      # 【共享代码】前后端共用（Nuxt 4 新增）
    │   ├── types/                   #   共享类型定义
    │   │   └── user.ts
    │   └── utils/                   #   共享工具函数（前后端自动导入）
    │       └── validate.ts
    ├── public/                      # 【静态资源】直接访问，不经过构建
    │   ├── favicon.ico
    │   ├── robots.txt
    │   └── images/
    ├── content/                     # 【内容源】@nuxt/content 的 Markdown
    │   ├── index.md
    │   └── about.md
    ├── node_modules/                # 依赖（gitignore）
    ├── .nuxt/                       # Nuxt 生成产物（gitignore，类型/路由等）
    ├── .output/                     # 构建产物（gitignore）
    ├── .data/                       # 内容数据缓存（gitignore）
    ├── .nitro/                      # Nitro 产物（gitignore）
    ├── .cache/                      # 缓存（gitignore）
    ├── nuxt.config.ts               # Nuxt 主配置
    ├── content.config.ts            # @nuxt/content 集合配置
    ├── app.config.ts                # 应用配置（也可放 app/ 下）
    ├── tsconfig.json                # TypeScript 配置（引用 .nuxt 生成）
    ├── package.json                 # 依赖与脚本
    └── .env                         # 环境变量（gitignore）

#### 2.4.2 目录职责与自动导入规则

| 目录 | 作用域 | 自动导入 | 说明 |
|---|---|---|---|
| `app/components/` | 客户端+服务端 | ✅ 组件 | 基于路径生成组件名，子目录作前缀 |
| `app/composables/` | 客户端+服务端 | ✅ 函数 | 导出的 `useXxx` 函数全局可用 |
| `app/utils/` | 客户端+服务端 | ✅ 函数 | 导出的工具函数全局可用 |
| `app/plugins/` | 按配置 | ❌ 自动注册 | 文件即插件，按文件名顺序执行 |
| `app/middleware/` | 客户端 | ❌ 需声明 | 非 global 需在页面 `definePageMeta` 中引用 |
| `app/layouts/` | 客户端 | ✅ 布局 | 通过 `layout` 属性引用 |
| `app/pages/` | 客户端+服务端 | ✅ 路由 | 文件路径即路由路径 |
| `app/stores/` | 客户端+服务端 | ✅ store | 需安装 `@pinia/nuxt` |
| `app/modules/` | 构建期 | ❌ 需在 nuxt.config 注册 | 本地模块 |
| `server/api/` | 服务端 | ✅ 路由 | 映射为 `/api/*` |
| `server/routes/` | 服务端 | ✅ 路由 | 映射为根路径 |
| `server/middleware/` | 服务端 | ✅ 自动注册 | 每次请求执行 |
| `server/plugins/` | 服务端 | ✅ 自动注册 | 启动时执行一次 |
| `server/utils/` | 服务端 | ✅ 函数 | 服务端工具函数自动导入 |
| `shared/types/` | 前后端 | ✅ 类型 | 共享类型定义 |
| `shared/utils/` | 前后端 | ✅ 函数 | 前后端共享工具函数 |
| `public/` | 直接访问 | — | 原样复制到输出，不构建 |
| `app/assets/` | 需引用 | — | 需通过 `~/assets/` 引用，会构建处理 |

#### 2.4.3 关键文件说明

| 文件 | 必需 | 作用 |
|---|---|---|
| `app/app.vue` | ✅ | 根组件，必须包含 `<NuxtPage>` 或 `<NuxtLayout>` |
| `app/error.vue` | ❌ | 自定义错误页，接收 `error` prop |
| `nuxt.config.ts` | ✅ | Nuxt 配置入口 |
| `app.config.ts` | ❌ | 运行时配置（区别于构建时配置，客户端可响应式修改） |
| `content.config.ts` | ❌ | @nuxt/content 集合与 schema 定义 |
| `tsconfig.json` | ✅ | TypeScript 配置，引用 `.nuxt/` 生成 |

#### 2.4.4 `app/` 与 `server/` 与 `shared/` 的边界

| 代码位置 | 运行环境 | 可用 API |
|---|---|---|
| `app/**` | 客户端 + 服务端（SSR） | Vue、Nuxt 组合式函数、浏览器 API（仅客户端） |
| `server/**` | 仅服务端（Nitro） | `defineEventHandler`、Node.js API、数据库 |
| `shared/**` | 前后端均可 | 纯逻辑代码，不依赖 Vue 或 Node 特有 API |

**原则**：跨端复用的纯函数（类型、校验、格式化）放 `shared/`；仅服务端的逻辑放 `server/`；涉及 Vue 渲染的放 `app/`。

#### 2.4.5 本项目实际结构

本项目目前仅使用了上述标准结构的一部分（`server/` 为空，未使用 `layouts/`、`middleware/`、`plugins/` 等），实际结构如下：

    fsp/
    ├── app/                        # 应用源码
    │   ├── app.vue                 #   根组件
    │   ├── components/             #   自动导入组件
    │   │   ├── Alert.vue
    │   │   └── Counter.vue
    │   └── pages/                  #   文件路由
    │       └── [...slug].vue       #     catch-all 内容路由
    ├── content/                    # Markdown 内容源
    │   ├── index.md
    │   └── about.md
    ├── public/                     # 静态资源
    │   └── favicon.ico
    ├── server/                     # 服务端代码（当前为空，可扩展）
    ├── test/                       # 单元测试与 Nuxt 环境测试
    │   ├── unit/
    │   └── nuxt/
    ├── tests/                      # E2E 测试（Playwright）
    ├── docs/                       # 项目文档
    ├── .nuxt/                      # Nuxt 生成产物（gitignore）
    ├── .data/                      # 内容数据缓存（gitignore）
    ├── nuxt.config.ts
    ├── content.config.ts
    ├── tsconfig.json
    ├── vitest.config.ts
    ├── playwright.config.ts
    ├── eslint.config.mjs
    └── package.json

**可扩展方向**：如需新增布局、中间件、API、插件等，按 2.4.1 标准结构在对应目录下创建文件即可，Nuxt 会自动识别。

---

## 3. 环境准备

### 3.1 环境要求

| 工具 | 最低版本 | 说明 |
|---|---|---|
| Node.js | 18.x+（推荐 20.x LTS） | Nuxt 4 运行时 |
| 包管理器 | npm / pnpm / yarn / bun | 任选其一 |
| 操作系统 | macOS / Linux / Windows | 跨平台支持 |

### 3.2 安装依赖

    # 使用 npm
    npm install

    # 使用 pnpm（推荐，更快）
    pnpm install

    # 使用 yarn
    yarn install

    # 使用 bun
    bun install

### 3.3 启动开发服务器

    npm run dev

启动后访问 `http://localhost:3000`。开发服务器支持：

- **HMR（热模块替换）**：修改代码即时生效
- **DevTools**：访问 `http://localhost:3000/__nuxt_devtools__`
- **内容热更新**：修改 `content/` 下 Markdown 自动刷新

### 3.4 环境变量

在项目根目录创建 `.env` 文件（已被 `.gitignore` 排除）：

    NUXT_PUBLIC_SITE_NAME=FSP

通过 `runtimeConfig` 在 `nuxt.config.ts` 中声明后，使用 `useRuntimeConfig()` 读取。

---

## 4. 核心配置详解

### 4.1 nuxt.config.ts

当前配置：

    export default defineNuxtConfig({
      modules: [
        '@nuxt/content',
        '@nuxt/a11y',
        '@nuxt/eslint',
        '@nuxt/hints',
        '@nuxt/image',
        '@nuxt/test-utils/module',
        '@nuxt/ui',
      ],
      devtools: { enabled: true },
      compatibilityDate: '2024-04-03',
    })

**配置项说明：**

| 项 | 说明 |
|---|---|
| `modules` | Nuxt 模块列表，按顺序初始化 |
| `devtools` | Nuxt DevTools 开关 |
| `compatibilityDate` | 兼容性日期，锁定 Nuxt 行为版本 |

**常用扩展配置示例：**

    export default defineNuxtConfig({
      modules: [/* ... */],
      // 运行时配置（环境变量）
      runtimeConfig: {
        public: {
          siteName: process.env.NUXT_PUBLIC_SITE_NAME || 'FSP',
        },
      },
      // 应用配置
      app: {
        head: {
          title: 'FSP',
          meta: [{ name: 'description', content: 'Nuxt 内容站点' }],
        },
      },
      // 内容模块配置
      content: {
        build: {
          markdown: {
            highlight: { theme: 'github-dark' },
          },
        },
      },
      // UI 模块配置
      ui: {
        theme: { colors: ['primary', 'secondary'] },
      },
    })

### 4.2 content.config.ts

定义内容集合，是 `@nuxt/content` v3 的核心配置：

    import { defineContentConfig, defineCollection } from '@nuxt/content'

    export default defineContentConfig({
      collections: {
        content: defineCollection({
          type: 'page',     // 页面类型，含路径与导航信息
          source: '**',     // 匹配 content/ 下所有文件
        }),
      },
    })

**集合类型说明：**

| type | 用途 | 特征 |
|---|---|---|
| `page` | 页面内容 | 自动生成 `path`、`title`、`description` 等字段 |
| `data` | 数据内容 | 自定义 schema，用于结构化数据 |

**扩展集合示例：**

    export default defineContentConfig({
      collections: {
        content: defineCollection({
          type: 'page',
          source: '**',
        }),
        posts: defineCollection({
          type: 'page',
          source: 'posts/**',
          schema: z.object({
            date: z.string(),
            tags: z.array(z.string()),
          }),
        }),
      },
    })

### 4.3 tsconfig.json

采用项目引用（project references）模式，由 Nuxt 生成具体配置：

    {
      "files": [],
      "references": [
        { "path": "./.nuxt/tsconfig.app.json" },
        { "path": "./.nuxt/tsconfig.server.json" },
        { "path": "./.nuxt/tsconfig.shared.json" },
        { "path": "./.nuxt/tsconfig.node.json" }
      ]
    }

四个引用分别对应：应用端、服务端、共享代码、Node 端的类型环境。**不要手动修改 `.nuxt/` 下的文件**，它们由 `nuxt prepare` 重新生成。

### 4.4 eslint.config.mjs

基于 Flat Config 的 ESLint 配置，继承 Nuxt 预设：

    import withNuxt from './.nuxt/eslint.config.mjs'

    export default withNuxt(
      // 在此添加自定义规则
    )

运行检查：

    npx eslint .
    npx eslint . --fix   # 自动修复

---

## 5. 路由与页面

### 5.1 文件路由系统

Nuxt 采用基于文件的路由系统，`app/pages/` 下的 `.vue` 文件自动映射为路由：

| 文件路径 | 路由 |
|---|---|
| `app/pages/index.vue` | `/` |
| `app/pages/about.vue` | `/about` |
| `app/pages/users/[id].vue` | `/users/:id`（动态路由） |
| `app/pages/[...slug].vue` | `/*`（catch-all 路由） |

### 5.2 catch-all 路由（本项目核心）

本项目使用 `app/pages/[...slug].vue` 作为内容渲染的统一入口：

    <script setup lang="ts">
    const route = useRoute()

    const { data: page } = await useAsyncData('page-' + route.path, () => {
      return queryCollection('content').path(route.path).first()
    })

    if (!page.value) {
      throw createError({ statusCode: 404, statusMessage: 'Page not found', fatal: true })
    }
    </script>

    <template>
      <ContentRenderer
        v-if="page"
        :value="page"
      />
    </template>

**逻辑解析：**

1. `useRoute()` 获取当前路由对象
2. `useAsyncData` 异步查询内容集合，key 包含路径以保证不同路径独立缓存
3. `queryCollection('content')` 查询 `content` 集合
4. `.path(route.path)` 按路径过滤
5. `.first()` 取第一条匹配记录
6. 未找到内容时抛出 404 致命错误
7. `ContentRenderer` 渲染 Markdown 为 HTML（含 MDC 组件）

### 5.3 根组件 app.vue

    <template>
      <NuxtRouteAnnouncer />
      <NuxtPage />
    </template>

- `NuxtRouteAnnouncer`：无障碍路由通告（来自 `@nuxt/a11y`），为屏幕阅读器播报路由变化
- `NuxtPage`：页面出口，渲染当前路由对应的页面组件

### 5.4 编程式导航

    <script setup lang="ts">
    const router = useRouter()

    // 跳转
    router.push('/about')
    navigateTo('/about')

    // 带参数
    navigateTo({ path: '/users', query: { id: '1' } })

    // 外部链接
    navigateTo('https://nuxt.com', { external: true })
    </script>

### 5.5 路由链接组件

    <template>
      <NuxtLink to="/about">关于</NuxtLink>
      <NuxtLink to="/" prefetch>首页（预取）</NuxtLink>
    </template>

---

## 6. 组件开发

### 6.1 组件自动导入

`app/components/` 下的 Vue 组件会被 **自动导入**，无需手动 import。组件名基于路径：

| 文件路径 | 组件名 |
|---|---|
| `app/components/Alert.vue` | `<Alert>` |
| `../app/components/CounterBox.vue` | `<Counter>` |
| `app/components/ui/Button.vue` | `<UiButton>` |

### 6.2 Alert 组件示例

    <template>
      <div class="alert" :style="{ 'border-color': color }">
        <slot></slot>
      </div>
    </template>

    <script setup lang="ts">
    const { color } = defineProps({
      color: {
        type: String,
        default: 'orange'
      }
    })
    </script>

    <style scoped>
    .alert {
      display: flex;
      align-items: center;
      padding: 1rem;
      border: 2px solid;
      border-radius: 0.5rem;
      background-color: #fff;
      box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
      transition: transform 0.2s ease, box-shadow 0.2s ease;
    }

    .alert:hover {
      transform: translateY(-2px);
      box-shadow: 0 6px 8px rgba(0, 0, 0, 0.15);
    }
    </style>

**要点：**

- 使用 `<script setup lang="ts">` 语法糖 + TypeScript
- `defineProps` 声明 props，支持默认值
- `<slot>` 插槽接收子内容
- `<style scoped>` 局部样式，仅作用于当前组件

### 6.3 Counter 组件示例

    <template>
      <div>
        <h3>Counter: {{ count }}</h3>
        <button @click="increment">Increment</button>
        <button @click="decrement">Decrement</button>
      </div>
    </template>

    <script setup lang="ts">
    const count = ref(0)

    const increment = () => { count.value++ }
    const decrement = () => { count.value-- }
    </script>

**要点：**

- `ref` 自动导入，无需 import
- `count.value` 在 `<script>` 中访问，`{{ count }}` 在 `<template>` 中自动解包
- 事件绑定使用 `@click`

### 6.4 组件通信规范

**Props（父 → 子）：**

    <script setup lang="ts">
    interface Props {
      title: string
      count?: number
    }
    const props = withDefaults(defineProps<Props>(), {
      count: 0,
    })
    </script>

**Emits（子 → 父）：**

    <script setup lang="ts">
    const emit = defineEmits<{
      change: [value: number]
      submit: []
    }>()

    emit('change', 42)
    </script>

**v-model 双向绑定：**

    <script setup lang="ts">
    const model = defineModel<string>()
    </script>

    <template>
      <input v-model="model" />
    </template>

### 6.5 组件开发规范

1. **命名**：PascalCase 文件名，如 `UserCard.vue`
2. **类型**：所有组件使用 `<script setup lang="ts">`
3. **Props**：使用 TypeScript interface 声明，复杂 props 提供默认值
4. **样式**：优先使用 TailwindCSS 类名，组件特有样式用 `<style scoped>`
5. **组合式函数**：逻辑复用提取为 `app/composables/` 下的 `useXxx` 函数（自动导入）

---

## 7. 内容管理（@nuxt/content）

### 7.1 内容目录

所有 Markdown 文件放在 `content/` 目录下，文件路径即路由路径：

| 文件 | URL |
|---|---|
| `content/index.md` | `/` |
| `content/about.md` | `/about` |
| `content/posts/hello.md` | `/posts/hello` |

### 7.2 Markdown 示例

`content/index.md`：

    # Welcome to Nuxt Content Starter

    This is the main page displaying Markdown.

    Move to [about](/about) page.

    ## Manage your Contents

    Create new pages or modify the existing ones in `content/` directory.

    ::alert{color="green"}
    The current alert and the counter below are Vue components integrated into the Markdown.
    ::

    ::counter
    ::

### 7.3 MDC 语法（Markdown Components）

MDC 允许在 Markdown 中使用 Vue 组件：

**块级组件：**

    ::alert{color="green"}
    这是 alert 组件的内容
    ::

**行内组件：**

    这是一个 :counter 行内计数器。

**带 props 的组件：**

    ::alert{color="red" title="警告"}
    危险操作
    ::

**嵌套组件：**

    ::card
    # 标题

    内容段落

    ::button{label="点击"}
    ::
    ::

### 7.4 查询 API

在页面或组件中查询内容：

    <script setup lang="ts">
    // 按路径查询单条
    const page = await queryCollection('content').path('/about').first()

    // 查询全部
    const all = await queryCollection('content').all()

    // 查询多条（按目录）
    const posts = await queryCollection('content')
      .where('path', 'LIKE', '/posts/%')
      .all()

    // 排序
    const sorted = await queryCollection('content')
      .order('date', 'DESC')
      .all()

    // 分页
    const paged = await queryCollection('content')
      .limit(10)
      .offset(0)
      .all()
    </script>

**推荐使用 `useAsyncData` 包裹查询，以支持 SSR 数据获取与缓存：**

    const { data } = await useAsyncData('about', () =>
      queryCollection('content').path('/about').first()
    )

### 7.5 ContentRenderer

`ContentRenderer` 组件用于将查询到的内容对象渲染为 HTML：

    <template>
      <ContentRenderer :value="page" />
    </template>

它会自动处理：

- Markdown → HTML 转换
- 代码高亮
- MDC 组件渲染
- Vue 组件 hydration

### 7.6 Frontmatter

Markdown 文件顶部可添加 frontmatter：

    ---
    title: 文章标题
    description: 文章描述
    date: 2026-10-18
    tags: [nuxt, vue]
    ---

    # 正文内容

这些字段可通过查询结果的 `page.title`、`page.description` 等访问。

---

## 8. UI 组件库（@nuxt/ui）

### 8.1 可用组件

`@nuxt/ui` v4 提供丰富的组件，常用包括：

- 布局：`UContainer`、`UCard`、`UDivider`
- 表单：`UInput`、`UButton`、`USelect`、`UCheckbox`、`UForm`
- 反馈：`UAlert`、`UModal`、`UToast`、`USlideover`
- 导航：`UNavigationMenu`、`UTabs`、`UBreadcrumb`
- 数据：`UTable`、`UPagination`

组件前缀为 `U`，自动导入，无需 import。

### 8.2 使用示例

    <template>
      <UContainer>
        <UButton color="primary" @click="onClick">
          点击我
        </UButton>

        <UAlert
          title="提示"
          description="操作成功"
          color="green"
        />

        <UCard>
          <template #header>
            卡片标题
          </template>
          卡片内容
        </UCard>
      </UContainer>
    </template>

### 8.3 主题定制

在 `nuxt.config.ts` 中配置：

    export default defineNuxtConfig({
      ui: {
        colors: ['primary', 'secondary', 'success', 'warning', 'error'],
        theme: {
          radius: '0.375rem',
        },
      },
    })

在 `app/assets/css/main.css` 中定义 CSS 变量（TailwindCSS v4）：

    @theme {
      --color-primary-500: #3b82f6;
    }

---

## 9. 富文本编辑器（TipTap）

### 9.1 已安装扩展

项目集成了 TipTap v3 及以下扩展：

| 扩展 | 用途 |
|---|---|
| `@tiptap/starter-kit` | 基础套件（标题、列表、引用等） |
| `@tiptap/markdown` | Markdown 序列化 |
| `@tiptap/extension-placeholder` | 占位文本 |
| `@tiptap/extension-image` | 图片 |
| `@tiptap/extension-code` | 代码块 |
| `@tiptap/extension-mention` | @提及 |
| `@tiptap/extension-collaboration` | 协同编辑 |
| `@tiptap/extension-bubble-menu` | 气泡菜单 |
| `@tiptap/extension-floating-menu` | 浮动菜单 |
| `@tiptap/extension-drag-handle` | 拖拽手柄 |
| `@tiptap/extension-horizontal-rule` | 分割线 |
| `@tiptap/extension-node-range` | 节点范围 |

### 9.2 基础使用

    <script setup lang="ts">
    import { useEditor, EditorContent } from '@tiptap/vue-3'
    import StarterKit from '@tiptap/starter-kit'

    const editor = useEditor({
      extensions: [StarterKit],
      content: '<p>初始内容</p>',
    })
    </script>

    <template>
      <EditorContent :editor="editor" />
    </template>

---

## 10. 数据获取与状态

### 10.1 数据获取组合式函数

| 函数 | 用途 |
|---|---|
| `useAsyncData(key, handler)` | 通用异步数据获取（SSR 友好） |
| `useFetch(url)` | 简化的 HTTP 请求封装 |
| `useLazyAsyncData` | 懒加载（不阻塞导航） |
| `useLazyFetch` | 懒加载 fetch |

**示例：**

    <script setup lang="ts">
    // useAsyncData
    const { data, pending, error, refresh } = await useAsyncData(
      'users',
      () => $fetch('/api/users')
    )

    // useFetch
    const { data: posts } = await useFetch('/api/posts', {
      query: { limit: 10 },
      transform: (data) => data.items,
    })
    </script>

### 10.2 状态管理

**useState（推荐，SSR 友好）：**

    <script setup lang="ts">
    // 共享状态
    const counter = useState('counter', () => 0)

    counter.value++
    </script>

**Pinia（复杂场景）：**

如需 Pinia，安装 `@pinia/nuxt` 模块后在 `app/stores/` 下定义 store。

### 10.3 运行时配置

    <script setup lang="ts">
    const config = useRuntimeConfig()
    console.log(config.public.siteName)
    </script>

---

## 11. 测试体系

### 11.1 测试分层

本项目采用三层测试架构：

| 层级 | 目录 | 工具 | 命令 | 用途 |
|---|---|---|---|---|
| 单元测试 | `test/unit/` | Vitest | `npm run test:unit` | 纯函数/逻辑测试 |
| Nuxt 环境测试 | `test/nuxt/` | Vitest + @nuxt/test-utils | `npm run test:nuxt` | 组件挂载、Nuxt 上下文 |
| E2E 测试 | `tests/` | Playwright | `npm run test:e2e` | 真实浏览器端到端 |

### 11.2 测试命令

    npm test                  # 运行所有 Vitest 测试
    npm run test:watch        # 监听模式
    npm run test:unit         # 仅单元测试
    npm run test:nuxt         # 仅 Nuxt 环境测试
    npm run test:e2e          # E2E 测试（Playwright）
    npm run test:e2e:ui       # E2E 测试 UI 面板

### 11.3 Vitest 配置

`vitest.config.ts` 定义了两个测试 project：

    import { fileURLToPath } from 'node:url'
    import { defineConfig } from 'vitest/config'
    import { defineVitestProject } from '@nuxt/test-utils/config'

    export default defineConfig({
      test: {
        projects: [
          {
            test: {
              name: 'unit',
              include: ['test/unit/*.{test,spec}.ts'],
              environment: 'node',
            },
          },
          await defineVitestProject({
            test: {
              name: 'nuxt',
              include: ['test/nuxt/*.{test,spec}.ts'],
              environment: 'nuxt',
              environmentOptions: {
                nuxt: {
                  rootDir: fileURLToPath(new URL('.', import.meta.url)),
                  domEnvironment: 'happy-dom',
                },
              },
            },
          }),
        ],
      },
    })

**要点：**

- `unit` project：Node 环境，测试纯逻辑
- `nuxt` project：Nuxt 环境，支持 `useRoute`、`useAsyncData` 等 Nuxt API
- `domEnvironment: 'happy-dom'`：使用 happy-dom 模拟 DOM（比 jsdom 快）

### 11.4 单元测试示例

`test/unit/example.test.ts`：

    import { describe, expect, it } from 'vitest'

    describe('example unit test', () => {
      it('should pass', () => {
        expect(1 + 1).toBe(2)
      })
    })

### 11.5 Nuxt 环境组件测试

`test/nuxt/component.test.ts`：

    import { describe, expect, it } from 'vitest'
    import { mountSuspended } from '@nuxt/test-utils/runtime'
    import { defineComponent, h } from 'vue'

    describe('component test example', () => {
      it('can mount components', async () => {
        const TestComponent = defineComponent({
          setup() {
            return () => h('div', 'Hello Nuxt!')
          },
        })

        const component = await mountSuspended(TestComponent)
        expect(component.text()).toBe('Hello Nuxt!')
      })
    })

**关键 API：**

- `mountSuspended`：挂载组件并等待 Suspense 解析（支持异步 setup）
- `renderSuspended`：渲染组件并返回 DOM
- 可直接测试使用 `useRoute`、`useAsyncData` 的组件

### 11.6 E2E 测试

`playwright.config.ts`：

    import { fileURLToPath } from 'node:url'
    import { defineConfig, devices } from '@playwright/test'
    import type { ConfigOptions } from '@nuxt/test-utils/playwright'

    export default defineConfig<ConfigOptions>({
      testDir: './tests',
      fullyParallel: true,
      forbidOnly: !!process.env.CI,
      retries: process.env.CI ? 2 : 0,
      workers: process.env.CI ? 1 : undefined,
      reporter: 'html',
      use: {
        trace: 'on-first-retry',
        nuxt: {
          rootDir: fileURLToPath(new URL('.', import.meta.url)),
        },
      },
      projects: [
        { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
      ],
    })

`tests/example.spec.ts`：

    import { expect, test } from '@nuxt/test-utils/playwright'

    test('example e2e test', async ({ page, goto }) => {
      await goto('/', { waitUntil: 'hydration' })
      await expect(page).toHaveTitle(/Nuxt/)
    })

**要点：**

- `goto` 由 Nuxt 提供，自动等待 hydration
- `page` 是 Playwright Page 对象
- CI 环境下自动重试 2 次

### 11.7 测试规范

1. **命名**：`*.test.ts` 或 `*.spec.ts`
2. **结构**：`describe` 分组，`it` 描述行为，使用中文或英文均可但保持一致
3. **断言**：使用 Vitest 的 `expect` API
4. **覆盖**：核心逻辑、边界条件、错误路径均需覆盖
5. **隔离**：每个测试应独立，避免共享可变状态

---

## 12. 构建与部署

### 12.1 构建命令

    # 生产构建（SSR）
    npm run build

    # 静态站点生成（SSG，推荐内容站点）
    npm run generate

    # 本地预览生产构建
    npm run preview

### 12.2 构建产物

- `npm run build` → `.output/` 目录，含服务端与客户端产物
- `npm run generate` → `.output/public/` 目录，纯静态文件

### 12.3 部署目标

Nuxt 支持多种部署目标，通过 `nuxt.config.ts` 的 `nitro.preset` 配置：

| Preset | 平台 |
|---|---|
| `node-server` | Node.js 服务器（默认） |
| `static` | 静态托管 |
| `vercel` | Vercel |
| `netlify` | Netlify |
| `cloudflare` / `cloudflare-pages` | Cloudflare |
| `edge` | Edge Workers |

**示例（静态部署）：**

    export default defineNuxtConfig({
      nitro: { preset: 'static' },
    })

### 12.4 竞赛部署提示

根据 `.gitignore` 注释，本项目为竞赛项目，需上传至码道云平台。部署前注意：

- 确认 `.codeartsdoer/` 目录未被排除（已在 `.gitignore` 中特殊处理）
- 执行 `npm run build` 或 `npm run generate` 生成产物
- 按平台要求提交产物或源码

---

## 13. 开发工作流

### 13.1 新增页面（Markdown 内容）

1. 在 `content/` 下创建 `.md` 文件，如 `content/posts/hello.md`
2. 添加 frontmatter 与正文
3. 访问 `/posts/hello` 即可查看
4. 无需修改任何 Vue 代码（catch-all 路由自动处理）

### 13.2 新增页面（自定义 Vue）

1. 在 `app/pages/` 下创建 `.vue` 文件，如 `app/pages/contact.vue`
2. 编写 `<script setup lang="ts">` 与 `<template>`
3. 访问 `/contact` 即可

### 13.3 新增组件

1. 在 `app/components/` 下创建 `.vue` 文件
2. 使用 PascalCase 命名
3. 自动导入，直接在页面或其他组件中使用
4. 如需在 Markdown 中使用，通过 MDC 语法 `::component-name` 调用

### 13.4 新增组合式函数

1. 在 `app/composables/` 下创建 `useXxx.ts`
2. 导出函数：`export function useXxx() { ... }`
3. 自动导入，全局可用

### 13.5 新增工具函数

1. 在 `app/utils/` 下创建 `xxx.ts`
2. 导出函数：`export function xxx() { ... }`
3. 自动导入，全局可用

### 13.6 新增服务端 API

1. 在 `server/api/` 下创建文件，如 `server/api/users.get.ts`
2. 文件名中的 HTTP 方法后缀决定路由方法
3. 示例：

       export default defineEventHandler((event) => {
         return { users: [] }
       })

4. 客户端通过 `$fetch('/api/users')` 调用

### 13.7 新增测试

| 类型 | 位置 | 命令 |
|---|---|---|
| 单元测试 | `test/unit/xxx.test.ts` | `npm run test:unit` |
| 组件测试 | `test/nuxt/xxx.test.ts` | `npm run test:nuxt` |
| E2E 测试 | `tests/xxx.spec.ts` | `npm run test:e2e` |

### 13.8 调试技巧

- **Nuxt DevTools**：开发时访问页面内置 DevTools 面板，查看组件树、路由、状态
- **`console.log`**：在服务端代码中输出到终端，在客户端代码中输出到浏览器控制台
- **Vue DevTools**：浏览器扩展，配合 Nuxt DevTools 使用
- **`debugger`**：在代码中插入 `debugger` 语句，配合 `--inspect` 调试

---

## 14. 代码规范

### 14.1 ESLint

基于 `@nuxt/eslint` 的 Flat Config：

    # 检查
    npx eslint .

    # 自动修复
    npx eslint . --fix

建议在 IDE 中启用 ESLint 保存时自动修复。

### 14.2 TypeScript

- 所有 `.ts` 与 `.vue` 文件使用 TypeScript
- 利用 Nuxt 自动生成的类型（`.nuxt/` 下的 tsconfig）
- 类型检查：`npx nuxi typecheck`

### 14.3 代码风格约定

1. **缩进**：2 空格
2. **引号**：单引号
3. **分号**：无分号（按 ESLint 配置）
4. **组件**：PascalCase
5. **组合式函数**：`useXxx` 命名
6. **常量**：UPPER_SNAKE_CASE
7. **文件名**：组件 PascalCase，工具/组合式函数 kebab-case 或 camelCase

### 14.4 Git 提交规范（建议）

采用 Conventional Commits：

    <type>(<scope>): <subject>

    types: feat | fix | docs | style | refactor | test | chore

示例：

    feat(content): 新增文章列表页
    fix(router): 修复 catch-all 路由 404 判断
    docs: 更新开发文档

---

## 15. 常见问题（FAQ）

### Q1: 访问页面返回 404？

**原因**：`content/` 下无对应 Markdown 文件，或 `queryCollection` 未匹配。

**排查**：
1. 确认 `content/` 下存在对应路径的 `.md` 文件
2. 确认 `content.config.ts` 中集合 `source` 能匹配该文件
3. 检查 `app/pages/[...slug].vue` 的查询逻辑

### Q2: 组件未自动导入？

**排查**：
1. 组件是否在 `app/components/` 下
2. 文件名是否为 `.vue`
3. 重启开发服务器：`npm run dev`
4. 运行 `npx nuxi prepare` 重新生成类型

### Q3: Markdown 中组件不渲染？

**排查**：
1. 确认使用 MDC 语法 `::component-name`
2. 组件名转为 kebab-case（如 `Alert` → `alert`）
3. 确认组件在 `app/components/` 下
4. 检查 `@nuxt/content` 是否正确配置

### Q4: 测试报 "Nuxt environment not found"？

**排查**：
1. 确认测试文件在 `test/nuxt/` 下
2. 确认 `vitest.config.ts` 中 `defineVitestProject` 配置正确
3. 运行 `npx nuxi prepare` 生成 `.nuxt/`
4. 确认 `@nuxt/test-utils` 已安装

### Q5: E2E 测试启动失败？

**排查**：
1. 安装浏览器：`npx playwright install`
2. 确认 `playwright.config.ts` 中 `rootDir` 正确
3. 确认开发服务器端口未被占用

### Q6: 内容查询返回空？

**排查**：
1. 确认 `content/` 下文件存在
2. 使用 `queryCollection('content').all()` 查看全部数据
3. 检查 `.data/` 缓存是否需要清除：删除 `.data/` 后重启
4. 确认 frontmatter 格式正确

### Q7: 构建产物过大？

**优化**：
1. 使用 `nuxt generate` 生成静态站点
2. 按需引入 TipTap 扩展
3. 配置 `@nuxt/image` 优化图片
4. 启用代码分割与懒加载

---

## 16. 参考资源

### 16.1 官方文档

| 资源 | 链接 |
|---|---|
| Nuxt 4 文档 | https://nuxt.com/docs |
| Nuxt Content | https://content.nuxt.com |
| Nuxt UI | https://ui.nuxt.com |
| Nuxt Image | https://image.nuxt.com |
| Vitest | https://vitest.dev |
| Playwright | https://playwright.dev |
| TipTap | https://tiptap.dev |
| TailwindCSS | https://tailwindcss.com |

### 16.2 项目内文件索引

| 文件 | 说明 |
|---|---|
| `README.md` | 项目快速入口（技术栈/快速开始/文档索引） |
| `nuxt.config.ts` | Nuxt 主配置 |
| `content.config.ts` | 内容集合配置 |
| `app/app.vue` | 根组件 |
| `app/pages/[...slug].vue` | catch-all 内容路由 |
| `app/components/Alert.vue` | Alert 组件示例 |
| `app/components/Counter.vue` | Counter 组件示例 |
| `vitest.config.ts` | 单元/组件测试配置 |
| `playwright.config.ts` | E2E 测试配置 |
| `eslint.config.mjs` | ESLint 配置 |
| `tsconfig.json` | TypeScript 配置 |

---

## 17. 附录：快速上手清单

- [ ] 安装 Node.js 20+ 与包管理器
- [ ] 执行 `npm install` 安装依赖
- [ ] 执行 `npm run dev` 启动开发服务器
- [ ] 访问 `http://localhost:3000` 验证首页
- [ ] 在 `content/` 下新增 `.md` 文件体验内容管理
- [ ] 在 `app/components/` 下新增 `.vue` 组件体验自动导入
- [ ] 运行 `npm test` 验证测试体系
- [ ] 运行 `npm run build` 验证构建

---

**文档结束** | FSP 项目 | 2026-10-18
