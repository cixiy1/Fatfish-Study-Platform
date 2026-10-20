<script setup lang="ts">
type PathNodeState = "done" | "current" | "locked" | "todo"

const props = defineProps<{
  index: number
  name: string
  state: PathNodeState
  to: string | null
}>()

const icon = computed(
  () =>
    ({
      done: "i-lucide-check",
      current: "i-lucide-play",
      locked: "i-lucide-lock",
      todo: "i-lucide-circle",
    })[props.state],
)

const circleClass = computed(
  () =>
    ({
      done: "bg-primary text-inverted ring-4 ring-primary/15",
      current: "bg-primary text-inverted ring-8 ring-primary/20",
      locked: "bg-elevated text-muted ring-4 ring-default",
      todo: "bg-elevated text-muted ring-4 ring-default",
    })[props.state],
)

const clickable = computed(() => props.to !== null && props.state !== "locked")
</script>

<template>
  <div class="flex w-28 flex-col items-center gap-2">
    <NuxtLink
      v-if="clickable"
      :to="to!"
      class="grid size-16 place-items-center rounded-full shadow-sm transition hover:scale-105 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-primary"
      :class="circleClass"
      :aria-label="`第 ${index} 关：${name}`"
    >
      <UIcon :name="icon" class="size-6" />
    </NuxtLink>

    <button
      v-else
      type="button"
      disabled
      class="grid size-16 cursor-not-allowed place-items-center rounded-full transition"
      :class="circleClass"
      :aria-label="`第 ${index} 关：${name}（未解锁）`"
    >
      <UIcon :name="icon" class="size-5" />
    </button>

    <span
      class="line-clamp-2 text-center text-xs leading-tight"
      :class="state === 'locked' ? 'text-muted' : 'text-default'"
    >
      {{ name }}
    </span>
  </div>
</template>
