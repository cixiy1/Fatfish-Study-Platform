<script setup lang="ts">
import type { SmtpPreset } from "#shared/types/auth"
import { SMTP_PRESETS } from "#shared/types/auth"

useHead({ title: "SMTP 配置 · 管理后台 · FSP" })

const form = reactive({
  preset: "gmail" as SmtpPreset,
  host: "",
  port: 587,
  secure: false,
  user: "",
  pass: "",
  from: "",
})

const loading = ref(true)
const saving = ref(false)
const testing = ref(false)
const testTo = ref("")
const message = ref<{ color: "success" | "error" | "warning", title: string, text?: string } | null>(null)
const hasExistingPass = ref(false)

const presetOptions = [
  { label: "Gmail", value: "gmail" },
  { label: "QQ 邮箱", value: "qq" },
  { label: "163 邮箱", value: "163" },
  { label: "自定义", value: "custom" },
]

const isCustom = computed(() => form.preset === "custom")

watch(() => form.preset, (preset) => {
  if (preset !== "custom" && preset in SMTP_PRESETS) {
    const p = SMTP_PRESETS[preset as Exclude<SmtpPreset, "custom">]
    form.host = p.host
    form.port = p.port
    form.secure = p.secure
  }
})

onMounted(async () => {
  try {
    const settings = await $fetch<{
      smtp: (Omit<typeof form, "pass"> & { pass: string | null }) | null
    }>("/api/admin/settings")

    if (settings.smtp) {
      form.preset = settings.smtp.preset
      form.host = settings.smtp.host
      form.port = settings.smtp.port
      form.secure = settings.smtp.secure
      form.user = settings.smtp.user
      form.from = settings.smtp.from
      hasExistingPass.value = settings.smtp.pass === null
    }
  } catch {
    message.value = { color: "error", title: "加载配置失败" }
  } finally {
    loading.value = false
  }
})

async function onSave() {
  message.value = null
  saving.value = true
  try {
    await $fetch("/api/admin/settings", {
      method: "PUT",
      body: {
        smtp: {
          preset: form.preset,
          host: form.host,
          port: form.port,
          secure: form.secure,
          user: form.user,
          pass: form.pass || null,
          from: form.from,
        },
      },
    })
    message.value = { color: "success", title: "SMTP 配置已保存" }
    hasExistingPass.value = true
    form.pass = ""
  } catch (error) {
    message.value = { color: "error", title: "保存失败", text: extractMessage(error) }
  } finally {
    saving.value = false
  }
}

async function onTest() {
  message.value = null
  if (!testTo.value) {
    message.value = { color: "warning", title: "请先填写收件人邮箱" }
    return
  }
  testing.value = true
  try {
    const res = await $fetch<{ message: string }>("/api/admin/test-smtp", {
      method: "POST",
      body: { to: testTo.value },
    })
    message.value = { color: "success", title: res.message }
  } catch (error) {
    message.value = { color: "error", title: "测试失败", text: extractMessage(error) }
  } finally {
    testing.value = false
  }
}

function extractMessage(error: unknown): string {
  const data = (error as { data?: { message?: string } })?.data
  return data?.message || "未知错误"
}
</script>

<template>
  <UContainer class="py-10">
    <div class="mb-6 flex items-center gap-4">
      <UButton to="/admin" variant="ghost" icon="i-lucide-arrow-left" label="返回" />
      <h1 class="text-xl font-semibold">SMTP 邮件配置</h1>
    </div>

    <UCard class="mx-auto max-w-2xl">
      <div v-if="loading" class="py-12 text-center text-muted">
        加载中…
      </div>

      <div v-else class="space-y-6">
        <UFormField label="预设类型">
          <USelect
            v-model="form.preset"
            :items="presetOptions"
            class="w-full"
          />
        </UFormField>

        <div v-if="isCustom" class="grid gap-4 sm:grid-cols-2">
          <UFormField label="SMTP 主机">
            <UInput v-model="form.host" placeholder="smtp.example.com" class="w-full" />
          </UFormField>
          <UFormField label="端口">
            <UInput v-model.number="form.port" type="number" placeholder="587" class="w-full" />
          </UFormField>
        </div>

        <div v-else class="grid gap-4 sm:grid-cols-2">
          <UFormField label="SMTP 主机">
            <UInput :model-value="form.host" disabled class="w-full" />
          </UFormField>
          <UFormField label="端口">
            <UInput :model-value="form.port" disabled class="w-full" />
          </UFormField>
        </div>

        <UFormField label="用户名" help="QQ/163 填完整邮箱地址（如 12345@qq.com），Gmail 填邮箱地址">
          <UInput v-model="form.user" placeholder="SMTP 登录用户名" class="w-full" />
        </UFormField>

        <UFormField :label="hasExistingPass ? '密码（留空则不修改）' : '密码'" help="QQ/163 填授权码（非登录密码），Gmail 填应用专用密码">
          <UInput
            v-model="form.pass"
            type="password"
            :placeholder="hasExistingPass ? '已设置，留空不修改' : '请输入密码'"
            class="w-full"
          />
        </UFormField>

        <UFormField label="发件人邮箱">
          <UInput v-model="form.from" type="email" placeholder="noreply@example.com" class="w-full" />
        </UFormField>

        <UFormField label="测试收件人邮箱" help="输入邮箱后点击下方按钮发送测试邮件">
          <UInput v-model="testTo" type="email" placeholder="you@example.com" class="w-full" />
        </UFormField>

        <UAlert
          v-if="message"
          :color="message.color"
          :title="message.title"
          :description="message.text"
        />

        <div class="flex gap-3">
          <UButton :loading="saving" @click="onSave">保存配置</UButton>
          <UButton variant="outline" :loading="testing" :disabled="!testTo" @click="onTest">发送测试邮件</UButton>
        </div>
      </div>
    </UCard>
  </UContainer>
</template>
