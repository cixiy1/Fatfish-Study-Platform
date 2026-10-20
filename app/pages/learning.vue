<script setup lang="ts">
/**
 * 关卡路径：把学习路径渲染成多邻国式的蛇形关卡地图。
 * 数据来自 /api/learning-path（路径 + items）与 /api/skills（技能名映射）。
 */
useHead({ title: "关卡路径 · FSP" })

interface PathItem {
  id: number
  skill_id: number | null
  resource_id: number | null
  sort_order: number
  status: string
}

interface RawPath {
  id: number
  name: string
  target_position_id: number | null
  status: string
  created_at: string
  /** generating / ready / degraded / failed */
  generation_status: string
  items: PathItem[]
}

interface Skill {
  id: number
  name: string
}

interface MapItem {
  id: number
  name: string
  status: string
}

const fetcher = import.meta.server ? useRequestFetch() : $fetch

const { user } = useAuthSession()
const { llmReady, llmReasonText, setupPath, load: loadStatus } = useSystemStatus()
const isAdmin = computed(() => user.value?.role === "admin")

// 大模型是强依赖：未配置时这里只能读旧内容，要明确告诉用户原因
await loadStatus()

const { data: paths, refresh } = await useAsyncData<RawPath[]>("learning-paths", () =>
  fetcher<RawPath[]>("/api/learning-path"),
)

const { data: skills } = await useAsyncData<{ skills: Skill[] }>("learning-skills", () =>
  fetcher<{ skills: Skill[] }>("/api/skills"),
)

const skillNames = computed(
  () => new Map((skills.value?.skills ?? []).map((s) => [s.id, s.name])),
)

const pathList = computed(() => paths.value ?? [])

const selectedId = ref<number | null>(null)

const activePath = computed(() => {
  if (selectedId.value) {
    return pathList.value.find((p) => p.id === selectedId.value) ?? null
  }
  return pathList.value.find((p) => p.status === "active") ?? pathList.value[0] ?? null
})

const mapItems = computed<MapItem[]>(() =>
  (activePath.value?.items ?? [])
    .slice()
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((item) => ({
      id: item.id,
      name: item.skill_id ? (skillNames.value.get(item.skill_id) ?? "未命名技能") : "学习资源",
      status: item.status,
    })),
)

const completed = computed(
  () => mapItems.value.filter((i) => i.status === "completed").length,
)
const total = computed(() => mapItems.value.length)
const percent = computed(() =>
  total.value ? Math.round((completed.value / total.value) * 100) : 0,
)

const pathOptions = computed(() =>
  pathList.value.map((p) => ({
    label: `${p.name}${p.status === "active" ? "" : `（${p.status === "completed" ? "已完成" : "已存档"}）`}`,
    value: p.id,
  })),
)

const selectedOption = computed({
  get: () => activePath.value?.id ?? null,
  set: (value: number | null) => {
    selectedId.value = value
  },
})

const busy = ref(false)

async function setStatus(pathId: number, status: "active" | "archived") {
  busy.value = true
  try {
    await $fetch(`/api/learning-path/${pathId}`, { method: "PATCH", body: { status } })
    selectedId.value = null
    await refresh()
  } finally {
    busy.value = false
  }
}

async function removePath(pathId: number) {
  busy.value = true
  try {
    await $fetch(`/api/learning-path/${pathId}`, { method: "DELETE" })
    selectedId.value = null
    await refresh()
  } finally {
    busy.value = false
  }
}

const toast = useToast()
const regenerating = ref(false)

/**
 * 重新生成降级路径：删掉旧路径再按同一方向走一次生成。
 * 已有正文的技能会被复用，所以只会补那些还是模板的关卡。
 */
async function regenerate() {
  const path = activePath.value
  if (!path || regenerating.value) return

  regenerating.value = true
  try {
    await $fetch(`/api/learning-path/${path.id}`, { method: "DELETE" })
    await $fetch("/api/learning-path/generate", {
      method: "POST",
      body: { position_id: path.target_position_id, generate_content: true },
      timeout: 240_000,
    })
    selectedId.value = null
    await refresh()
    toast.add({ title: "已重新生成", description: "关卡正文已更新", color: "success", icon: "i-lucide-sparkles" })
  } catch (err) {
    const message = (err as { data?: { message?: string } })?.data?.message
    toast.add({ title: "重新生成失败", description: message || "请稍后重试", color: "error" })
  } finally {
    regenerating.value = false
  }
}
</script>

<template>
  <div class="mx-auto w-full max-w-2xl px-4 py-8">
    <div class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 class="text-2xl font-semibold tracking-tight">关卡路径</h1>
        <p v-if="activePath" class="mt-1 text-sm text-muted">
          <template v-if="pathList.length > 1">已完成 {{ completed }}/{{ total }}</template>
          <template v-else>{{ activePath.name }} · 已完成 {{ completed }}/{{ total }}</template>
        </p>
        <p v-else class="mt-1 text-sm text-muted">暂无学习路径</p>
      </div>

      <USelect
        v-if="pathList.length > 1"
        v-model="selectedOption"
        :items="pathOptions"
        size="sm"
        class="w-48"
        placeholder="切换方向"
        aria-label="切换学习方向"
      />
    </div>

    <div class="mt-4 flex items-center gap-3">
      <UProgress :model-value="percent" class="flex-1" />
      <span class="text-sm font-medium tabular-nums">{{ percent }}%</span>
    </div>

    <!-- 大模型未配置：页面能看，但别再让用户以为「生成了」 -->
    <div v-if="!llmReady" class="mt-4 rounded-lg bg-error/10 px-3 py-2.5 text-sm text-error">
      <div class="flex items-start gap-2">
        <UIcon name="i-lucide-plug-zap" class="mt-0.5 size-4 shrink-0" />
        <span>
          {{ llmReasonText }}
          存量模板内容不会自动更新，配置接口后可在下方重新生成。
        </span>
      </div>
      <UButton
        v-if="isAdmin"
        :to="setupPath"
        class="mt-2 ml-6"
        size="xs"
        variant="soft"
        color="error"
        icon="i-lucide-settings"
        label="前往配置"
      />
    </div>

    <!-- 降级路径必须自报家门：正文是离线模板，不是模型针对这个人写的 -->
    <div
      v-if="llmReady && activePath?.generation_status === 'degraded'"
      class="mt-4 rounded-lg bg-warning/10 px-3 py-2.5 text-sm text-warning"
    >
      <div class="flex items-start gap-2">
        <UIcon name="i-lucide-triangle-alert" class="mt-0.5 size-4 shrink-0" />
        <span>
          本路径正文为离线模板（生成时未接入大模型或调用失败）。重新生成可替换为模型内容。
        </span>
      </div>
      <UButton
        v-if="llmReady"
        class="mt-2 ml-6"
        size="xs"
        variant="soft"
        color="warning"
        icon="i-lucide-refresh-cw"
        label="重新生成"
        :loading="regenerating"
        @click="regenerate"
      />
    </div>

    <LearnPathMap :items="mapItems" class="mt-6" />

    <!-- 管理学习方向：日常不用，收在底部 -->
    <details v-if="activePath" class="mt-8 rounded-xl border border-default p-4">
      <summary class="cursor-pointer text-sm text-muted">管理学习方向</summary>      <div class="mt-4 flex flex-wrap gap-2">
        <UButton
          v-if="activePath.status !== 'active'"
          size="xs"
          variant="soft"
          label="设为当前方向"
          :loading="busy"
          @click="setStatus(activePath.id, 'active')"
        />
        <UButton
          v-else
          size="xs"
          variant="soft"
          color="neutral"
          icon="i-lucide-archive"
          label="存档"
          :loading="busy"
          @click="setStatus(activePath.id, 'archived')"
        />
        <UButton
          size="xs"
          variant="soft"
          color="error"
          icon="i-lucide-trash-2"
          label="删除这条路径"
          :loading="busy"
          @click="removePath(activePath.id)"
        />
        <UButton
          to="/onboarding"
          size="xs"
          variant="ghost"
          color="neutral"
          icon="i-lucide-plus"
          label="新建方向"
        />
      </div>
    </details>
  </div>
</template>
