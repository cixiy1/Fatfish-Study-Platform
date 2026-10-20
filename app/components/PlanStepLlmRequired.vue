<script setup lang="ts">
/**
 * 大模型未配置时的阻断页。
 *
 * 大模型是平台的强依赖，没有它整个引导流程一步都走不了，
 * 所以这里不做「先跳过」的假入口，只给配置路径和重新检测。
 */
const props = defineProps<{
  reason: string
  configured: boolean
  model: string | null
  isAdmin: boolean
  checking: boolean
}>()

defineEmits<{ retry: [] }>()

const steps = [
  "准备 API Key：支持华为云 MaaS、DeepSeek、通义、智谱等 OpenAI 兼容服务，或 Anthropic",
  "进入「管理后台 → 大模型配置」，选择提供商，填写 Base URL、API Key 与模型名称并保存",
  "点击「发送测试请求」确认模型可响应，再返回本页重新检测",
]

const target = computed(() => (props.isAdmin ? "/admin/llm" : "/"))
</script>

<template>
  <div class="mx-auto max-w-xl py-6">
    <div class="flex items-start gap-4">
      <span class="grid size-12 shrink-0 place-items-center rounded-2xl bg-error/10 text-error">
        <UIcon name="i-lucide-plug-zap" class="size-6" />
      </span>
      <div class="min-w-0">
        <h2 class="text-lg font-semibold">
          需要先配置大模型
        </h2>
        <p class="mt-1 text-sm text-muted">
          {{ reason }}
        </p>
      </div>
    </div>

    <ol class="mt-6 space-y-3">
      <li v-for="(item, index) in steps" :key="index" class="flex gap-3 text-sm">
        <span class="grid size-6 shrink-0 place-items-center rounded-full bg-elevated text-xs font-medium tabular-nums">
          {{ index + 1 }}
        </span>
        <span class="text-muted">{{ item }}</span>
      </li>
    </ol>

    <div v-if="configured" class="mt-5 rounded-lg bg-warning/10 px-3 py-2.5 text-sm text-warning">
      已有配置{{ model ? `（模型 ${model}）` : "" }}，但状态异常。重新保存一次 API Key 通常可恢复。
    </div>

    <div class="mt-6 flex flex-wrap items-center gap-3">
      <UButton
        v-if="isAdmin"
        :to="target"
        size="lg"
        icon="i-lucide-settings"
        label="前往配置"
      />
      <UButton
        variant="outline"
        size="lg"
        :loading="checking"
        icon="i-lucide-refresh-cw"
        label="重新检测"
        @click="$emit('retry')"
      />
    </div>

    <p v-if="!isAdmin" class="mt-3 text-xs text-muted">
      请联系管理员完成配置，配置后刷新本页。
    </p>
    <p v-else class="mt-3 text-xs text-muted">
      配置入口：管理后台 → 大模型配置。保存后建议先发送一次测试请求。
    </p>
  </div>
</template>
