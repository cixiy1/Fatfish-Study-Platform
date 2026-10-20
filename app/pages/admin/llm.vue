<script setup lang="ts">
import type { LlmProvider } from "#shared/types/auth"
import { LLM_PROVIDER_DEFAULTS } from "#shared/types/auth"

useHead({ title: "大模型配置 · 管理后台 · FSP" })

const form = reactive({
  provider: "openai" as LlmProvider,
  baseUrl: "",
  apiKey: "",
  model: "",
  maxTokens: 4096,
})

const loading = ref(true)
const saving = ref(false)
const testing = ref(false)
const testPrompt = ref("")
const message = ref<{ color: "success" | "error" | "warning", title: string, text?: string } | null>(null)
const testResult = ref<{ color: "success" | "error", title: string, text?: string } | null>(null)
const hasExistingKey = ref(false)
const { status, load: loadStatus } = useSystemStatus()

/** 保存后要立刻刷新全局状态，否则其他页面还认为「没配置」 */
async function refreshStatus() {
  await loadStatus(true)
}

const providerOptions = [
  { label: "OpenAI", value: "openai" },
  { label: "Anthropic Claude", value: "anthropic" },
  { label: "自定义（兼容 OpenAI 格式）", value: "custom" },
]

const isCustom = computed(() => form.provider === "custom")

watch(() => form.provider, (provider) => {
  if (provider !== "custom" && provider in LLM_PROVIDER_DEFAULTS) {
    const d = LLM_PROVIDER_DEFAULTS[provider as Exclude<LlmProvider, "custom">]
    form.baseUrl = d.baseUrl
    form.model = d.model
  }
})

onMounted(async () => {
  try {
    const settings = await $fetch<{
      llm: (Omit<typeof form, "apiKey"> & { apiKey: string | null }) | null
    }>("/api/admin/settings")

    if (settings.llm) {
      form.provider = settings.llm.provider
      form.baseUrl = settings.llm.baseUrl
      form.model = settings.llm.model
      form.maxTokens = settings.llm.maxTokens
      hasExistingKey.value = settings.llm.apiKey === null
    } else {
      const d = LLM_PROVIDER_DEFAULTS.openai
      form.baseUrl = d.baseUrl
      form.model = d.model
    }
  } catch {
    message.value = { color: "error", title: "加载配置失败" }
  } finally {
    loading.value = false
  }

  await loadStatus(true)
})

async function onSave() {
  message.value = null
  saving.value = true
  try {
    await $fetch("/api/admin/settings", {
      method: "PUT",
      body: {
        llm: {
          provider: form.provider,
          baseUrl: form.baseUrl,
          apiKey: form.apiKey || undefined,
          model: form.model,
          maxTokens: form.maxTokens,
        },
      },
    })
    message.value = { color: "success", title: "大模型配置已保存" }
    hasExistingKey.value = true
    form.apiKey = ""
    await refreshStatus()
  } catch (error) {
    message.value = { color: "error", title: "保存失败", text: extractMessage(error) }
  } finally {
    saving.value = false
  }
}

async function onTest() {
  testResult.value = null
  testing.value = true
  try {
    const res = await $fetch<{ ok: boolean, message: string, reply?: string }>("/api/admin/test-llm", {
      method: "POST",
      body: { prompt: testPrompt.value || undefined },
    })
    testResult.value = { color: "success", title: res.message, text: res.reply }
  } catch (error) {
    testResult.value = { color: "error", title: "测试失败", text: extractMessage(error) }
  } finally {
    testing.value = false
  }
}

async function onClear() {
  message.value = null
  if (!window.confirm("清除后，AI 访谈、方向推荐与关卡资料生成将立即停用。确定清除？")) return
  try {
    await $fetch("/api/admin/settings", {
      method: "PUT",
      body: { llm: null },
    })
    message.value = { color: "warning", title: "已清除大模型配置", text: "平台 AI 功能已停用，学生无法生成学习计划。" }
    hasExistingKey.value = false
    form.apiKey = ""
    const d = LLM_PROVIDER_DEFAULTS.openai
    form.provider = "openai"
    form.baseUrl = d.baseUrl
    form.model = d.model
    await refreshStatus()
  } catch (error) {
    message.value = { color: "error", title: "清除失败", text: extractMessage(error) }
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
      <h1 class="text-xl font-semibold">大模型 AI 接口配置</h1>
      <UBadge color="error" variant="soft" size="sm">必填</UBadge>
    </div>

    <UCard class="mx-auto max-w-2xl">
      <div v-if="loading" class="py-12 text-center text-muted">加载中…</div>

      <div v-else class="space-y-6">
        <div
          v-if="status && !status.llm.ready"
          class="rounded-lg bg-error/10 px-3 py-2.5 text-sm text-error"
        >
          <p class="font-medium">
            当前未就绪，AI 功能已停用
          </p>
          <p class="mt-1 text-error/80">
            学生端方向访谈将被拦截，且无法生成关卡资料。填写下方配置并发送一次测试请求即可恢复。
          </p>
        </div>

        <UFormField label="提供商">
          <USelect
            v-model="form.provider"
            :items="providerOptions"
            class="w-full"
          />
        </UFormField>

        <UFormField v-if="isCustom" label="Base URL">
          <UInput
            v-model="form.baseUrl"
            placeholder="https://your-api-endpoint/v1"
            class="w-full"
          />
        </UFormField>

        <UFormField v-else label="Base URL">
          <UInput
            :model-value="form.baseUrl"
            disabled
            class="w-full"
          />
        </UFormField>

        <UFormField
          :label="hasExistingKey ? 'API Key（留空不修改）' : 'API Key'"
          help="OpenAI 填 sk-... 格式密钥"
        >
          <UInput
            v-model="form.apiKey"
            type="password"
            :placeholder="hasExistingKey ? '已设置，留空不修改' : '请输入 API Key'"
            class="w-full"
          />
        </UFormField>

        <div class="grid gap-4 sm:grid-cols-2">
          <UFormField label="模型名称">
            <UInput
              v-model="form.model"
              placeholder="gpt-4o / claude-3-5-sonnet-..."
              class="w-full"
            />
          </UFormField>

          <UFormField label="最大输出 Token">
            <UInput
              v-model.number="form.maxTokens"
              type="number"
              placeholder="4096"
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

        <div class="flex gap-3">
          <UButton :loading="saving" @click="onSave">保存配置</UButton>
          <UButton variant="outline" color="error" @click="onClear">清除配置</UButton>
        </div>

        <USeparator label="测试连接" />

        <UFormField label="测试提示词（可选）" help="留空则发送默认测试消息">
          <UInput
            v-model="testPrompt"
            placeholder="你好，请回复测试成功"
            class="w-full"
          />
        </UFormField>

        <UButton variant="outline" :loading="testing" @click="onTest">发送测试请求</UButton>

        <UAlert
          v-if="testResult"
          :color="testResult.color"
          :title="testResult.title"
          :description="testResult.text"
        />
      </div>
    </UCard>
  </UContainer>
</template>
