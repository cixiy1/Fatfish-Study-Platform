<script setup lang="ts">
import { safeRedirect } from "~/utils/auth"

definePageMeta({ layout: "blank" })

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

// —— 补发验证邮件 ——
const resendOpen = ref(false)
const resendEmail = ref("")
const resending = ref(false)
const resendMessage = ref<{ type: "success" | "error", text: string } | null>(null)

function openResend() {
  resendEmail.value = ""
  resendMessage.value = null
  resendOpen.value = true
}

async function onResend() {
  resending.value = true
  resendMessage.value = null
  try {
    const res = await $fetch<{ sent: boolean, message: string }>("/api/auth/resend-verification", {
      method: "POST",
      body: { email: resendEmail.value },
    })
    resendMessage.value = { type: "success", text: res.message }
    if (res.sent) {
      resendOpen.value = false
    }
  } catch (error) {
    resendMessage.value = { type: "error", text: errorMessage(error) }
  } finally {
    resending.value = false
  }
}

const route = useRoute()
const { login } = useAuthSession()

// 被中间件拦下来时带的回跳地址，登录成功后原路返回
const redirectTo = computed(() => safeRedirect(route.query.redirect))

// URL 参数提示（注册成功 / 邮箱验证结果 / 第三方登录失败）
const urlAlert = computed<{ color: "success" | "error", text: string } | null>(() => {
  if (route.query.registered === "1") {
    return { color: "success", text: "注册成功，请登录" }
  }
  const errorMap: Record<string, string> = {
    invalid_token: "验证链接无效",
    token_used: "验证链接已使用，请直接登录",
    token_expired: "验证链接已过期，请重新注册或联系管理员",
    user_not_found: "用户不存在",
    oauth_state: "登录状态校验失败（链接过期或跨站），请重新发起登录",
  }
  const err = route.query.error as string | undefined
  if (!err) return null

  // 第三方平台回传的具体原因优先展示，便于定位是回调域没配还是扫码被拒
  const reason = typeof route.query.msg === "string" ? route.query.msg : ""
  if (err === "oauth_failed") {
    return { color: "error", text: reason || "第三方登录失败，请重试或改用账号密码登录" }
  }
  if (errorMap[err]) {
    return { color: "error", text: errorMap[err] }
  }
  return null
})

interface ProviderFlags {
  github: boolean
}

// 游客页也要能读，服务端直接取，失败就当没配
const { data: providers } = await useAsyncData<ProviderFlags | null>("auth-providers", () =>
  $fetch<ProviderFlags>("/api/auth/providers").catch(() => null),
)

/** 只在真配了 GitHub 凭证时才显示第三方登录按钮 */
const githubEnabled = computed(() => providers.value?.github === true)

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
  return data?.message || data?.statusMessage || "登录失败，请稍后重试"
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
        <img
          src="/logo-128.png"
          alt=""
          width="36"
          height="36"
          class="size-9 rounded-lg object-cover ring-1 ring-white/15"
        >
        FSP
      </div>

      <div class="relative max-w-sm">
        <p class="text-3xl font-semibold leading-snug tracking-tight">
          任何主题，一条可执行的路径
        </p>
        <p class="mt-4 text-sm leading-relaxed text-slate-400">
          AI 访谈确认目标与基础，生成技能点、关卡路径与配套资料。
        </p>
        <ul class="mt-8 space-y-3 text-sm text-slate-300">
          <li class="flex items-center gap-2.5">
            <span class="size-1.5 rounded-full bg-teal-400" />
            按目标拆解技能点与关卡
          </li>
          <li class="flex items-center gap-2.5">
            <span class="size-1.5 rounded-full bg-teal-400" />
            每关配套讲解与练习
          </li>
          <li class="flex items-center gap-2.5">
            <span class="size-1.5 rounded-full bg-teal-400" />
            学习记录与测评结果留档
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
              : "登录后继续学习。"
          }}
        </p>

        <UAlert
          v-if="urlAlert"
          :color="urlAlert.color"
          :title="urlAlert.text"
          class="mb-4"
        />

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
              to="/forgot-password"
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

        <template v-if="githubEnabled">
          <USeparator label="或" class="my-6" />

          <UButton
            color="neutral"
            variant="outline"
            size="lg"
            block
            to="/api/auth/github"
            external
            icon="i-lucide-github"
            label="使用 GitHub 登录"
          />
        </template>

        <p class="mt-6 text-center text-sm text-muted">
          还没有账号？
          <UButton
            color="primary"
            variant="link"
            size="sm"
            label="注册"
            to="/register"
          />
        </p>

        <p class="mt-3 text-center text-sm text-muted">
          注册了但没收到验证邮件？
          <UButton
            type="button"
            color="neutral"
            variant="link"
            size="sm"
            label="补发验证邮件"
            @click="openResend"
          />
        </p>
      </div>
    </section>

    <UModal v-model:open="resendOpen" title="补发验证邮件">
      <template #content>
        <UForm class="space-y-4 p-6" @submit="onResend">
          <h2 class="text-lg font-semibold">补发验证邮件</h2>

          <UFormField label="注册邮箱" help="我们会向该邮箱重新发送一封验证邮件">
            <UInput
              v-model="resendEmail"
              type="email"
              placeholder="you@example.com"
              autocomplete="email"
              class="w-full"
            />
          </UFormField>

          <UAlert
            v-if="resendMessage"
            :color="resendMessage.type === 'success' ? 'success' : 'error'"
            variant="soft"
            :title="resendMessage.text"
          />

          <div class="flex justify-end gap-3">
            <UButton type="button" color="neutral" variant="ghost" @click="resendOpen = false">取消</UButton>
            <UButton type="submit" :loading="resending" :disabled="!resendEmail">重新发送</UButton>
          </div>
        </UForm>
      </template>
    </UModal>
  </div>
</template>
