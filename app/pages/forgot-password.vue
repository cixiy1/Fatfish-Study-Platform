<script setup lang="ts">
import { isValidEmail } from "#shared/utils/validate"

definePageMeta({ layout: "blank" })

useHead({
  title: "忘记密码 · FSP",
  meta: [{ name: "robots", content: "noindex" }],
})

const form = reactive({
  email: "",
})

const loading = ref(false)
const message = ref("")
const messageType = ref<"success" | "error">("error")

function validate(state: typeof form) {
  const errors: { name: string; message: string }[] = []

  if (!state.email) {
    errors.push({ name: "email", message: "请输入邮箱" })
  } else if (!isValidEmail(state.email)) {
    errors.push({ name: "email", message: "邮箱格式不正确" })
  }

  return errors
}

async function onSubmit() {
  loading.value = true
  message.value = ""

  try {
    const res = await $fetch<{ ok: boolean; message: string }>("/api/auth/forgot-password", {
      method: "POST",
      body: { email: form.email },
    })
    messageType.value = "success"
    message.value = res.message
  } catch (error) {
    messageType.value = "error"
    message.value = errorMessage(error)
  } finally {
    loading.value = false
  }
}

function errorMessage(error: unknown) {
  const data = (error as { data?: { statusMessage?: string; message?: string } })?.data
  return data?.message || data?.statusMessage || "发送失败，请稍后重试"
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
          找回密码
        </p>
        <p class="mt-4 text-sm leading-relaxed text-slate-400">
          输入注册邮箱，我们将发送密码重置链接到你的邮箱。
        </p>
      </div>

      <p class="relative text-xs text-slate-500">© 2026 FSP</p>
    </aside>

    <section class="flex items-center justify-center px-5 py-12">
      <div class="w-full max-w-sm">
        <h1 class="text-2xl font-semibold tracking-tight">忘记密码</h1>
        <p class="mt-2 text-sm text-muted">
          输入注册邮箱，我们将发送重置链接。
        </p>

        <UForm
          :state="form"
          :validate="validate"
          class="mt-8 space-y-5"
          @submit="onSubmit"
        >
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

          <LazyUAlert
            v-if="message"
            :color="messageType === 'success' ? 'success' : 'neutral'"
            variant="soft"
            :title="message"
            role="status"
          />

          <UButton
            type="submit"
            size="lg"
            block
            :loading="loading"
            label="发送重置链接"
          />
        </UForm>

        <p class="mt-6 text-center text-sm text-muted">
          想起来了？
          <UButton
            color="primary"
            variant="link"
            size="sm"
            label="返回登录"
            to="/login"
          />
        </p>
      </div>
    </section>
  </div>
</template>
