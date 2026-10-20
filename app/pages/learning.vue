<script setup lang="ts">
import type { GenRow } from "~/components/PlanGeneratingList.vue"
import { postSse } from "~/composables/useSse"

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
// 重新生成时的逐条进度（有内容就替换关卡地图显示）
const genRows = ref<GenRow[]>([])
const genElapsedMs = ref(0)

/**
 * 重新生成降级路径：删掉旧路径再按同一方向走一次生成。
 * 已有正文的技能会被复用，所以只会补那些还是模板的关卡。
 */
async function regenerate() {
  const path = activePath.value
  if (!path || regenerating.value) return

  regenerating.value = true
  genRows.value = []
  genElapsedMs.value = 0
  const startedAt = Date.now()
  const timer = window.setInterval(() => { genElapsedMs.value = Date.now() - startedAt }, 1000)

  try {
    await $fetch(`/api/learning-path/${path.id}`, { method: "DELETE" })

    await postSse("/api/learning-path/generate.stream", { position_id: path.target_position_id }, {
      start: (data) => {
        genRows.value = (data.items ?? []).map((item: GenRow) => ({
          skillId: item.skillId,
          index: item.index,
          name: item.name,
          status: "pending",
        }))
      },
      skill_start: (data) => updateGenRow(data, { status: "writing", attempt: data.attempt }),
      skill_retry: (data) => updateGenRow(data, { status: "writing", attempt: data.attempt }),
      skill_done: (data) => updateGenRow(data, { status: "ok", material: data.material }),
      skill_fail: (data) => updateGenRow(data, { status: "failed", reason: data.reason }),
      error: (data) => {
        throw new Error(data.message)
      },
    })

    selectedId.value = null
    await refresh()
    toast.add({ title: "已重新生成", description: "关卡正文已更新", color: "success", icon: "i-lucide-sparkles" })
  } catch (err) {
    const message = err instanceof Error ? err.message : (err as { data?: { message?: string } })?.data?.message
    toast.add({ title: "重新生成失败", description: message || "请稍后重试", color: "error" })
  } finally {
    clearInterval(timer)
    regenerating.value = false
    genRows.value = []
  }
}

function updateGenRow(data: { skillId: number }, patch: Partial<GenRow>): void {
  const row = genRows.value.find(r => r.skillId === data.skillId)
  if (row) Object.assign(row, patch)
}

// --- 阶段测评闭环：出题 → 作答 → 判分 → 采纳（回写掌握度并重排路径）---
type McStage = "idle" | "generating" | "answering" | "scored" | "accepted"

interface McQuestion {
  index: number
  skillName: string
  question: string
  options: string[]
}

interface McVerdict {
  skillId: number | null
  name: string
  mastered: boolean
  reason: string
}

const mcStage = ref<McStage>("idle")
const mcBusy = ref(false)
const mcError = ref<string | null>(null)
const mcCheckId = ref<number | null>(null)
const mcQuestions = ref<McQuestion[]>([])
const mcAnswers = ref<number[]>([])
const mcResult = ref<{
  score: number
  total: number
  feedback: string
  ruleBased: boolean
  perSkill: McVerdict[]
} | null>(null)
const mcAccepted = ref<{
  mastered: number[]
  review: number[]
  reopened: number
  reviewMoved: number
} | null>(null)

const mcCanStart = computed(() => llmReady.value && completed.value > 0 && mcStage.value === "idle")
const mcAnsweredAll = computed(() => mcAnswers.value.length === mcQuestions.value.length
  && mcAnswers.value.every((a) => a >= 0))

async function startCheck() {
  const path = activePath.value
  if (!path) return
  mcBusy.value = true
  mcError.value = null
  mcStage.value = "generating"
  try {
    const data = await $fetch<{ checkId: number, questions: McQuestion[] }>("/api/mastery-check/generate", {
      method: "POST",
      body: { pathId: path.id },
    })
    mcCheckId.value = data.checkId
    mcQuestions.value = data.questions
    mcAnswers.value = data.questions.map(() => -1)
    mcStage.value = "answering"
  } catch (err) {
    mcStage.value = "idle"
    mcError.value = (err as { data?: { message?: string } })?.data?.message
      || (err instanceof Error ? err.message : "出题失败")
  } finally {
    mcBusy.value = false
  }
}

async function submitCheck() {
  if (!mcCheckId.value || !mcAnsweredAll.value) return
  mcBusy.value = true
  mcError.value = null
  try {
    mcResult.value = await $fetch<typeof mcResult.value>("/api/mastery-check/" + mcCheckId.value + "/score", {
      method: "POST",
      body: { answers: mcAnswers.value },
    })
    mcStage.value = "scored"
  } catch (err) {
    mcError.value = (err as { data?: { message?: string } })?.data?.message
      || (err instanceof Error ? err.message : "判分失败")
  } finally {
    mcBusy.value = false
  }
}

async function acceptCheck() {
  if (!mcCheckId.value) return
  mcBusy.value = true
  mcError.value = null
  try {
    mcAccepted.value = await $fetch<typeof mcAccepted.value>("/api/mastery-check/" + mcCheckId.value + "/accept", {
      method: "POST",
    })
    mcStage.value = "accepted"
    await refresh()
  } catch (err) {
    mcError.value = (err as { data?: { message?: string } })?.data?.message
      || (err instanceof Error ? err.message : "采纳失败")
  } finally {
    mcBusy.value = false
  }
}

function resetCheck() {
  mcStage.value = "idle"
  mcCheckId.value = null
  mcQuestions.value = []
  mcAnswers.value = []
  mcResult.value = null
  mcAccepted.value = null
  mcError.value = null
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

    <!-- 重新生成时展示逐条进度，否则显示关卡地图 -->
    <PlanGeneratingList
      v-if="regenerating && genRows.length > 0"
      class="mt-6"
      :rows="genRows"
      :elapsed-ms="genElapsedMs"
      title="正在重新生成关卡内容"
    />
    <LearnPathMap v-else :items="mapItems" class="mt-6" />

    <!-- 阶段测评：学完几关后检验是否真掌握，采纳后回写掌握度并把没掌握的关卡挪成复习关 -->
    <UCard v-if="activePath && completed > 0" class="mt-6">
      <div class="mb-3 flex items-center gap-2">
        <UIcon name="i-lucide-clipboard-check" class="size-4 text-primary" />
        <span class="text-sm font-medium">阶段测评</span>
        <UBadge v-if="mcStage === 'accepted'" color="success" variant="soft" size="sm">
          已采纳
        </UBadge>
        <UBadge v-else-if="completed > 0" color="neutral" variant="soft" size="sm">
          已可测 {{ completed }} 关
        </UBadge>
      </div>

      <UAlert
        v-if="mcError"
        color="error"
        variant="soft"
        :description="mcError"
        class="mb-3"
      />

      <template v-if="mcStage === 'idle'">
        <p class="text-sm text-muted">
          针对最近学完的关卡出一套选择题，判完分可以把结论写回技能图谱，
          没掌握的关卡会自动挪到路径末尾标成复习关。
        </p>
        <UButton
          class="mt-3"
          size="sm"
          color="primary"
          variant="soft"
          icon="i-lucide-clipboard-check"
          label="开始测评"
          :loading="mcBusy"
          :disabled="!mcCanStart"
          @click="startCheck"
        />
        <p v-if="!llmReady" class="mt-2 text-xs text-muted">
          大模型未配置，无法出题
        </p>
      </template>

      <div v-else-if="mcStage === 'generating'" class="space-y-2">
        <p class="text-sm text-muted">大模型正在出题…</p>
        <USkeleton class="h-4 w-3/4" />
        <USkeleton class="h-4 w-2/3" />
      </div>

      <template v-else-if="mcStage === 'answering'">
        <div v-for="(q, i) in mcQuestions" :key="i" class="mb-4">
          <p class="text-sm font-medium">
            {{ i + 1 }}. {{ q.question }}
          </p>
          <p class="mb-2 text-xs text-muted">{{ q.skillName }}</p>
          <div class="flex flex-wrap gap-2">
            <UButton
              v-for="(opt, oi) in q.options"
              :key="oi"
              size="xs"
              :variant="mcAnswers[i] === oi ? 'solid' : 'outline'"
              :color="mcAnswers[i] === oi ? 'primary' : 'neutral'"
              :label="opt"
              @click="mcAnswers[i] = oi"
            />
          </div>
        </div>
        <UButton
          size="sm"
          color="primary"
          label="提交作答"
          :loading="mcBusy"
          :disabled="!mcAnsweredAll"
          @click="submitCheck"
        />
      </template>

      <template v-else-if="mcStage === 'scored' && mcResult">
        <div class="mb-3 flex items-center gap-2">
          <span class="text-lg font-semibold">{{ mcResult.score }}/{{ mcResult.total }}</span>
          <UBadge :color="mcResult.ruleBased ? 'warning' : 'success'" variant="soft" size="sm">
            {{ mcResult.ruleBased ? "按规则判定（模型不可用）" : "模型判定" }}
          </UBadge>
        </div>
        <p class="text-sm text-muted">{{ mcResult.feedback }}</p>
        <div class="mt-3 flex flex-wrap gap-2">
          <UBadge
            v-for="v in mcResult.perSkill"
            :key="v.name"
            :color="v.mastered ? 'success' : 'error'"
            variant="soft"
            size="sm"
          >
            {{ v.name }} · {{ v.mastered ? "已掌握" : "待复习" }}
          </UBadge>
        </div>
        <div class="mt-4 flex gap-2">
          <UButton
            size="sm"
            color="primary"
            icon="i-lucide-check"
            label="采纳结论"
            :loading="mcBusy"
            @click="acceptCheck"
          />
          <UButton
            size="sm"
            variant="ghost"
            color="neutral"
            label="不采纳"
            @click="resetCheck"
          />
        </div>
      </template>

      <template v-else-if="mcStage === 'accepted' && mcAccepted">
        <p class="text-sm">
          已把 {{ mcAccepted.mastered.length }} 项技能标为已掌握；
          <template v-if="mcAccepted.reopened > 0">
            {{ mcAccepted.reopened }} 个关卡已退回待学并挪到路径末尾标为复习关。
          </template>
          <template v-else-if="mcAccepted.reviewMoved > 0">
            {{ mcAccepted.reviewMoved }} 个关卡已挪到路径末尾标为复习关。
          </template>
          <template v-else>没有需要复习的关卡。</template>
        </p>
        <UButton
          class="mt-3"
          size="sm"
          variant="ghost"
          color="neutral"
          label="再测一次"
          @click="resetCheck"
        />
      </template>
    </UCard>

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
