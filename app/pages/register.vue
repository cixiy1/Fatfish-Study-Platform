<script setup lang="ts">
import { isStrongPassword, isValidEmail } from "#shared/utils/validate"

definePageMeta({ layout: "blank" })

useHead({
  title: "注册 · FSP",
  meta: [{ name: "robots", content: "noindex" }],
})

const form = reactive({
  account: "",
  email: "",
  password: "",
  confirmPassword: "",
  name: "",
})

const showPassword = ref(false)
const loading = ref(false)
const message = ref("")
const messageDetail = ref("")
const messageType = ref<"success" | "error">("error")
const verifyUrl = ref("")
const copied = ref(false)

const { register } = useAuthSession()

// GitHub 只在真的配了凭证时才出现，避免点了弹 501
const { data: providers } = await useAsyncData<{ github: boolean } | null>("auth-providers", () =>
  $fetch<{ github: boolean }>("/api/auth/providers").catch(() => null),
)
const githubEnabled = computed(() => providers.value?.github === true)

function validate(state: typeof form) {
  const errors: { name: string; message: string }[] = []

  if (!state.account) {
    errors.push({ name: "account", message: "请输入账号" })
  } else if (state.account.trim().length < 3) {
    errors.push({ name: "account", message: "账号至少 3 个字符" })
  }

  if (!state.email) {
    errors.push({ name: "email", message: "请输入邮箱" })
  } else if (!isValidEmail(state.email)) {
    errors.push({ name: "email", message: "邮箱格式不正确" })
  }

  if (!state.password) {
    errors.push({ name: "password", message: "请输入密码" })
  } else if (!isStrongPassword(state.password)) {
    errors.push({ name: "password", message: "密码至少 8 位，需同时含字母和数字" })
  }

  if (state.confirmPassword !== state.password) {
    errors.push({ name: "confirmPassword", message: "两次输入的密码不一致" })
  }

  return errors
}

async function onSubmit() {
  loading.value = true
  message.value = ""
  messageDetail.value = ""
  verifyUrl.value = ""

  try {
    const res = await register(form.account, form.email, form.password, form.name || undefined)

    if (res.emailSent) {
      messageType.value = "success"
      message.value = res.message
      await navigateTo("/login?registered=1", { replace: true })
      return
    }

    // 邮件没发出去：留在本页，展示真实原因 + 可直接点击的验证链接
    messageType.value = "error"
    message.value = res.message
    messageDetail.value = res.emailError ?? ""
    verifyUrl.value = res.verificationUrl ?? ""
  } catch (error) {
    messageType.value = "error"
    message.value = errorMessage(error)
  } finally {
    loading.value = false
  }
}

async function copyVerifyUrl() {
  if (!verifyUrl.value) return
  try {
    await navigator.clipboard.writeText(verifyUrl.value)
    copied.value = true
    setTimeout(() => { copied.value = false }, 2000)
  } catch {
    // 剪贴板不可用时退化为选中文本，用户自行复制
  }
}

function errorMessage(error: unknown) {
  const data = (error as { data?: { statusMessage?: string; message?: string } })?.data
  return data?.message || data?.statusMessage || "注册失败，请稍后重试"
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
          加入 FSP
        </p>
        <p class="mt-4 text-sm leading-relaxed text-slate-400">
          创建账号，保存学习方向、关卡进度与学习记录。
        </p>
      </div>

      <p class="relative text-xs text-slate-500">© 2026 FSP</p>
    </aside>

    <section class="flex items-center justify-center px-5 py-12">
      <div class="w-full max-w-sm">
        <h1 class="text-2xl font-semibold tracking-tight">注册</h1>
        <p class="mt-2 text-sm text-muted">
          注册后需验证邮箱，验证完成即可登录。
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
              placeholder="至少 3 个字符"
              autocomplete="username"
            />
          </UFormField>

          <UFormField label="邮箱" name="email">
            <UInput
              v-model="form.email"
              type="email"
              size="lg"
              class="w-full"
              placeholder="you@example.com"
              autocomplete="email"
            />
          </UFormField>

          <UFormField label="密码" name="password">
            <UInput
              v-model="form.password"
              :type="showPassword ? 'text' : 'password'"
              size="lg"
              class="w-full"
              placeholder="至少 8 位，含字母和数字"
              autocomplete="new-password"
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

          <UFormField label="确认密码" name="confirmPassword">
            <UInput
              v-model="form.confirmPassword"
              :type="showPassword ? 'text' : 'password'"
              size="lg"
              class="w-full"
              placeholder="再次输入密码"
              autocomplete="new-password"
            />
          </UFormField>

          <UFormField label="昵称（可选）" name="name">
            <UInput
              v-model="form.name"
              size="lg"
              class="w-full"
              placeholder="留空则用账号作为昵称"
            />
          </UFormField>

          <LazyUAlert
            v-if="message"
            :color="messageType === 'success' ? 'success' : 'error'"
            variant="soft"
            :title="message"
            :description="messageDetail || undefined"
            role="status"
          />

          <div v-if="verifyUrl" class="rounded-lg border border-default bg-muted/30 p-3">
            <p class="text-xs text-muted">邮件发送失败，可点击下方链接直接完成激活（24 小时内有效）：</p>
            <div class="mt-2 flex items-center gap-2">
              <UButton
                type="button"
                size="sm"
                label="激活我的账号"
                :to="verifyUrl"
                external
              />
              <UButton
                type="button"
                size="sm"
                color="neutral"
                variant="outline"
                :label="copied ? '已复制' : '复制链接'"
                @click="copyVerifyUrl"
              />
            </div>
          </div>

          <UButton
            type="submit"
            size="lg"
            block
            :loading="loading"
            label="注册"
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
            label="使用 GitHub 注册 / 登录"
          />
        </template>

        <p class="mt-6 text-center text-sm text-muted">
          已有账号？
          <UButton
            color="primary"
            variant="link"
            size="sm"
            label="登录"
            to="/login"
          />
        </p>
      </div>
    </section>
  </div>
</template>
