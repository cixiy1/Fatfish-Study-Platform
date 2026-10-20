<script setup lang="ts">
/** 确认页：把前两步的选择摊开，降低「点下去会发生什么」的不确定感 */
const props = defineProps<{
  positionName: string
  skillCount: number
  minutes: number
  submitting: boolean
  errorText: string
  /** 未接入大模型时为 true：关卡正文会用离线模板，不能假装是 AI 写的 */
  offline?: boolean
}>()

const emit = defineEmits<{ submit: [] }>()

/** 粗略估算：一个技能点按 20 分钟关卡计算 */
const days = computed(() => {
  if (!props.minutes) return 0
  return Math.max(1, Math.ceil((props.skillCount * 20) / props.minutes))
})
</script>

<template>
  <div>
    <h1 class="text-2xl font-semibold tracking-tight sm:text-3xl">确认计划</h1>
    <p class="mt-2 text-sm text-muted">确认后生成完整关卡路径与学习资料，过程约数十秒。</p>

    <div class="mt-8 space-y-3 rounded-xl border border-default p-5">
      <div class="flex items-center justify-between text-sm">
        <span class="text-muted">学习方向</span>
        <span class="font-medium">{{ positionName }}</span>
      </div>
      <div class="flex items-center justify-between text-sm">
        <span class="text-muted">每日目标</span>
        <span class="font-medium">{{ minutes }} 分钟</span>
      </div>
      <div class="flex items-center justify-between text-sm">
        <span class="text-muted">技能关卡</span>
        <span class="font-medium">{{ skillCount }} 个</span>
      </div>
      <div class="flex items-center justify-between border-t border-default pt-3 text-sm">
        <span class="text-muted">预计完成</span>
        <span class="font-medium">约 {{ days }} 天</span>
      </div>
    </div>

    <p v-if="errorText" class="mt-4 rounded-lg bg-error/10 px-3 py-2 text-sm text-error">
      {{ errorText }}
    </p>

    <div
      v-if="offline"
      class="mt-4 flex items-start gap-2 rounded-lg bg-warning/10 px-3 py-2.5 text-sm text-warning"
    >
      <UIcon name="i-lucide-triangle-alert" class="mt-0.5 size-4 shrink-0" />
      <span>
        当前未配置大模型，关卡正文将使用离线模板：结构完整，但非针对本人生成。
        配置 API Key 后重新生成即可替换为真实内容。
      </span>
    </div>

    <div class="mt-8">
      <UButton
        block
        size="lg"
        :loading="submitting"
        label="生成学习计划"
        icon="i-lucide-arrow-right"
        @click="emit('submit')"
      />
    </div>
  </div>
</template>
