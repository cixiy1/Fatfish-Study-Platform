<script setup lang="ts">
type PathNodeState = "done" | "current" | "locked" | "todo"

interface MapItem {
  id: number
  name: string
  status: string
}

const props = defineProps<{ items: MapItem[] }>()

/** 蛇形偏移：正负交替，8 个一循环，移动端也不会横向溢出 */
const OFFSETS = [0, 28, 52, 28, 0, -28, -52, -28]

/**
 * 三态推导：
 * - 已完成 → done
 * - 第一关，或上一关已完成 → current
 * - 否则 locked
 */
function stateOf(index: number): PathNodeState {
  const item = props.items[index]
  if (!item) return "todo"
  if (item.status === "completed") return "done"
  const previousDone = index === 0 || props.items[index - 1]?.status === "completed"
  return previousDone ? "current" : "locked"
}

function offsetOf(index: number) {
  return OFFSETS[index % OFFSETS.length] ?? 0
}
</script>

<template>
  <div class="flex flex-col items-center py-4">
    <div
      v-for="(item, index) in items"
      :key="item.id"
      class="flex flex-col items-center"
      :style="{ transform: `translateX(${offsetOf(index)}px)` }"
    >
      <PathNode
        :index="index + 1"
        :name="item.name"
        :state="stateOf(index)"
        :to="stateOf(index) === 'locked' ? null : `/learn/${item.id}`"
      />

      <!-- 关卡之间的连接线，制造"一条路"的连续感 -->
      <span
        v-if="index < items.length - 1"
        class="my-1 h-6 border-l-2 border-dashed border-default"
        aria-hidden="true"
      />
    </div>

    <p v-if="items.length === 0" class="py-10 text-sm text-muted">
      暂无关卡。请先制定学习计划生成路径。
    </p>
  </div>
</template>
