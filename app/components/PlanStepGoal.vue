<script setup lang="ts">
/** 每日学习目标：三档固定选项，对应到每天可完成的关卡数 */
const GOALS = [
  { minutes: 10, title: "轻度", desc: "每天 10 分钟 · 约 1 关", icon: "i-lucide-coffee" },
  { minutes: 20, title: "标准", desc: "每天 20 分钟 · 约 2 关", icon: "i-lucide-book-open" },
  { minutes: 40, title: "强化", desc: "每天 40 分钟 · 约 4 关", icon: "i-lucide-rocket" },
]

const selected = defineModel<number | null>({ default: null })
</script>

<template>
  <div>
    <h1 class="text-2xl font-semibold tracking-tight sm:text-3xl">设定每日学习时长</h1>
    <p class="mt-2 text-sm text-muted">选择可长期保持的节奏，之后可在「计划设置」中调整。</p>

    <div class="mt-8 space-y-3">
      <button
        v-for="g in GOALS"
        :key="g.minutes"
        type="button"
        class="flex w-full items-center gap-4 rounded-xl border-2 p-4 text-left transition"
        :class="
          selected === g.minutes
            ? 'border-primary bg-primary/5'
            : 'border-default hover:border-primary/40 hover:bg-elevated'
        "
        :aria-pressed="selected === g.minutes"
        @click="selected = g.minutes"
      >
        <span class="grid size-11 shrink-0 place-items-center rounded-lg bg-elevated">
          <UIcon :name="g.icon" class="size-5" />
        </span>
        <span class="flex-1">
          <span class="block font-medium">{{ g.title }}</span>
          <span class="block text-sm text-muted">{{ g.desc }}</span>
        </span>
        <UIcon
          v-if="selected === g.minutes"
          name="i-lucide-circle-check"
          class="size-5 text-primary"
        />
      </button>
    </div>
  </div>
</template>
