<script setup lang="ts">
/**
 * 每日学习时长：三档快捷选择 + 自定义数字/滑杆。
 *
 * 只用三个固定档位时，每天能学 15 分钟的人只能二选一，节奏一开始就不合身；
 * 这里允许任何 5~240 分钟的值，并即时换算成每天大概能推进几关。
 */
const GOALS = [
  { minutes: 10, title: "轻度", desc: "约 1 关 / 天", icon: "i-lucide-coffee" },
  { minutes: 20, title: "标准", desc: "约 2 关 / 天", icon: "i-lucide-book-open" },
  { minutes: 40, title: "强化", desc: "约 4 关 / 天", icon: "i-lucide-rocket" },
]

const MIN_MINUTES = 5
const MAX_MINUTES = 240

const selected = defineModel<number | null>({ default: null })

/** 输入框里的原始值，避免清空时立刻被钳到最小值 */
const draft = ref(selected.value ? String(selected.value) : "")

watch(selected, (value) => {
  if (value && String(value) !== draft.value) draft.value = String(value)
})

const clamped = computed(() => {
  const value = Number(selected.value)
  return Number.isFinite(value) && value > 0 ? value : MIN_MINUTES
})

/** 按每天 10 分钟约 1 关的粒度估算，只用于给个直观的量级 */
const levelsPerDay = computed(() => Math.max(1, Math.round(clamped.value / 10)))
const levelsPerWeek = computed(() => levelsPerDay.value * 7)

function commit(raw: string) {
  draft.value = raw
  const value = Number(raw)
  if (!Number.isFinite(value) || value <= 0) {
    selected.value = null
    return
  }
  selected.value = Math.min(MAX_MINUTES, Math.max(MIN_MINUTES, Math.round(value)))
}

function pick(minutes: number) {
  selected.value = minutes
  draft.value = String(minutes)
}
</script>

<template>
  <div>
    <h1 class="text-2xl font-semibold tracking-tight sm:text-3xl">设定每天的学习节奏</h1>
    <p class="mt-2 text-sm text-muted">选一个能长期保持的量，之后可以在「计划设置」里随时调整。</p>

    <div class="mt-7 grid gap-3 sm:grid-cols-3">
      <button
        v-for="g in GOALS"
        :key="g.minutes"
        type="button"
        class="flex items-center gap-3 rounded-xl border-2 p-4 text-left transition"
        :class="
          selected === g.minutes
            ? 'border-primary bg-primary/5'
            : 'border-default hover:border-primary/40 hover:bg-elevated'
        "
        :aria-pressed="selected === g.minutes"
        @click="pick(g.minutes)"
      >
        <span class="grid size-10 shrink-0 place-items-center rounded-lg bg-elevated">
          <UIcon :name="g.icon" class="size-5" />
        </span>
        <span class="flex-1">
          <span class="block font-medium">{{ g.title }}</span>
          <span class="block text-sm text-muted">{{ g.desc }}</span>
        </span>
        <UIcon
          v-if="selected === g.minutes"
          name="i-lucide-circle-check"
          class="size-5 shrink-0 text-primary"
        />
      </button>
    </div>

    <div class="mt-4 rounded-xl border border-default p-4">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p class="text-sm font-medium">自定义时长</p>
          <p class="mt-0.5 text-xs text-muted">5~240 分钟之间，按自己的实际情况来</p>
        </div>
        <div class="flex items-center gap-2">
          <UInput
            :model-value="draft"
            type="number"
            :min="MIN_MINUTES"
            :max="MAX_MINUTES"
            step="5"
            size="lg"
            class="w-24"
            aria-label="每天学习分钟数"
            @update:model-value="commit(String($event ?? ''))"
          />
          <span class="text-sm text-muted">分钟 / 天</span>
        </div>
      </div>

      <input
        type="range"
        :min="MIN_MINUTES"
        :max="MAX_MINUTES"
        step="5"
        :value="clamped"
        class="mt-4 w-full accent-primary"
        aria-label="拖动选择每天学习分钟数"
        @input="commit(($event.target as HTMLInputElement).value)"
      >
      <div class="mt-1 flex justify-between text-xs text-muted">
        <span>5 分钟</span>
        <span>240 分钟</span>
      </div>
    </div>

    <p class="mt-4 text-sm" :class="selected ? 'text-default' : 'text-muted'">
      <template v-if="selected">
        每天 {{ selected }} 分钟，大约每天 {{ levelsPerDay }} 关、一周 {{ levelsPerWeek }} 关。
      </template>
      <template v-else>选一个档位或填个数字，下面会显示对应的推进速度。</template>
    </p>
  </div>
</template>
