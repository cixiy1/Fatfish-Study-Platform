<script setup lang="ts">
/**
 * 顶部/仪表盘的小徽章：连胜、XP、今日进度都用它，保证数值样式一致。
 */
withDefaults(
  defineProps<{
    icon: string
    value: string | number
    label?: string
    tone?: "flame" | "xp" | "goal"
  }>(),
  { label: "", tone: "xp" },
)

const toneClass: Record<string, string> = {
  flame: "text-orange-600 dark:text-orange-400",
  xp: "text-amber-600 dark:text-amber-400",
  goal: "text-primary",
}
</script>

<template>
  <div class="flex items-center gap-1.5 rounded-full bg-elevated px-2.5 py-1 text-xs font-medium">
    <UIcon :name="icon" class="size-3.5" :class="toneClass[tone]" />
    <span class="tabular-nums">{{ value }}</span>
    <span v-if="label" class="text-muted">{{ label }}</span>
  </div>
</template>
