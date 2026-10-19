<script setup lang="ts">
definePageMeta({ layout: 'learning' })

useHead({ title: "个性化导学 · FSP" })

interface Position { id: number, name: string, category: string }
interface PathItem { id: number, skill_id: number | null, resource_id: number | null, sort_order: number, status: string }
interface LearningPath { id: number, name: string, target_position_id: number | null, status: string, created_at: string, items: PathItem[] }
interface Skill { id: number, name: string }
interface Resource { id: number, title: string }

const loading = ref(true)
const generating = ref(false)
const paths = ref<LearningPath[]>([])
const positions = ref<Position[]>([])
const positionOptions = ref<{ label: string, value: number }[]>([])
const selectedPosition = ref<number | null>(null)
const message = ref<{ color: "success" | "error" | "warning", text: string } | null>(null)
const skillMap = ref<Map<number, string>>(new Map())
const resourceMap = ref<Map<number, string>>(new Map())

async function loadPaths() {
  loading.value = true
  try {
    paths.value = await $fetch<LearningPath[]>("/api/learning-path")
    const skillIds = new Set<number>()
    const resourceIds = new Set<number>()
    for (const p of paths.value) {
      for (const item of p.items) {
        if (item.skill_id) skillIds.add(item.skill_id)
        if (item.resource_id) resourceIds.add(item.resource_id)
      }
    }
    if (skillIds.size > 0) {
      const data = await $fetch<{ skills: Skill[] }>("/api/skills")
      skillMap.value = new Map(data.skills.map((s) => [s.id, s.name]))
    }
    if (resourceIds.size > 0) {
      const resources = await $fetch<Resource[]>("/api/resources")
      resourceMap.value = new Map(resources.map((r) => [r.id, r.title]))
    }
  } catch {
  } finally {
    loading.value = false
  }
}

async function loadPositions() {
  try {
    const data = await $fetch<Position[]>("/api/positions")
    positions.value = data
    positionOptions.value = data.map((p) => ({ label: p.name, value: p.id }))
  } catch {
  }
}

onMounted(() => {
  loadPaths()
  loadPositions()
})

async function generate() {
  if (!selectedPosition.value) return
  generating.value = true
  message.value = null
  try {
    const res = await $fetch<{ ok: boolean, gapCount: number }>("/api/learning-path/generate", {
      method: "POST",
      body: { position_id: selectedPosition.value },
    })
    message.value = { color: "success", text: `学习路径已生成，共 ${res.gapCount} 个待学习技能` }
    selectedPosition.value = null
    await loadPaths()
  } catch (error) {
    const data = (error as { data?: { message?: string } })?.data
    message.value = { color: "error", text: data?.message || "生成失败" }
  } finally {
    generating.value = false
  }
}

async function updateItem(item: PathItem, status: string) {
  try {
    await $fetch(`/api/learning-path/item/${item.id}`, {
      method: "PATCH",
      body: { status },
    })
    item.status = status
  } catch {
  }
}

async function activatePath(pathId: number) {
  try {
    await $fetch(`/api/learning-path/${pathId}`, { method: "PATCH", body: { status: "active" } })
    await loadPaths()
  } catch (error) {
    const data = (error as { data?: { message?: string } })?.data
    message.value = { color: "error", text: data?.message || "切换失败" }
  }
}

async function archivePath(pathId: number) {
  try {
    await $fetch(`/api/learning-path/${pathId}`, { method: "PATCH", body: { status: "archived" } })
    await loadPaths()
  } catch (error) {
    const data = (error as { data?: { message?: string } })?.data
    message.value = { color: "error", text: data?.message || "存档失败" }
  }
}

async function deletePath(pathId: number) {
  try {
    await $fetch(`/api/learning-path/${pathId}`, { method: "DELETE" })
    await loadPaths()
  } catch (error) {
    const data = (error as { data?: { message?: string } })?.data
    message.value = { color: "error", text: data?.message || "删除失败" }
  }
}

const statusColor = (s: string) => s === "completed" ? "success" : s === "in_progress" ? "warning" : "neutral"
const statusLabel = (s: string) => s === "completed" ? "已完成" : s === "in_progress" ? "进行中" : "待学习"
const pathStatusColor = (s: string) => s === "active" ? "primary" : s === "completed" ? "success" : "neutral"
const pathStatusLabel = (s: string) => s === "active" ? "进行中" : s === "completed" ? "已完成" : "已存档"

const activePaths = computed(() => paths.value.filter((p) => p.status === "active"))
const archivedPaths = computed(() => paths.value.filter((p) => p.status !== "active"))
</script>

<template>
  <UContainer class="py-10">
    <div class="mb-8">
      <h1 class="text-2xl font-semibold tracking-tight">个性化导学</h1>
      <p class="mt-1 text-sm text-muted">基于技能短板生成学习路径，支持多方向切换与断点续学</p>
    </div>

    <!-- 生成新路径 -->
    <UCard class="mb-6">
      <template #header>
        <div class="flex items-center gap-2">
          <UIcon name="i-lucide-plus" class="text-lg" />
          <span class="font-medium">开始新的学习方向</span>
        </div>
      </template>
      <div class="flex flex-wrap items-end gap-4">
        <div class="flex-1 min-w-48">
          <label class="mb-1 block text-sm">目标岗位</label>
          <USelect v-model="selectedPosition" :items="positionOptions" placeholder="选择岗位" class="w-full" />
        </div>
        <UButton color="primary" :loading="generating" :disabled="!selectedPosition" label="生成学习路径" @click="generate" />
      </div>
      <UAlert v-if="message" :color="message.color" :title="message.text" class="mt-4" />
    </UCard>

    <div v-if="loading" class="py-20 text-center text-muted">加载中…</div>

    <template v-else>
      <!-- 活跃路径 -->
      <div v-if="activePaths.length > 0" class="mb-8">
        <h2 class="mb-4 text-lg font-medium">当前学习方向</h2>
        <div class="space-y-6">
          <UCard v-for="path in activePaths" :key="path.id">
            <template #header>
              <div class="flex items-center justify-between">
                <div class="flex items-center gap-3">
                  <h3 class="font-medium">{{ path.name }}</h3>
                  <UBadge :color="pathStatusColor(path.status)" variant="soft" size="sm">{{ pathStatusLabel(path.status) }}</UBadge>
                </div>
                <div class="flex items-center gap-2">
                  <UButton size="xs" variant="soft" color="neutral" icon="i-lucide-archive" label="存档" @click="archivePath(path.id)" />
                  <UButton size="xs" variant="soft" color="error" icon="i-lucide-trash-2" label="删除" @click="deletePath(path.id)" />
                </div>
              </div>
            </template>
            <div class="space-y-2">
              <div
                v-for="item in path.items"
                :key="item.id"
                class="flex items-center justify-between rounded-lg border p-3"
              >
                <div class="flex items-center gap-3">
                  <span class="text-sm text-muted">#{{ item.sort_order + 1 }}</span>
                  <div class="flex flex-col">
                    <span class="text-sm font-medium">{{ skillMap.get(item.skill_id!) || '未知技能' }}</span>
                    <span v-if="item.resource_id" class="text-xs text-muted">📖 {{ resourceMap.get(item.resource_id!) || '学习资源' }}</span>
                  </div>
                </div>
                <div class="flex items-center gap-2">
                  <UBadge :color="statusColor(item.status)" variant="soft" size="sm">{{ statusLabel(item.status) }}</UBadge>
                  <UButton
                    v-if="item.status !== 'completed'"
                    size="xs"
                    color="success"
                    variant="soft"
                    label="完成"
                    @click="updateItem(item, 'completed')"
                  />
                  <UButton
                    v-if="item.status === 'pending'"
                    size="xs"
                    variant="soft"
                    label="开始"
                    @click="updateItem(item, 'in_progress')"
                  />
                </div>
              </div>
            </div>
          </UCard>
        </div>
      </div>

      <!-- 存档/已完成路径 -->
      <div v-if="archivedPaths.length > 0">
        <h2 class="mb-4 text-lg font-medium">其他学习方向</h2>
        <div class="space-y-4">
          <UCard v-for="path in archivedPaths" :key="path.id">
            <template #header>
              <div class="flex items-center justify-between">
                <div class="flex items-center gap-3">
                  <h3 class="font-medium">{{ path.name }}</h3>
                  <UBadge :color="pathStatusColor(path.status)" variant="soft" size="sm">{{ pathStatusLabel(path.status) }}</UBadge>
                  <UBadge variant="soft" size="sm">{{ path.items.length }} 步</UBadge>
                </div>
                <div class="flex items-center gap-2">
                  <UButton
                    v-if="path.status !== 'active'"
                    size="xs"
                    variant="soft"
                    color="primary"
                    icon="i-lucide-play"
                    label="切换到此方向"
                    @click="activatePath(path.id)"
                  />
                  <UButton size="xs" variant="soft" color="error" icon="i-lucide-trash-2" label="删除" @click="deletePath(path.id)" />
                </div>
              </div>
            </template>
          </UCard>
        </div>
      </div>

      <div v-if="paths.length === 0" class="py-20 text-center text-muted">
        暂无学习路径，请先选择目标岗位生成路径
      </div>
    </template>
  </UContainer>
</template>
