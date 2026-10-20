<script setup lang="ts">

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

async function loadReports() {
  loading.value = true
  try {
    reports.value = await $fetch<Report[]>("/api/reports")
  } catch {

    // 忽略

  } finally {
    loading.value = false
  }
}

onMounted(loadReports)

async function generate() {
  generating.value = true
  try {
    currentReport.value = await $fetch("/api/reports/generate", { method: "POST" })
    await loadReports()
  } catch {

    // 忽略

  } finally {
    generating.value = false
  }
}

function viewReport(report: Report) {
  if (report.summary) {
    try {
      currentReport.value = JSON.parse(report.summary)
    } catch {

      // 忽略

    }
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
            <div class="space-y-2">
              <div v-for="(val, key) in (currentReport.skillBreakdown as Record<string, number>)" :key="key" class="flex items-center gap-2">
                <span class="w-16 text-sm text-muted">{{ key }}</span>
                <UProgress :value="val" :max="10" class="flex-1" />
                <span class="w-8 text-sm text-right">{{ val }}</span>
              </div>
            </div>
          </div>
        </div>

        <!-- 建议 -->
        <div class="mt-6 rounded-lg bg-elevated p-4">
          <h3 class="mb-1 font-medium">学习建议</h3>
          <p class="text-sm text-muted">{{ currentReport.recommendation as string }}</p>
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
