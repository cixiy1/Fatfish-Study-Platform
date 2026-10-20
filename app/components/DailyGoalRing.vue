<script setup lang="ts">
/**
 * 今日目标进度环。纯 SVG，不引图表库。
 * done/total 变化时用 CSS transition 过渡 stroke-dashoffset。
 */
const props = withDefaults(
  defineProps<{
    done: number
    total: number
    size?: number
    stroke?: number
    showText?: boolean
  }>(),
  { size: 72, stroke: 6, showText: true },
)

const radius = computed(() => (props.size - props.stroke) / 2)
const circumference = computed(() => 2 * Math.PI * radius.value)
const ratio = computed(() => {
  if (!props.total) return 0
  return Math.min(1, Math.max(0, props.done / props.total))
})
const dashOffset = computed(() => circumference.value * (1 - ratio.value))
const percent = computed(() => Math.round(ratio.value * 100))
</script>

<template>
  <div class="relative inline-grid place-items-center" :style="{ width: `${size}px`, height: `${size}px` }">
    <svg :width="size" :height="size" class="-rotate-90" aria-hidden="true">
      <circle
        :cx="size / 2"
        :cy="size / 2"
        :r="radius"
        fill="none"
        class="stroke-elevated"
        :stroke-width="stroke"
      />
      <circle
        :cx="size / 2"
        :cy="size / 2"
        :r="radius"
        fill="none"
        class="stroke-primary transition-[stroke-dashoffset] duration-500 ease-out"
        :stroke-width="stroke"
        stroke-linecap="round"
        :stroke-dasharray="circumference"
        :stroke-dashoffset="dashOffset"
      />
    </svg>
    <div v-if="showText" class="absolute text-center leading-none">
      <div class="text-sm font-semibold tabular-nums">{{ percent }}%</div>
      <div class="mt-0.5 text-[10px] text-muted">{{ done }}/{{ total }}</div>
    </div>
  </div>
</template>
