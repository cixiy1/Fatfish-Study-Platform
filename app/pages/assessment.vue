<script setup lang="ts">
import { postSse } from "~/composables/useSse"
import { countAnswered, emptyAnswer, isAnswered } from "#shared/utils/assessment"
import { QUESTION_KIND_LABEL } from "#shared/types/assessment"
import type { AnswerValue, AssessmentQuestion, QuestionKind } from "#shared/types/assessment"

useHead({ title: "能力测评 · FSP" })

const route = useRoute()

interface Direction {
  id: number
  name: string
  category: string
  description: string | null
  itemCount: number
  completedCount: number
  generationStatus: string
}

type Phase = "generating" | "quiz" | "analyzing" | "result" | "error"

const phase = ref<Phase>("generating")
const questions = ref<AssessmentQuestion[]>([])
/** 每题一份作答值，形状随题型（单选 number / 多选 number[] / 填空 string[] / 表单对象…） */
const answers = ref<AnswerValue[]>([])
const currentStep = ref(0)

/** 可选学习方向（用户在学的），题目跟着它走 */
const directions = ref<Direction[]>([])
const selectedId = ref<number | null>(null)
const activeDirection = computed(() => directions.value.find((d) => d.id === selectedId.value) ?? null)

const streamText = ref("")
const result = ref<{
  score: number
  total: number
  result: {
    careerDirection: string
    strengths: string[]
    weaknesses: string[]
    recommendation: string
    suggestedTopics: string[]
  }
  aiGenerated: boolean
  /** 已联动写入技能图谱的技能 */
  linked?: { skillId: number, name: string, status: string }[]
  /** 本次测评的方向，用于结果页直接跳转 */
  positionId?: number | null
  positionName?: string | null
} | null>(null)

/** 本次动态出题的批次号，提交时要回传，服务端才能取回当时这套题 */
const batchId = ref<string | null>(null)

const errorMsg = ref("")

const progress = computed(() => {
  if (questions.value.length === 0) return 0
  return Math.round(((currentStep.value + 1) / questions.value.length) * 100)
})

const currentQuestion = computed(() => questions.value[currentStep.value] ?? null)
const currentAnswer = computed(() => answers.value[currentStep.value] ?? null)
const answeredTotal = computed(() => countAnswered(questions.value, answers.value))

/** 开放题允许跳过（想不出就空着往下走），其他题型必须作答 */
const canProceed = computed(() => {
  const q = currentQuestion.value
  if (!q) return false
  if (q.kind === "text") return true
  return isAnswered(q, currentAnswer.value)
})

/** 没答完时给出的具体提示，比统一的「填写后继续」更像人话 */
const blockedHint = computed(() => {
  switch (currentQuestion.value?.kind) {
    case "single": return "选一个选项继续"
    case "multi": return "至少选一项"
    case "blank": return "把空填完继续"
    case "form": return "必填项填完继续"
    case "scale": return "选一个分数继续"
    default: return ""
  }
})

/** 写回当前题的作答（形状由题型决定，组件负责构造） */
function updateAnswer(value: AnswerValue) {
  answers.value[currentStep.value] = value
}

/** 题型分布：让用户一眼看到这次不是清一色选择题 */
const kindSummary = computed(() => {
  const counter = new Map<QuestionKind, number>()
  for (const q of questions.value) counter.set(q.kind, (counter.get(q.kind) ?? 0) + 1)
  return [...counter.entries()].map(([kind, count]) => ({ kind, count, label: QUESTION_KIND_LABEL[kind] }))
})

const streamDisplay = computed(() => {
  const text = streamText.value
  const cut = text.indexOf("```json")
  if (cut >= 0) return text.slice(0, cut).trim()
  const brace = text.indexOf("{")
  if (brace >= 0) return text.slice(0, brace).trim()
  const bracket = text.indexOf("[")
  if (bracket >= 0) return text.slice(0, bracket).trim()
  return text.trim()
})

async function loadDirections() {
  try {
    const data = await $fetch<{ directions: Direction[], current: number | null }>("/api/assessment/directions")
    directions.value = data.directions ?? []
    selectedId.value = data.current ?? data.directions?.[0]?.id ?? null
  } catch {
    // 未登录 / 后端异常：不阻塞出题，走「无方向」的通用题
    directions.value = []
  }
}

async function generateQuestions() {
  phase.value = "generating"
  streamText.value = ""
  errorMsg.value = ""
  questions.value = []
  answers.value = []
  batchId.value = null
  currentStep.value = 0

  try {
    // 方向跟着请求走：切换方向 → 重新出题，题目、批次号、答案全部重置
    await postSse("/api/assessment/generate", { positionId: selectedId.value }, {
      context: (data) => {
        if (data && typeof data.positionId === "number") selectedId.value = data.positionId
      },
      chunk: (data) => { streamText.value += data.text },
      done: (data) => {
        const qs = data.questions as AssessmentQuestion[]
        if (Array.isArray(qs) && qs.length >= 3) {
          questions.value = qs
          batchId.value = data.batchId ?? null
          if (typeof data.positionId === "number") selectedId.value = data.positionId
          // 每种题型给一份形状正确的空作答，后面直接原位替换
          answers.value = qs.map(emptyAnswer)
          currentStep.value = 0
          phase.value = "quiz"
        } else {
          errorMsg.value = "题目生成失败"
          phase.value = "error"
        }
      },
      error: (data) => { errorMsg.value = data.message; phase.value = "error" },
    })
  } catch (e) {
    errorMsg.value = e instanceof Error ? e.message : "出题失败"
    phase.value = "error"
  }
}

async function switchDirection(id: number) {
  // 同一个方向重复点不必重新出题；出错状态下允许点击重试
  if (id === selectedId.value && phase.value !== "error") return
  selectedId.value = id
  await generateQuestions()
}

async function submit() {
  phase.value = "analyzing"
  streamText.value = ""
  errorMsg.value = ""

  try {
    await postSse("/api/assessment/career/analyze", {
      answers: answers.value,
      batchId: batchId.value,
      positionId: selectedId.value,
    }, {
      chunk: (data) => { streamText.value += data.text },
      done: (data) => {
        result.value = data as typeof result.value
        phase.value = "result"
      },
      error: (data) => { errorMsg.value = data.message; phase.value = "error" },
    })
  } catch (e) {
    errorMsg.value = e instanceof Error ? e.message : "分析失败"
    phase.value = "error"
  }
}

onMounted(async () => {
  await loadDirections()
  // 支持 /assessment?positionId=7 直达某个方向（图谱页 / 路线页可带过来）
  const wanted = Number(route.query.positionId ?? 0)
  if (wanted > 0 && directions.value.some((d) => d.id === wanted)) {
    selectedId.value = wanted
  }
  await generateQuestions()
})
</script>

<template>
  <UContainer class="py-10">
    <div class="mb-6">
      <h1 class="text-2xl font-semibold tracking-tight">能力测评</h1>
      <p class="mt-1 text-sm text-muted">
        题目跟着你的学习方向走，切换方向即重新出题；完成后生成画像并联动技能图谱
      </p>
    </div>

    <!-- 方向选择：测评范围随方向变化 -->
    <div v-if="directions.length > 0" class="mx-auto mb-6 max-w-2xl">
      <p class="mb-2 text-xs font-medium text-muted">测评方向</p>
      <div class="flex flex-wrap gap-2">
        <button
          v-for="dir in directions"
          :key="dir.id"
          class="rounded-lg border px-3 py-2 text-left transition hover:bg-elevated disabled:cursor-not-allowed disabled:opacity-60"
          :class="selectedId === dir.id ? 'border-primary bg-primary/10' : 'border-default'"
          :disabled="phase === 'analyzing'"
          @click="switchDirection(dir.id)"
        >
          <span class="block text-sm font-medium">{{ dir.name }}</span>
          <span class="block text-xs text-muted">
            {{ dir.category }}
            <template v-if="dir.itemCount > 0"> · {{ dir.completedCount }}/{{ dir.itemCount }} 关</template>
            <template v-else> · 尚未生成路线</template>
          </span>
        </button>
      </div>
      <p v-if="phase === 'quiz'" class="mt-2 text-xs text-muted">切换方向会重新出题，当前作答会丢失</p>
    </div>

    <!-- 出题中 -->
    <div v-if="phase === 'generating'" class="mx-auto max-w-2xl">
      <div class="rounded-xl border border-default p-6">
        <div class="mb-4">
          <p class="text-sm font-medium">
            {{ activeDirection ? `大模型正在为「${activeDirection.name}」定制测评题目…` : '大模型正在为你定制测评题目…' }}
          </p>
        </div>
        <div v-if="streamDisplay" class="min-h-[80px] whitespace-pre-wrap text-sm leading-relaxed text-muted">
          {{ streamDisplay }}
        </div>
        <div v-else class="flex items-center justify-center gap-2 py-6 text-muted">
          <UIcon name="i-lucide-brain" class="size-5 animate-pulse" />
          <span class="text-sm">正在分析你的信息…</span>
        </div>
      </div>
    </div>

    <!-- 分析中：判断类，用大脑图标 -->
    <div v-else-if="phase === 'analyzing'" class="mx-auto max-w-2xl">
      <div class="rounded-xl border border-default p-6">
        <div class="mb-4 flex items-center gap-3">
          <UIcon name="i-lucide-brain" class="size-4 animate-pulse text-primary" />
          <span class="text-sm font-medium">大模型正在分析你的作答…</span>
        </div>
        <div v-if="streamDisplay" class="min-h-[120px] whitespace-pre-wrap text-sm leading-relaxed text-muted">
          {{ streamDisplay }}<span class="animate-pulse text-primary">▌</span>
        </div>
        <div v-else class="flex items-center justify-center gap-2 py-8 text-muted">
          <UIcon name="i-lucide-brain" class="size-5 animate-pulse" />
          <span class="text-sm">正在思考…</span>
        </div>
      </div>
    </div>

    <!-- 结果页 -->
    <UCard v-else-if="phase === 'result' && result" class="max-w-2xl mx-auto">
      <div class="text-center">
        <div class="mx-auto mb-4 flex size-16 items-center justify-center rounded-full bg-success-100">
          <UIcon name="i-lucide-check" class="text-3xl text-success" />
        </div>
        <h2 class="text-xl font-semibold">测评完成</h2>
        <p class="mt-2 text-muted">已完成 {{ result.score }} / {{ result.total }} 题</p>
        <p v-if="result.positionName" class="mt-1 text-sm text-muted">方向：{{ result.positionName }}</p>
        <UBadge v-if="result.aiGenerated" color="success" variant="soft" size="sm" class="mt-2">
          大模型解读
        </UBadge>
      </div>
      <div class="mt-6 space-y-4">
        <div>
          <h3 class="font-medium">推荐方向</h3>
          <UBadge color="primary" variant="soft" class="mt-1">{{ result.result.careerDirection }}</UBadge>
        </div>
        <div v-if="result.result.suggestedTopics.length > 0">
          <h3 class="font-medium">建议先学</h3>
          <div class="mt-1 flex flex-wrap gap-2">
            <UBadge v-for="topic in result.result.suggestedTopics" :key="topic" color="neutral" variant="soft">
              {{ topic }}
            </UBadge>
          </div>
        </div>
        <div v-if="result.result.strengths.length > 0">
          <h3 class="font-medium">优势领域</h3>
          <div class="mt-1 flex flex-wrap gap-2">
            <UBadge v-for="s in result.result.strengths" :key="s" color="success" variant="soft">{{ s }}</UBadge>
          </div>
        </div>
        <div v-if="result.result.weaknesses.length > 0">
          <h3 class="font-medium">待补强</h3>
          <div class="mt-1 flex flex-wrap gap-2">
            <UBadge v-for="w in result.result.weaknesses" :key="w" color="warning" variant="soft">{{ w }}</UBadge>
          </div>
        </div>
        <div v-if="result.result.recommendation">
          <h3 class="font-medium">学习建议</h3>
          <p class="mt-1 text-sm text-muted">{{ result.result.recommendation }}</p>
        </div>

        <!-- 已同步到技能图谱的技能 -->
        <div v-if="result.linked && result.linked.length > 0">
          <h3 class="font-medium">已同步 {{ result.linked.length }} 项技能到图谱</h3>
          <div class="mt-2 flex flex-wrap gap-2">
            <UBadge
              v-for="link in result.linked"
              :key="link.skillId"
              :color="link.status === 'mastered' ? 'success' : 'neutral'"
              variant="soft"
            >
              {{ link.name }}
            </UBadge>
          </div>
        </div>
      </div>
      <template #footer>
        <div class="flex gap-3">
          <!-- 有方向就直接进本人图谱页并自动分析，否则回列表页 -->
          <UButton
            :to="result.positionId ? `/positions/${result.positionId}?autoAnalyze=1` : '/positions'"
            :label="result.positionId ? '查看我的技能图谱' : '查看技能图谱'"
          />
          <UButton to="/" variant="soft" label="返回首页" />
        </div>
      </template>
    </UCard>

    <!-- 答题页 -->
    <div v-else-if="phase === 'quiz' && questions.length > 0" class="mx-auto max-w-2xl">
      <UProgress :model-value="progress" class="mb-4" />
      <div class="mb-4 flex flex-wrap items-center justify-between gap-2">
        <p class="text-sm text-muted">
          第 {{ currentStep + 1 }} / {{ questions.length }} 题
          <span class="text-xs">· 已答 {{ answeredTotal }}</span>
        </p>
        <!-- 题型分布：说明这次测评不是清一色选择题 -->
        <div class="flex flex-wrap gap-1.5">
          <UBadge v-for="item in kindSummary" :key="item.kind" color="neutral" variant="soft" size="sm">
            {{ item.label }} {{ item.count }}
          </UBadge>
        </div>
      </div>

      <UCard>
        <AssessmentQuestionCard
          v-if="currentQuestion"
          :question="currentQuestion"
          :model-value="currentAnswer"
          @update:model-value="updateAnswer"
        />
      </UCard>

      <div class="mt-6 flex items-center justify-between">
        <UButton variant="soft" :disabled="currentStep === 0" label="上一题" @click="currentStep--" />
        <span v-if="!canProceed" class="text-xs text-muted">{{ blockedHint }}</span>
        <UButton
          v-if="currentStep < questions.length - 1"
          :disabled="!canProceed"
          :class="canProceed ? '' : 'opacity-50'"
          label="下一题"
          @click="currentStep++"
        />
        <UButton
          v-else
          color="primary"
          :disabled="!canProceed"
          :class="canProceed ? '' : 'opacity-50'"
          label="提交测评"
          @click="submit"
        />
      </div>
      <p v-if="currentQuestion?.kind === 'text'" class="mt-2 text-right text-xs text-muted">
        开放题可以留空直接跳过
      </p>
    </div>

    <!-- 错误页 -->
    <div v-else-if="phase === 'error'" class="mx-auto max-w-2xl text-center">
      <UIcon name="i-lucide-alert-circle" class="mx-auto mb-3 size-8 text-error" />
      <p class="text-muted">{{ errorMsg }}</p>
      <UButton color="primary" label="重试" class="mt-4" @click="generateQuestions" />
    </div>
  </UContainer>
</template>
