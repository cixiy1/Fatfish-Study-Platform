<script setup lang="ts">

import { postSse } from "~/composables/useSse"

useHead({ title: "学习复盘 · FSP" })

interface Report {
  id: number
  type: string
  summary: string | null
  created_at: string
}

const loading = ref(true)
const generating = ref(false)
const reports = ref<Report[]>([])
const currentReport = ref<Record<string, unknown> | null>(null)
const errorMessage = ref("")

// 大模型叙述的流式片段；stats 事件一到，数字区就已经渲染完，这里只补文字
const streamText = ref("")
const narrativePreview = computed(() => {
  const text = streamText.value
  const fenced = text.indexOf("```json")
  if (fenced >= 0) return text.slice(0, fenced).trim()
  const brace = text.indexOf("{")
  if (brace >= 0) return text.slice(0, brace).trim()
  return text.trim()
})

const reportHighlights = computed(() => (currentReport.value?.highlights as string[] | undefined) ?? [])
const reportGaps = computed(() => (currentReport.value?.gaps as string[] | undefined) ?? [])
const reportNextSteps = computed(
  () => (currentReport.value?.nextSteps as { title: string, reason: string }[] | undefined) ?? [],
)
const skillBreakdown = computed(
  () => (currentReport.value?.skillBreakdown as Record<string, number> | undefined) ?? {},
)
const isAiGenerated = computed(() => currentReport.value?.aiGenerated === true)
const reportModel = computed(() => (currentReport.value?.model as string | null | undefined) ?? null)
const degradedReason = computed(() => (currentReport.value?.degradedReason as string | null | undefined) ?? null)
const isEmptyReport = computed(() => currentReport.value?.empty === true)

async function loadReports() {
  loading.value = true
  try {
    reports.value = await $fetch<Report[]>("/api/reports")
  } catch {
    errorMessage.value = "加载历史报告失败"
  } finally {
    loading.value = false
  }
}

onMounted(loadReports)

async function generate() {
  generating.value = true
  errorMessage.value = ""
  streamText.value = ""
  currentReport.value = null

  try {
    await postSse("/api/reports/generate.stream", {}, {
      // 客观数字先到，先把统计区填满，用户不用干等大模型
      stats: (data) => {
        currentReport.value = { ...data, aiGenerated: false, summary: "" }
      },
      chunk: (data) => { streamText.value += data.text ?? "" },
      done: async (data) => {
        currentReport.value = data
        streamText.value = ""
        await loadReports()
      },
      error: (data) => {
        errorMessage.value = data.message ?? "生成失败，请稍后重试"
      },
    })
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "生成失败，请稍后重试"
  } finally {
    generating.value = false
  }
}

function viewReport(report: Report) {
  if (!report.summary) return
  try {
    currentReport.value = JSON.parse(report.summary)
    errorMessage.value = ""
  } catch {
    errorMessage.value = "这条报告的历史格式无法解析"
  }
}
</script>

<template>
  <UContainer class="py-10">
    <div class="mb-8 flex items-center justify-between">
      <div>
        <h1 class="text-2xl font-semibold tracking-tight">学习复盘</h1>
        <p class="mt-1 text-sm text-muted">汇总学习数据，评估阶段成效</p>
      </div>
      <UButton color="primary" :loading="generating" label="生成报告" @click="generate" />
    </div>

    <UAlert
      v-if="errorMessage"
      color="warning"
      variant="soft"
      class="mb-6"
      :title="errorMessage"
    />

    <!-- 当前报告 -->
    <div v-if="currentReport" class="mb-8">
      <UCard>
        <template #header>
          <h2 class="font-medium">学习报告概览</h2>
        </template>
        <div class="grid gap-6 md:grid-cols-2">
          <!-- 概览数据 -->
          <div>
            <h3 class="mb-3 font-medium">总体情况</h3>
            <div class="space-y-2 text-sm">
              <div class="flex justify-between">
                <span class="text-muted">测评次数</span>
                <span class="font-medium">{{ (currentReport.overview as Record<string, number>)?.totalAssessments ?? 0 }}</span>
              </div>
              <div class="flex justify-between">
                <span class="text-muted">已掌握技能</span>
                <span class="font-medium">{{ (currentReport.overview as Record<string, number>)?.masteredSkills ?? 0 }}</span>
              </div>
              <div class="flex justify-between">
                <span class="text-muted">学习中技能</span>
                <span class="font-medium">{{ (currentReport.overview as Record<string, number>)?.learningSkills ?? 0 }}</span>
              </div>
              <div class="flex justify-between">
                <span class="text-muted">掌握率</span>
                <span class="font-medium">{{ (currentReport.overview as Record<string, number>)?.masteryRate ?? 0 }}%</span>
              </div>
              <div class="flex justify-between">
                <span class="text-muted">学习路径</span>
                <span class="font-medium">{{ (currentReport.overview as Record<string, number>)?.learningPaths ?? 0 }}</span>
              </div>
            </div>
          </div>

          <!-- 技能分布 -->
          <div>
            <h3 class="mb-3 font-medium">技能分布</h3>
            <div v-if="Object.keys(skillBreakdown).length > 0" class="space-y-2">
              <div v-for="(val, key) in skillBreakdown" :key="key" class="flex items-center gap-2">
                <span class="w-16 shrink-0 truncate text-sm text-muted">{{ key }}</span>
                <UProgress
                  :value="val"
                  :max="Math.max(...Object.values(skillBreakdown))"
                  class="flex-1"
                />
                <span class="w-8 text-right text-sm">{{ val }}</span>
              </div>
            </div>
            <p v-else class="text-sm text-muted">
              还没有完成任何关卡
            </p>
          </div>
        </div>

        <!-- 阶段复盘：文字部分由大模型生成，失败时明确标注 -->
        <div class="mt-6 space-y-5 border-t border-default pt-6">
          <div>
            <div class="mb-2 flex flex-wrap items-center gap-2">
              <h3 class="font-medium">
                阶段复盘
              </h3>
              <UBadge v-if="isAiGenerated" color="success" variant="soft" size="sm">
                {{ reportModel || "大模型" }}
              </UBadge>
              <UBadge v-else-if="generating" color="info" variant="soft" size="sm">
                正在生成
              </UBadge>
              <UBadge v-else color="warning" variant="soft" size="sm">
                本次未生成文字复盘
              </UBadge>
            </div>
            <p
              v-if="generating"
              class="whitespace-pre-wrap text-sm leading-relaxed text-muted"
            >
              {{ narrativePreview }}<span class="animate-pulse text-primary">▌</span>
            </p>
            <p v-else class="text-sm leading-relaxed text-muted">
              {{ (currentReport.summary as string) || (currentReport.recommendation as string) }}
            </p>
            <p v-if="!isAiGenerated && degradedReason" class="mt-2 text-xs text-warning">
              大模型调用失败：{{ degradedReason }}
            </p>
          </div>

          <div v-if="reportHighlights.length > 0">
            <h4 class="mb-2 text-sm font-medium">
              做得好的
            </h4>
            <ul class="space-y-1.5 text-sm text-muted">
              <li v-for="item in reportHighlights" :key="item" class="flex gap-2">
                <UIcon name="i-lucide-circle-check" class="mt-0.5 size-4 shrink-0 text-success" />
                <span>{{ item }}</span>
              </li>
            </ul>
          </div>

          <div v-if="reportGaps.length > 0">
            <h4 class="mb-2 text-sm font-medium">
              待补强
            </h4>
            <ul class="space-y-1.5 text-sm text-muted">
              <li v-for="item in reportGaps" :key="item" class="flex gap-2">
                <UIcon name="i-lucide-triangle-alert" class="mt-0.5 size-4 shrink-0 text-warning" />
                <span>{{ item }}</span>
              </li>
            </ul>
          </div>

          <div v-if="reportNextSteps.length > 0">
            <h4 class="mb-2 text-sm font-medium">
              下一步
            </h4>
            <ol class="space-y-2">
              <li v-for="(step, index) in reportNextSteps" :key="step.title" class="flex gap-3">
                <span
                  class="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-primary/10 text-xs font-medium text-primary"
                >
                  {{ index + 1 }}
                </span>
                <div class="min-w-0">
                  <p class="text-sm font-medium">
                    {{ step.title }}
                  </p>
                  <p v-if="step.reason" class="text-xs text-muted">
                    {{ step.reason }}
                  </p>
                </div>
              </li>
            </ol>
          </div>
        </div>
      </UCard>
    </div>

    <!-- 历史报告 -->
    <div v-if="loading" class="py-10 text-center text-muted">加载中…</div>
    <div v-else>
      <h2 class="mb-4 font-medium">历史报告</h2>
      <div v-if="reports.length === 0" class="py-10 text-center text-muted">暂无报告</div>
      <div v-else class="space-y-3">
        <UCard
          v-for="r in reports"
          :key="r.id"
          class="cursor-pointer transition hover:shadow"
          @click="viewReport(r)"
        >
          <div class="flex items-center justify-between">
            <span class="font-medium">{{ r.type === "stage" ? "阶段性报告" : r.type }}</span>
            <span class="text-sm text-muted">{{ formatDateTime(r.created_at) }}</span>
          </div>
        </UCard>
      </div>
    </div>
  </UContainer>
</template>
