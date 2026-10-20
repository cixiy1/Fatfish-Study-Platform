<script setup lang="ts">
import type { DirectionSelectResponse } from "#shared/types/direction"

/**
 * 学习计划引导（多邻国式）：一次只问一件事。
 *
 * interviewer → 模型动态追问 3~5 轮
 * directions → 模型给出 1~3 个方向，用户选一个
 * goal       → 每天学多久
 * confirm    → 确认后同步生成整套关卡资料（可能几十秒）
 *
 * 访谈请求全部在事件回调里发出，setup 顶层不 await，避免 SSR 等模型。
 */
definePageMeta({ auth: true, layout: "blank" })

useHead({ title: "制定学习计划 · FSP" })

interface PlanPosition {
  id: number
  name: string
  category: string
  description: string | null
  icon: string | null
  skill_count: number
}

type Phase = "interview" | "directions" | "goal" | "confirm" | "position"

const { user, resolveUser } = useAuthSession()

const {
  history,
  question,
  options,
  directions,
  token,
  loading,
  mock,
  error,
  finished,
  llmBlocked: interviewBlocked,
  start,
  answer,
  reset,
  restoreDraft,
  clearDraft,
} = useDirectionInterview()

// 大模型是否可用：SSR 阶段先拿到，避免首屏闪一下访谈再变阻断页
const { llm, llmReady, llmReasonText, load: loadStatus } = useSystemStatus()
await loadStatus()

const checkingLlm = ref(false)
const isAdmin = computed(() => user.value?.role === "admin")

/** 大模型未就绪时整页只显示配置引导，不给「先跳过」的假入口 */
const needsLlm = computed(() => !llmReady.value || interviewBlocked.value)

const phase = ref<Phase>("interview")
const selectedIndex = ref<number | null>(null)
const minutes = ref<number | null>(null)
const submitting = ref(false)
const submitError = ref("")

const positions = ref<PlanPosition[]>([])
const positionsLoading = ref(false)
const fallbackPositionId = ref<number | null>(null)

const selectedDirection = computed(
  () => (selectedIndex.value === null ? null : directions.value[selectedIndex.value] ?? null),
)

const step = computed(() => {
  switch (phase.value) {
    case "directions": return 2
    case "goal": return 3
    case "confirm": return 4
    default: return 1
  }
})

const canBack = computed(() => !needsLlm.value && phase.value !== "interview" && !submitting.value)

/**
 * 访谈一结束就切到方向选择。
 *
 * 之前漏了这一步：模型返回 done 后 directions 有值，但 phase 还停在 interview，
 * 界面上既没有新问题也没有选项，看起来像「卡住了」，必须刷新一次
 * （刷新时 restoreDraft 把 phase 拉回 directions）才能看到方向卡片。
 */
watch(finished, (done) => {
  if (done && directions.value.length > 0 && phase.value === "interview") {
    phase.value = "directions"
  }
})

const toast = useToast()

onMounted(async () => {
  // 刷新时如果已经拿到方向，直接回到选择页，不用重聊
  if (restoreDraft() && directions.value.length > 0) {
    phase.value = "directions"
    return
  }
  if (needsLlm.value) return
  await start()
})

/** 用户点「我已配好」：重新探测，可用就立刻开聊 */
async function retryLlm() {
  if (checkingLlm.value) return
  checkingLlm.value = true
  try {
    await loadStatus(true)
    if (!llmReady.value) {
      toast.add({
        title: "大模型仍不可用",
        description: "请确认配置已保存，并已通过测试请求",
        color: "warning",
      })
      return
    }
    toast.add({ title: "大模型已就绪", color: "success" })
    reset()
    await start()
  } finally {
    checkingLlm.value = false
  }
}

/** 生成过程中离开页面要提醒（同步生成可能要几十秒） */
function beforeUnload(event: BeforeUnloadEvent) {
  if (!submitting.value) return
  event.preventDefault()
  event.returnValue = ""
}

onMounted(() => window.addEventListener("beforeunload", beforeUnload))
onBeforeUnmount(() => window.removeEventListener("beforeunload", beforeUnload))

function back() {
  if (submitting.value) return

  if (phase.value === "confirm") {
    phase.value = "goal"
    return
  }
  if (phase.value === "goal") {
    phase.value = "directions"
    return
  }
  if (phase.value === "position") {
    phase.value = "interview"
    return
  }
  // 访谈已经结束，回退只能重来
  if (phase.value === "directions") {
    selectedIndex.value = null
    reset()
    phase.value = "interview"
    void start()
  }
}

function pickDirection(index: number) {
  selectedIndex.value = index
}

function goGoal() {
  if (selectedIndex.value === null) return
  phase.value = "goal"
}

function pickMinutes(value: number | null) {
  if (!value) return
  minutes.value = value
  phase.value = "confirm"
}

async function openPositions() {
  phase.value = "position"
  if (positions.value.length > 0) return

  positionsLoading.value = true
  try {
    positions.value = await $fetch<PlanPosition[]>("/api/positions")
  } catch {
    submitError.value = "方向列表加载失败，请刷新重试"
  } finally {
    positionsLoading.value = false
  }
}

/** 直接用现成方向建路径（访谈失败时的降级入口） */
async function submitFallback() {
  if (!fallbackPositionId.value) return
  submitting.value = true
  submitError.value = ""
  try {
    await $fetch("/api/learning-path/generate", {
      method: "POST",
      body: { position_id: fallbackPositionId.value, generate_content: true },
      timeout: 240_000,
    })
    await navigateTo("/learning", { replace: true })
  } catch (err) {
    await handleGenerateError(err)
  }
}

function statusOf(err: unknown): number | undefined {
  return (err as { statusCode?: number, status?: number }).statusCode
    ?? (err as { status?: number }).status
}

function describeError(err: unknown): string {
  const status = statusOf(err)
  const data = (err as { data?: { code?: string, message?: string } }).data

  // 未配置大模型：把服务端那句「请先去后台配置」原样透出来
  if (status === 503 && data?.code === "LLM_NOT_CONFIGURED") {
    return data.message || "尚未配置大模型接口，请联系管理员"
  }
  if (status === 409) return "该方向已有学习路径，正在打开"
  if (status === 502) return data?.message || "生成失败，请重试"
  if (status === 503) return "大模型暂不可用，请稍后重试"
  if (status === 504) return "生成超时，可重试；已生成的关卡会保留"
  return data?.message || "生成失败，请重试"
}

/**
 * 409 = 这个方向已经有路径，不该让用户卡在确认页等一个不会来的结果，
 * 直接带去关卡地图；未配置大模型则切到配置引导；其他错误留在原地，方便重试。
 */
async function handleGenerateError(err: unknown): Promise<void> {
  const status = statusOf(err)
  const code = (err as { data?: { code?: string } }).data?.code

  if (status === 409) {
    clearDraft()
    await resolveUser(true)
    await navigateTo("/learning", { replace: true })
    return
  }

  if (status === 503 && code === "LLM_NOT_CONFIGURED") {
    await loadStatus(true)
  }

  submitError.value = describeError(err)
  submitting.value = false
}

async function submit() {
  if (submitting.value || selectedIndex.value === null || !minutes.value || !token.value) return

  submitting.value = true
  submitError.value = ""

  try {
    const selected = await $fetch<DirectionSelectResponse>("/api/direction/select", {
      method: "POST",
      body: { selectionToken: token.value, directionIndex: selectedIndex.value },
      timeout: 30_000,
    })

    await $fetch("/api/learning-path/generate", {
      method: "POST",
      body: { position_id: selected.positionId, generate_content: true },
      timeout: 240_000,
    })

    await $fetch("/api/plan", {
      method: "POST",
      body: { dailyMinutes: minutes.value },
      timeout: 20_000,
    })

    clearDraft()
    await resolveUser(true)
    await navigateTo("/learning", { replace: true })
  } catch (err) {
    await handleGenerateError(err)
  }
}

const directionSkillCount = computed(() => {
  const direction = selectedDirection.value
  if (!direction) return 0
  return direction.skillIds.length + (direction.newSkills?.length ?? 0)
})
</script>

<template>
  <h1 class="sr-only">制定学习计划</h1>
  <PlanStepper :step="step" :total="4" :can-back="canBack" @back="back">
    <PlanStepLlmRequired
      v-if="needsLlm"
      :reason="llmReasonText || error"
      :configured="llm?.configured ?? false"
      :model="llm?.model ?? null"
      :is-admin="isAdmin"
      :checking="checkingLlm"
      @retry="retryLlm"
    />

    <PlanStepInterview
      v-else-if="phase === 'interview'"
      :messages="history"
      :question="question"
      :options="options"
      :loading="loading"
      :error="error"
      @answer="answer"
    />

    <!-- 访谈失败时的兜底入口，不影响主流程 -->
    <div v-if="!needsLlm && phase === 'interview' && error" class="mt-4">
      <UButton
        variant="soft"
        color="neutral"
        size="sm"
        label="选择预设方向"
        icon="i-lucide-list"
        @click="openPositions"
      />
    </div>

    <PlanStepDirections
      v-if="!needsLlm && phase === 'directions'"
      :directions="directions"
      :selected-index="selectedIndex"
      :mock="mock"
      @select="pickDirection"
    />

    <PlanStepGoal
      v-if="!needsLlm && phase === 'goal'"
      :model-value="minutes"
      @update:model-value="pickMinutes"
    />

    <div v-if="!needsLlm && phase === 'confirm'" class="space-y-6">
      <PlanStepConfirm
        :position-name="selectedDirection?.name ?? ''"
        :skill-count="directionSkillCount"
        :minutes="minutes ?? 0"
        :submitting="submitting"
        :error-text="submitError"
        :offline="mock"
        @submit="submit"
      />
      <AiThinking v-if="submitting" title="正在生成关卡与资料" />
    </div>

    <div v-if="!needsLlm && phase === 'position'" class="mt-6">
      <PlanStepPosition
        v-model="fallbackPositionId"
        :positions="positions"
        :loading="positionsLoading"
      />
      <div class="mt-6">
        <UButton
          block
          size="lg"
          :loading="submitting"
          :disabled="!fallbackPositionId"
          label="生成学习计划"
          icon="i-lucide-arrow-right"
          @click="submitFallback"
        />
      </div>
      <p v-if="submitError" class="mt-3 text-sm text-error">{{ submitError }}</p>
    </div>

    <template #footer>
      <UButton
        v-if="!needsLlm && phase === 'directions'"
        block
        size="lg"
        :disabled="selectedIndex === null"
        label="下一步"
        icon="i-lucide-arrow-right"
        @click="goGoal"
      />
    </template>
  </PlanStepper>
</template>
