<script setup lang="ts">
/**
 * 长请求的等待反馈。
 *
 * 同步生成整套资料要几十秒，只转圈会让人以为卡死，
 * 所以按已用时间切换阶段文案，并显示计时器。
 */
const props = withDefaults(defineProps<{ title?: string }>(), {
  title: "正在生成",
})

const seconds = ref(0)
let timer: ReturnType<typeof setInterval> | null = null

onMounted(() => {
  timer = setInterval(() => {
    seconds.value += 1
  }, 1000)
})

onUnmounted(() => {
  if (timer) clearInterval(timer)
})

const phase = computed(() => {
  if (seconds.value < 5) return "正在分析回答"
  if (seconds.value < 20) return "正在拆解技能点"
  if (seconds.value < 60) return "正在撰写关卡正文"
  return "正在校验生成结果"
})

const elapsed = computed(() => {
  const minutes = Math.floor(seconds.value / 60)
  const rest = seconds.value % 60
  return minutes > 0 ? `${minutes} 分 ${rest} 秒` : `${rest} 秒`
})
</script>

<template>
  <div class="rounded-xl border border-default p-5" role="status" aria-live="polite">
    <div class="flex items-center gap-3">
      <UIcon name="i-lucide-sparkles" class="size-5 shrink-0 text-primary" />
      <p class="font-medium">{{ props.title }}</p>
      <span class="ml-auto text-xs tabular-nums text-muted">{{ elapsed }}</span>
    </div>

    <div class="mt-4 h-1.5 overflow-hidden rounded-full bg-elevated">
      <div class="h-full w-1/3 animate-pulse rounded-full bg-primary" />
    </div>

    <p class="mt-3 text-sm text-muted">{{ phase }}</p>
  </div>
</template>
