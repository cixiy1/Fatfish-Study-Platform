<script setup lang="ts">
import { isStrongPassword } from "#shared/utils/validate"

definePageMeta({ layout: "blank" })

useHead({
  title: "重置密码 · FSP",
  meta: [{ name: "robots", content: "noindex" }],
})

const route = useRoute()
const token = computed(() => (route.query.token as string | undefined) ?? "")

const form = reactive({
  password: "",
  confirmPassword: "",
})

const showPassword = ref(false)
const loading = ref(false)
const message = ref("")
const messageType = ref<"success" | "error">("error")
const done = ref(false)

function validate(state: typeof form) {
  const errors: { name: string; message: string }[] = []

  if (!state.password) {
    errors.push({ name: "password", message: "请输入新密码" })
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

  try {
    const res = await $fetch<{ ok: boolean; message: string }>("/api/auth/reset-password", {
      method: "POST",
      body: { token: token.value, password: form.password },
    })
    messageType.value = "success"
    message.value = res.message
    done.value = true
  } catch (error) {
    messageType.value = "error"
    message.value = errorMessage(error)
  } finally {
    loading.value = false
  }
}

function errorMessage(error: unknown) {
  const data = (error as { data?: { statusMessage?: string; message?: string } })?.data
  return data?.message || data?.statusMessage || "重置失败，请稍后重试"
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
          设置新密码
        </p>
        <p class="mt-4 text-sm leading-relaxed text-slate-400">
          为你的账号设置一个新密码。
        </p>
      </div>

      <p class="relative text-xs text-slate-500">© 2026 FSP</p>
    </aside>

    <section class="flex items-center justify-center px-5 py-12">
      <div class="w-full max-w-sm">
        <template v-if="!token">
          <h1 class="text-2xl font-semibold tracking-tight">链接无效</h1>
          <p class="mt-2 text-sm text-muted">
            重置链接缺少必要参数，请通过邮件中的链接访问。
          </p>
          <UButton
            class="mt-6"
            size="lg"
            label="返回登录"
            to="/login"
          />
        </template>

        <template v-else-if="done">
          <h1 class="text-2xl font-semibold tracking-tight">重置成功</h1>
          <LazyUAlert
            v-if="message"
            color="success"
            variant="soft"
            :title="message"
            role="status"
            class="mt-4"
          />
          <UButton
            class="mt-6"
            size="lg"
            block
            label="前往登录"
            to="/login"
          />
        </template>

        <template v-else>
          <h1 class="text-2xl font-semibold tracking-tight">重置密码</h1>
          <p class="mt-2 text-sm text-muted">
            请输入你的新密码。
          </p>

          <UForm
            :state="form"
            :validate="validate"
            class="mt-8 space-y-5"
            @submit="onSubmit"
          >
            <UFormField label="新密码" name="password">
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

            <UFormField label="确认新密码" name="confirmPassword">
              <UInput
                v-model="form.confirmPassword"
                :type="showPassword ? 'text' : 'password'"
                size="lg"
                class="w-full"
                placeholder="再次输入新密码"
                autocomplete="new-password"
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
              label="重置密码"
            />
          </UForm>
        </template>
      </div>
    </section>
  </div>
</template>
