<script setup lang="ts">
/**
 * 学习路径生成中的逐条渲染列表。
 *
 * 先按技能数铺满骨架槽位，模型每写完一个技能点，
 * 对应的槽位就「就地变形」成真实关卡卡片——而不是等全部完成再一次性出现。
 * 槽位按 index 固定，不做数组追加，避免列表跳动。
 */

export interface GenRow {
  skillId: number
  /** 1-based 序号，同时作为固定槽位 */
  index: number
  name: string
  status: "pending" | "writing" | "ok" | "failed"
  material?: {
    title: string
    summary: string
    objectives: string[]
    minutes: number
    difficulty: string
  }
  reason?: string
  attempt?: number
}

const props = defineProps<{
  rows: GenRow[]
  elapsedMs: number
  title?: string
}>()

const done = computed(() => props.rows.filter(r => r.status === "ok").length)
const percent = computed(() =>
  props.rows.length === 0 ? 0 : Math.round((done.value / props.rows.length) * 100),
)
const elapsedSeconds = computed(() => Math.floor(props.elapsedMs / 1000))

const difficultyLabel = (value: string) => {
  if (value === "beginner") return "入门"
  if (value === "intermediate") return "进阶"
  if (value === "advanced") return "高阶"
  return value
}
</script>

<template>
  <div class="rounded-xl border border-default bg-elevated/30 p-5">
    <div class="mb-4 flex items-center justify-between gap-3">
      <div class="flex items-center gap-2">
        <div class="size-2 animate-pulse rounded-full bg-primary" />
        <span class="text-sm font-medium">{{ title ?? "大模型正在撰写关卡内容" }}</span>
      </div>
      <span class="text-xs text-muted tabular-nums">{{ elapsedSeconds }}s</span>
    </div>

    <UProgress :model-value="percent" class="mb-1" />
    <p class="mb-5 text-xs text-muted tabular-nums">
      已完成 {{ done }} / {{ rows.length }} 个技能点
    </p>

    <ul class="space-y-3">
      <li v-for="row in rows" :key="row.skillId">
        <!-- 已完成：真实关卡卡片 -->
        <div
          v-if="row.status === 'ok' && row.material"
          class="rounded-lg border border-default bg-default p-4 transition-all duration-200"
        >
          <div class="flex items-start gap-3">
            <UBadge color="success" variant="soft" size="sm" class="mt-0.5 shrink-0 tabular-nums">
              {{ row.index }}
            </UBadge>
            <div class="min-w-0 flex-1">
              <p class="font-medium">{{ row.material.title }}</p>
              <p class="mt-1 text-sm text-muted">{{ row.material.summary }}</p>

              <div v-if="row.material.objectives.length > 0" class="mt-2.5 flex flex-wrap gap-1.5">
                <UBadge
                  v-for="objective in row.material.objectives"
                  :key="objective"
                  color="neutral"
                  variant="outline"
                  size="sm"
                >
                  {{ objective }}
                </UBadge>
              </div>

              <div class="mt-2.5 flex items-center gap-2 text-xs text-muted">
                <UIcon name="i-lucide-clock" class="size-3.5" />
                <span>{{ row.material.minutes }} 分钟</span>
                <UDivider orientation="vertical" class="h-3" />
                <span>{{ difficultyLabel(row.material.difficulty) }}</span>
              </div>
            </div>
          </div>
        </div>

        <!-- 生成失败：占位 + 原因 -->
        <div
          v-else-if="row.status === 'failed'"
          class="rounded-lg border border-error/30 bg-error/5 p-4"
        >
          <div class="flex items-start gap-3">
            <UBadge color="error" variant="soft" size="sm" class="mt-0.5 shrink-0 tabular-nums">
              {{ row.index }}
            </UBadge>
            <div class="min-w-0 flex-1">
              <p class="text-sm font-medium text-error">{{ row.name }} 未生成</p>
              <p v-if="row.reason" class="mt-1 text-xs text-muted">{{ row.reason }}</p>
            </div>
          </div>
        </div>

        <!-- 撰写中 / 待开始：骨架槽位 -->
        <div v-else class="rounded-lg border border-dashed border-default p-4">
          <div class="flex items-start gap-3">
            <UBadge color="neutral" variant="soft" size="sm" class="mt-0.5 shrink-0 tabular-nums">
              {{ row.index }}
            </UBadge>
            <div class="min-w-0 flex-1">
              <USkeleton class="h-4 w-2/5" />
              <USkeleton class="mt-2 h-3 w-4/5" />
              <p class="mt-2.5 text-xs text-muted">
                <span v-if="row.status === 'writing'">
                  正在撰写「{{ row.name }}」…
                  <span v-if="row.attempt && row.attempt > 1" class="text-warning">
                    （第 {{ row.attempt }} 次尝试）
                  </span>
                </span>
                <span v-else>{{ row.name }}</span>
              </p>
            </div>
          </div>
        </div>
      </li>
    </ul>
  </div>
</template>
