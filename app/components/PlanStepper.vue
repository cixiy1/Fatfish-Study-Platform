<script setup lang="ts">
/**
 * 三步引导外壳：顶部进度条 + 可回退 + 内容槽。
 * 一次只问一个问题，点选即前进（多邻国的做法）。
 */
const props = withDefaults(
  defineProps<{
    step: number
    total?: number
    canBack?: boolean
  }>(),
  { total: 3, canBack: false },
)

const emit = defineEmits<{ back: [] }>()

const width = computed(() => `${Math.round((props.step / props.total) * 100)}%`)
</script>

<template>
  <div class="mx-auto flex min-h-dvh w-full max-w-2xl flex-col px-5 py-6">
    <header class="flex items-center gap-3">
      <UButton
        v-if="canBack"
        variant="ghost"
        color="neutral"
        size="sm"
        icon="i-lucide-arrow-left"
        aria-label="返回上一步"
        @click="emit('back')"
      />
      <div class="h-2 flex-1 overflow-hidden rounded-full bg-elevated">
        <div
          class="h-full rounded-full bg-primary transition-[width] duration-300 ease-out"
          :style="{ width }"
        />
      </div>
      <span class="text-xs tabular-nums text-muted">{{ step }}/{{ total }}</span>
    </header>

    <div class="flex-1 py-10">
      <slot />
    </div>

    <footer class="pb-2">
      <slot name="footer" />
    </footer>
  </div>
</template>
