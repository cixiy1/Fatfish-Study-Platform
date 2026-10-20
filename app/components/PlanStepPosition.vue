<script setup lang="ts">
export interface PlanPosition {
  id: number
  name: string
  category: string
  description: string | null
  icon: string | null
  skill_count: number
}

const props = defineProps<{
  positions: PlanPosition[]
  loading: boolean
}>()

const selected = defineModel<number | null>({ default: null })

function pick(id: number) {
  selected.value = id
}
</script>

<template>
  <div>
    <h1 class="text-2xl font-semibold tracking-tight sm:text-3xl">选择学习方向</h1>
    <p class="mt-2 text-sm text-muted">以下方向已预设技能点，选择后可直接生成关卡。</p>

    <div v-if="loading" class="mt-10 text-sm text-muted">正在加载方向…</div>

    <div v-else class="mt-8 grid gap-3 sm:grid-cols-2">
      <button
        v-for="p in positions"
        :key="p.id"
        type="button"
        class="flex items-start gap-3 rounded-xl border-2 p-4 text-left transition"
        :class="
          selected === p.id
            ? 'border-primary bg-primary/5'
            : 'border-default hover:border-primary/40 hover:bg-elevated'
        "
        :aria-pressed="selected === p.id"
        @click="pick(p.id)"
      >
        <span class="grid size-10 shrink-0 place-items-center rounded-lg bg-elevated">
          <UIcon :name="p.icon || 'i-lucide-compass'" class="size-5" />
        </span>
        <span class="min-w-0">
          <span class="flex items-center gap-2">
            <span class="font-medium">{{ p.name }}</span>
            <UBadge size="sm" variant="soft" color="neutral">{{ p.skill_count }} 技能</UBadge>
          </span>
          <span class="mt-1 block line-clamp-2 text-sm text-muted">
            {{ p.description || p.category }}
          </span>
        </span>
      </button>
    </div>

    <p v-if="!loading && positions.length === 0" class="mt-10 text-sm text-muted">
      暂无预设方向。请先在访谈中描述学习目标，或联系管理员初始化技能库。
    </p>
  </div>
</template>
