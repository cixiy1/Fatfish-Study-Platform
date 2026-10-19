<script setup lang="ts">
import { safeRedirect } from "~/utils/auth"

useHead({
  title: "登录 · FSP",
  meta: [{ name: "robots", content: "noindex" }],
})

const form = reactive({
  account: "",
  password: "",
  remember: true,
})

const showPassword = ref(false)
const loading = ref(false)
const message = ref("")

const route = useRoute()
const { login } = useAuthSession()

// 被中间件拦下来时带的回跳地址，登录成功后原路返回
const redirectTo = computed(() => safeRedirect(route.query.redirect))

function validate(state: typeof form) {
  const errors: { name: string; message: string }[] = []

  if (!state.account) {
    errors.push({ name: "account", message: "请输入账号" })
  }
  if (!state.password) {
    errors.push({ name: "password", message: "请输入密码" })
  }

  return errors
}

async function onSubmit() {
  loading.value = true
  message.value = ""

  try {
    await login(form.account, form.password, form.remember)
    // 登录成功后回到被拦截的那一页，没有回跳地址就回首页
    await navigateTo(redirectTo.value ?? "/", { replace: true })
  } catch (error) {
    message.value = errorMessage(error)
  } finally {
    loading.value = false
  }
}

/** 从 $fetch 抛出的 FetchError 里取可读文案 */
function errorMessage(error: unknown) {
  const data = (error as { data?: { statusMessage?: string; message?: string } })
    ?.data
  return data?.statusMessage || data?.message || "登录失败，请稍后重试"
}

function placeholder(feature: string) {
  message.value = `${feature} 功能占位，待接入`
}
</script>

<template>
  <div class="grid min-h-dvh lg:grid-cols-2">
    <aside
      class="relative hidden flex-col justify-between overflow-hidden bg-slate-950 p-12 text-slate-100 lg:flex"
    >
      <div
        class="pointer-events-none absolute -top-44 -right-56 size-[520px] rounded-full border border-white/10"
      />
      <div
        class="pointer-events-none absolute -right-36 -bottom-40 size-[380px] rounded-full border border-white/10"
      />

      <div
        class="relative flex items-center gap-2.5 text-sm font-semibold tracking-wide"
      >
        <span
          class="grid size-9 place-items-center rounded-lg bg-teal-400 text-sm font-bold text-teal-950"
        >
          F
        </span>
        FSP
      </div>

      <div class="relative max-w-sm">
        <p class="text-3xl font-semibold leading-snug tracking-tight">
          内容，从一篇文章开始
        </p>
        <p class="mt-4 text-sm leading-relaxed text-slate-400">
          Markdown 驱动，组件可复用，一条命令部署。
        </p>
        <ul class="mt-8 space-y-3 text-sm text-slate-300">
          <li class="flex items-center gap-2.5">
            <span class="size-1.5 rounded-full bg-teal-400" />
            内容与代码同仓管理
          </li>
          <li class="flex items-center gap-2.5">
            <span class="size-1.5 rounded-full bg-teal-400" />
            MDC 语法嵌入 Vue 组件
          </li>
          <li class="flex items-center gap-2.5">
            <span class="size-1.5 rounded-full bg-teal-400" />
            SSR 与静态生成双通道
          </li>
        </ul>
      </div>

      <p class="relative text-xs text-slate-500">© 2026 FSP</p>
    </aside>

    <section class="flex items-center justify-center px-5 py-12">
      <div class="w-full max-w-sm">
        <h1 class="text-2xl font-semibold tracking-tight">登录</h1>
        <p class="mt-2 text-sm text-muted">
          {{
            redirectTo
              ? `登录后继续访问 ${redirectTo}`
              : "使用账号继续，或先浏览公开内容。"
          }}
        </p>

        <UForm
          :state="form"
          :validate="validate"
          class="mt-8 space-y-5"
          @submit="onSubmit"
        >
          <UFormField label="账号" name="account">
            <UInput
              v-model="form.account"
              size="lg"
              class="w-full"
              placeholder="邮箱 / 手机号 / 用户名"
              autocomplete="username"
            />
          </UFormField>

          <UFormField label="密码" name="password">
            <UInput
              v-model="form.password"
              :type="showPassword ? 'text' : 'password'"
              size="lg"
              class="w-full"
              placeholder="请输入密码"
              autocomplete="current-password"
            >
              <template #trailing>
                <UButton
                  type="button"
                  color="neutral"
                  variant="link"
                  size="xs"
                  :label="showPassword ? '隐藏' : '显示'"
                  :aria-pressed="showPassword"
                  @click="showPassword = !showPassword"
                />
              </template>
            </UInput>
          </UFormField>

          <div class="flex items-center justify-between">
            <UCheckbox v-model="form.remember" label="记住我" />
            <UButton
              type="button"
              color="neutral"
              variant="link"
              size="sm"
              label="忘记密码？"
              @click="placeholder('找回密码')"
            />
          </div>

          <LazyUAlert
            v-if="message"
            color="neutral"
            variant="soft"
            :title="message"
            role="status"
          />

          <UButton
            type="submit"
            size="lg"
            block
            :loading="loading"
            label="登录"
          />
        </UForm>

        <USeparator label="或" class="my-6" />

        <div class="grid grid-cols-2 gap-3">
          <UButton
            color="neutral"
            variant="outline"
            size="lg"
            block
            @click="placeholder('微信登录')"
          >
            微信
          </UButton>
          <UButton
            color="neutral"
            variant="outline"
            size="lg"
            block
            @click="placeholder('GitHub 登录')"
          >
            GitHub
          </UButton>
        </div>

        <p class="mt-6 text-center text-sm text-muted">
          还没有账号？
          <UButton
            color="primary"
            variant="link"
            size="sm"
            label="注册"
            @click="placeholder('注册')"
          />
        </p>
      </div>
    </section>
  </div>
</template>
