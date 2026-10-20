<script setup lang="ts">

useHead({ title: "能力测评 · FSP" })

interface Question {
  id: number
  question: string
  options: string[]
  category: string | null
  sort_order: number
}

const loading = ref(true)
const submitting = ref(false)
const questions = ref<Question[]>([])
const answers = ref<number[]>([])
const currentStep = ref(0)

const streamingText = ref("")
const streamDone = ref(false)
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
} | null>(null)

onMounted(async () => {
  try {
    const data = await $fetch<{ assessment: { title: string, description: string }, questions: Question[] }>("/api/assessment/career")
    questions.value = data.questions
    answers.value = new Array(data.questions.length).fill(-1)
  } catch {

    // 忽略

  } finally {
    loading.value = false
  }
})

const progress = computed(() => {
  if (questions.value.length === 0) return 0
  return Math.round(((currentStep.value + 1) / questions.value.length) * 100)
})

async function submit() {
  submitting.value = true
  streamingText.value = ""
  streamDone.value = false

  try {
    const response = await fetch("/api/assessment/career/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ answers: answers.value }),
    })

    if (!response.ok || !response.body) {
      throw new Error(`请求失败: ${response.status}`)
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ""

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const blocks = buffer.split("\n\n")
      buffer = blocks.pop() ?? ""

      for (const block of blocks) {
        const eventMatch = block.match(/^event: (.+)$/m)
        const dataMatch = block.match(/^data: (.+)$/m)
        if (!eventMatch || !dataMatch) continue

        const eventType = eventMatch[1]
        const data = JSON.parse(dataMatch[1])

        if (eventType === "chunk") {
          streamingText.value += data.text
        } else if (eventType === "done") {
          result.value = data
          streamDone.value = true
        } else if (eventType === "error") {
          throw new Error(data.message)
        }
      }
    }
  } catch (e) {
    result.value = {
      score: answers.value.filter((a) => a >= 0).length,
      total: questions.value.length,
      result: {
        careerDirection: "待确认",
        strengths: [],
        weaknesses: [],
        recommendation: e instanceof Error ? e.message : "分析失败，请重试",
        suggestedTopics: [],
      },
      aiGenerated: false,
    }
    streamDone.value = true
  } finally {
    submitting.value = false
  }
}

const streamingAnalysis = computed(() => {
  const text = streamingText.value
  const jsonStart = text.indexOf("```json")
  if (jsonStart >= 0) {
    return text.slice(0, jsonStart).trim()
  }
  const braceStart = text.indexOf("{")
  if (braceStart >= 0) {
    return text.slice(0, braceStart).trim()
  }
  return text.trim()
})
</script>

<template>
  <UContainer class="py-10">
    <div class="mb-8">
      <h1 class="text-2xl font-semibold tracking-tight">基础能力测评</h1>
      <p class="mt-1 text-sm text-muted">完成测评后生成初始画像与推荐方向</p>
    </div>

    <div v-if="loading" class="py-20 text-center text-muted">加载中…</div>

    <!-- 结果页 -->
    <UCard v-else-if="result && streamDone" class="max-w-2xl mx-auto">
      <div class="text-center">
        <div class="mx-auto mb-4 flex size-16 items-center justify-center rounded-full bg-success-100">
          <UIcon name="i-lucide-check" class="text-3xl text-success" />
        </div>
        <h2 class="text-xl font-semibold">测评完成</h2>
        <p class="mt-2 text-muted">已完成 {{ result.score }} / {{ result.total }} 题</p>
        <UBadge
          v-if="result.aiGenerated"
          color="success"
          variant="soft"
          size="sm"
          class="mt-2"
        >
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
            <UBadge
              v-for="topic in result.result.suggestedTopics"
              :key="topic"
              color="neutral"
              variant="soft"
            >
              {{ topic }}
            </UBadge>
          </div>
        </div>
        <div>
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
        <div>
          <h3 class="font-medium">学习建议</h3>
          <p class="mt-1 text-sm text-muted">{{ result.result.recommendation }}</p>
        </div>
      </div>
      <template #footer>
        <div class="flex gap-3">
          <UButton to="/positions" label="查看技能图谱" />
          <UButton to="/" variant="soft" label="返回首页" />
        </div>
      </template>
    </UCard>

    <!-- 流式渲染中 -->
    <div v-else-if="submitting" class="mx-auto max-w-2xl">
      <div class="rounded-xl border border-default p-6">
        <div class="mb-4 flex items-center gap-3">
          <div class="size-3 animate-pulse rounded-full bg-primary" />
          <span class="text-sm font-medium">大模型正在分析你的作答…</span>
        </div>
        <div v-if="streamingAnalysis" class="min-h-[120px] whitespace-pre-wrap text-sm leading-relaxed text-muted">
          {{ streamingAnalysis }}<span class="animate-pulse text-primary">▌</span>
        </div>
        <div v-else class="py-8 text-center text-muted">
          <UIcon name="i-lucide-brain" class="mx-auto mb-2 size-6 animate-pulse" />
          <span class="text-sm">正在思考…</span>
        </div>
      </div>
    </div>

    <!-- 答题页 -->
    <div v-else-if="questions.length > 0" class="mx-auto max-w-2xl">
      <UProgress :value="progress" class="mb-6" />
      <p class="mb-4 text-sm text-muted">第 {{ currentStep + 1 }} / {{ questions.length }} 题</p>

      <UCard>
        <h3 class="mb-1 font-medium">{{ questions[currentStep].question }}</h3>
        <p v-if="questions[currentStep].category" class="mb-4 text-xs text-muted">{{ questions[currentStep].category }}</p>
        <div class="space-y-2">
          <button
            v-for="(opt, i) in questions[currentStep].options"
            :key="i"
            class="flex w-full items-center gap-3 rounded-lg border p-3 text-left transition hover:bg-elevated"
            :class="answers[currentStep] === i ? 'border-primary bg-primary/10' : 'border-default'"
            @click="answers[currentStep] = i"
          >
            <div class="flex size-6 items-center justify-center rounded-full border" :class="answers[currentStep] === i ? 'border-primary bg-primary text-white' : ''">
              <span v-if="answers[currentStep] === i" class="text-xs">✓</span>
            </div>
            <span class="text-sm">{{ opt }}</span>
          </button>
        </div>
      </UCard>

      <div class="mt-6 flex justify-between">
        <UButton
          variant="soft"
          :disabled="currentStep === 0"
          label="上一题"
          @click="currentStep--"
        />
        <UButton
          v-if="currentStep < questions.length - 1"
          :disabled="answers[currentStep] === -1"
          label="下一题"
          @click="currentStep++"
        />
        <UButton
          v-else
          color="primary"
          :disabled="answers[currentStep] === -1"
          label="提交测评"
          @click="submit"
        />
      </div>
    </div>
  </UContainer>
</template>
