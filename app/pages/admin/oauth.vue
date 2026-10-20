<script setup lang="ts">
useHead({ title: "OAuth 配置 · 管理后台 · FSP" })

interface GitHubForm {
  clientId: string
  clientSecret: string
  hasSecret: boolean
}

const form = reactive<GitHubForm>({
  clientId: "",
  clientSecret: "",
  hasSecret: false,
})

const loading = ref(true)
const saving = ref(false)
const message = ref<{ color: "success" | "error", title: string, text?: string } | null>(null)

onMounted(async () => {
  try {
    const settings = await $fetch<{
      oauth: {
        github?: { clientId: string, clientSecret: string | null }
      }
    }>("/api/admin/settings")

    const creds = settings.oauth?.github
    if (creds) {
      form.clientId = creds.clientId
      form.hasSecret = creds.clientSecret === null
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
        oauth: {
          github: {
            clientId: form.clientId,
            clientSecret: form.clientSecret || null,
          },
        },
      },
    })

    message.value = { color: "success", title: "OAuth 配置已保存" }
    if (form.clientSecret) {
      form.hasSecret = true
      form.clientSecret = ""
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
        <div class="space-y-4">
          <div>
            <h3 class="font-medium">GitHub</h3>
            <p class="mt-1 text-xs text-muted">
              推荐用 OAuth App：GitHub Settings → Developer settings → OAuth Apps → New OAuth App，
              Authorization callback URL 填
              <code class="rounded bg-elevated px-1 py-0.5">https://你的域名/api/auth/github/callback</code>。
              用 GitHub App 也可以，但要额外在 Account permissions 里勾
              <strong>Email addresses: Read-only</strong>，否则拿不到邮箱。
            </p>
          </div>

          <UFormField label="Client ID">
            <UInput
              v-model="form.clientId"
              placeholder="OAuth App 的 Client ID"
              class="w-full"
            />
          </UFormField>

          <UFormField :label="form.hasSecret ? 'Client Secret（留空则不修改）' : 'Client Secret'">
            <UInput
              v-model="form.clientSecret"
              type="password"
              :placeholder="form.hasSecret ? '已设置，留空不修改' : '请输入 Client Secret'"
              class="w-full"
            />
          </UFormField>
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
