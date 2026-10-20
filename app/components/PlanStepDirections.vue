<script setup lang="ts">
import type { DirectionCandidate } from "#shared/types/direction"

/**
 * 模型给出的方向候选（1~3 个）。
 * 展示匹配度、理由、技能数与预计周数，帮助用户判断选哪个。
 */
const props = defineProps<{
  directions: DirectionCandidate[]
  selectedIndex: number | null
  mock: boolean
}>()

const emit = defineEmits<{ select: [index: number] }>()

/** 技能总数 = 技能库里的 + 模型现场提出的 */
function skillTotal(direction: DirectionCandidate): number {
  return direction.skillIds.length + (direction.newSkills?.length ?? 0)
}
</script>

<template>
  <div>
    <h1 class="text-2xl font-semibold tracking-tight sm:text-3xl">推荐学习方向</h1>
    <p class="mt-2 text-sm text-muted">选择一个方向继续，后续可随时更换。</p>

    <p v-if="props.mock" class="mt-3 inline-flex items-center gap-1.5 rounded-full bg-warning/10 px-3 py-1 text-xs text-warning">
      <UIcon name="i-lucide-flask-conical" class="size-3.5" />
      演示数据：未配置大模型，方向来自内置示例
    </p>

    <div class="mt-6 space-y-3">
      <button
        v-for="(direction, index) in directions"
        :key="direction.name"
        type="button"
        class="w-full rounded-xl border-2 p-4 text-left transition"
        :class="
          selectedIndex === index
            ? 'border-primary bg-primary/5'
            : 'border-default hover:border-primary/40 hover:bg-elevated'
        "
        :aria-pressed="selectedIndex === index"
        @click="emit('select', index)"
      >
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <p class="truncate font-medium">{{ direction.name }}</p>
            <p class="mt-1 text-xs text-muted">
              {{ direction.category }} · {{ skillTotal(direction) }} 个技能 · 约 {{ direction.estimatedWeeks }} 周
            </p>
          </div>
          <span class="shrink-0 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary tabular-nums">
            匹配 {{ direction.matchScore }}%
          </span>
        </div>

        <p class="mt-2.5 text-sm leading-relaxed text-muted">{{ direction.reason }}</p>

        <div v-if="direction.previewSkills?.length" class="mt-2.5 flex flex-wrap gap-1.5">
          <span
            v-for="skill in direction.previewSkills"
            :key="skill"
            class="rounded-md bg-elevated px-2 py-0.5 text-xs text-muted"
          >
            {{ skill }}
          </span>
        </div>

        <UIcon
          v-if="selectedIndex === index"
          name="i-lucide-circle-check"
          class="mt-2 size-5 text-primary"
        />
      </button>
    </div>
  </div>
</template>
