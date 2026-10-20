<script setup lang="ts">

useHead({ title: "技能图谱 · FSP" })

interface Position {
  id: number
  name: string
  category: string
  description: string | null
  icon: string | null
  skill_count: number
}

const loading = ref(true)
const positions = ref<Position[]>([])

onMounted(async () => {
  try {
    positions.value = await $fetch<Position[]>("/api/positions")
  } catch {

    // 忽略

  } finally {
    loading.value = false
  }
})

const categoryColor: Record<string, string> = {
  IT: "primary",
  数据: "success",
  AI: "warning",
  制造: "secondary",
}
</script>

<template>
  <UContainer class="py-10">
    <div class="mb-8">
      <h1 class="text-2xl font-semibold tracking-tight">技能图谱</h1>
      <p class="mt-1 text-sm text-muted">按方向查看技能分层与掌握情况</p>
    </div>

    <div v-if="loading" class="py-20 text-center text-muted">加载中…</div>

    <div v-else class="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
      <UCard
        v-for="p in positions"
        :key="p.id"
        class="cursor-pointer transition hover:shadow-lg"
        @click="navigateTo(`/positions/${p.id}`)"
      >
        <div class="flex items-start gap-4">
          <div class="rounded-lg bg-elevated p-3">
            <UIcon :name="p.icon || 'i-lucide-compass'" class="text-2xl" />
          </div>
          <div class="flex-1">
            <div class="flex items-center gap-2">
              <h3 class="font-semibold">{{ p.name }}</h3>
              <UBadge :color="categoryColor[p.category] || 'neutral'" variant="soft" size="sm">{{ p.category }}</UBadge>
            </div>
            <p class="mt-1 text-sm text-muted">{{ p.description }}</p>
            <p class="mt-2 text-xs text-muted">{{ p.skill_count }} 个技能点</p>
          </div>
        </div>
      </UCard>
    </div>
  </UContainer>
</template>
