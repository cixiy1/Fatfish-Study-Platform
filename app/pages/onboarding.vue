<script setup lang="ts">
definePageMeta({ auth: true })

useHead({ title: "选择学习方向 · FSP" })

interface Position {
  id: number
  name: string
  category: string
  description: string | null
  icon: string | null
  skill_count: number
}

const { resolveUser } = useAuthSession()

const loading = ref(true)
const generating = ref(false)
const positions = ref<Position[]>([])
const selectedId = ref<number | null>(null)
const message = ref<{ color: "success" | "error" | "warning", text: string } | null>(null)

onMounted(async () => {
  try {
    positions.value = await $fetch<Position[]>("/api/positions")
  } catch {
    message.value = { color: "error", text: "加载岗位列表失败" }
  } finally {
    loading.value = false
  }
})

async function startLearning() {
  if (!selectedId.value) return
  generating.value = true
  message.value = null
  try {
    await $fetch("/api/learning-path/generate", {
      method: "POST",
      body: { position_id: selectedId.value },
    })
    await resolveUser(true)
    await navigateTo("/learning", { replace: true })
  } catch (error) {
    const data = (error as { data?: { message?: string } })?.data
    message.value = { color: "error", text: data?.message || "生成学习路径失败" }
  } finally {
    generating.value = false
  }
}
</script>

<template>
  <div class="min-h-dvh bg-gradient-to-br from-primary-50 to-neutral-50 dark:from-primary-950 dark:to-neutral-950">
    <UContainer class="py-16">
      <div class="mx-auto max-w-3xl">
        <div class="text-center">
          <h1 class="text-3xl font-bold tracking-tight">选择你的学习方向</h1>
          <p class="mt-3 text-muted">
            选择一个目标岗位，系统将为你生成个性化的学习路径
          </p>
        </div>

        <UAlert
          v-if="message"
          :color="message.color"
          :title="message.text"
          class="mt-6"
        />

        <div v-if="loading" class="py-20 text-center text-muted">加载中…</div>

        <div v-else class="mt-10 grid gap-4 sm:grid-cols-2">
          <UCard
            v-for="p in positions"
            :key="p.id"
            class="cursor-pointer transition hover:shadow-lg"
            :class="selectedId === p.id ? 'ring-2 ring-primary' : ''"
            @click="selectedId = p.id"
          >
            <div class="flex items-start gap-3">
              <div class="rounded-lg bg-elevated p-2.5">
                <UIcon :name="p.icon || 'i-lucide-briefcase'" class="text-xl" />
              </div>
              <div class="flex-1">
                <div class="flex items-center gap-2">
                  <h3 class="font-semibold">{{ p.name }}</h3>
                  <UBadge size="sm" variant="soft">{{ p.skill_count }} 技能</UBadge>
                </div>
                <p class="mt-1 text-sm text-muted">{{ p.description || p.category }}</p>
              </div>
            </div>
          </UCard>
        </div>

        <div v-if="!loading && selectedId" class="mt-8 text-center">
          <UButton
            size="lg"
            :loading="generating"
            label="开始学习"
            @click="startLearning"
          />
        </div>
      </div>
    </UContainer>
  </div>
</template>
