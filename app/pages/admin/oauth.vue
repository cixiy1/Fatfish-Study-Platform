<script setup lang="ts">
useHead({ title: "OAuth 配置 · 管理后台 · FSP" })

interface PlatformForm {
  clientId: string
  clientSecret: string
  hasSecret: boolean
}

const platforms = [
  { key: "github" as const, label: "GitHub", hint: "在 GitHub Settings → Developer settings → OAuth Apps 创建" },
  { key: "qq" as const, label: "QQ 互联", hint: "在 QQ 互联官网创建应用，回调地址需配置" },
  { key: "wechat" as const, label: "微信开放平台", hint: "在微信开放平台创建网站应用" },
]

const forms = reactive<Record<string, PlatformForm>>({
  github: { clientId: "", clientSecret: "", hasSecret: false },
  qq: { clientId: "", clientSecret: "", hasSecret: false },
  wechat: { clientId: "", clientSecret: "", hasSecret: false },
})

const loading = ref(true)
const saving = ref(false)
const message = ref<{ color: "success" | "error", title: string, text?: string } | null>(null)

onMounted(async () => {
  try {
    const settings = await $fetch<{
      oauth: {
        github?: { clientId: string, clientSecret: string | null }
        qq?: { clientId: string, clientSecret: string | null }
        wechat?: { clientId: string, clientSecret: string | null }
      }
    }>("/api/admin/settings")

    for (const p of platforms) {
      const creds = settings.oauth?.[p.key]
      if (creds) {
        forms[p.key].clientId = creds.clientId
        forms[p.key].hasSecret = creds.clientSecret === null
      }
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
    const oauth: Record<string, { clientId: string, clientSecret: string | null }> = {}
    for (const p of platforms) {
      const f = forms[p.key]
      if (f.clientId) {
        oauth[p.key] = {
          clientId: f.clientId,
          clientSecret: f.clientSecret || null,
        }
      }
    }

    await $fetch("/api/admin/settings", {
      method: "PUT",
      body: { oauth },
    })

    message.value = { color: "success", title: "OAuth 配置已保存" }
    for (const p of platforms) {
      if (forms[p.key].clientSecret) {
        forms[p.key].hasSecret = true
        forms[p.key].clientSecret = ""
      }
    }
  } catch (error) {
    message.value = { color: "error", title: "保存失败", text: extractMessage(error) }
  } finally {
    saving.value = false
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
      <h1 class="text-xl font-semibold">OAuth 第三方登录配置</h1>
    </div>

    <UCard class="mx-auto max-w-2xl">
      <div v-if="loading" class="py-12 text-center text-muted">
        加载中…
      </div>

      <div v-else class="space-y-8">
        <div v-for="p in platforms" :key="p.key" class="space-y-4">
          <div>
            <h3 class="font-medium">{{ p.label }}</h3>
            <p class="mt-1 text-xs text-muted">{{ p.hint }}</p>
          </div>

          <UFormField label="Client ID / App ID">
            <UInput
              v-model="forms[p.key].clientId"
              placeholder="应用 Client ID"
              class="w-full"
            />
          </UFormField>

          <UFormField :label="forms[p.key].hasSecret ? 'Client Secret（留空则不修改）' : 'Client Secret / App Secret'">
            <UInput
              v-model="forms[p.key].clientSecret"
              type="password"
              :placeholder="forms[p.key].hasSecret ? '已设置，留空不修改' : '请输入 Secret'"
              class="w-full"
            />
          </UFormField>

          <USeparator v-if="p.key !== 'wechat'" />
        </div>

        <UAlert
          v-if="message"
          :color="message.color"
          :title="message.title"
          :description="message.text"
        />

        <UButton :loading="saving" @click="onSave">保存配置</UButton>
      </div>
    </UCard>
  </UContainer>
</template>
