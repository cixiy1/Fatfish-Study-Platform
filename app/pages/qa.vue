<script setup lang="ts">

useHead({ title: "智能答疑 · FSP" })

interface QARecord {
  id: number
  question: string
  answer: string | null
  created_at: string
}

const loading = ref(true)
const asking = ref(false)
const history = ref<QARecord[]>([])
const question = ref("")
const currentAnswer = ref<{ question: string, answer: string } | null>(null)

/** 答案是 Markdown，渲染成 HTML；renderMarkdown 先转义再拼标签，可安全 v-html */
function answerHtml(answer: string | null) {
  return renderMarkdown(answer)
}

async function loadHistory() {
  loading.value = true
  try {
    history.value = await $fetch<QARecord[]>("/api/qa")
  } catch {

    // 忽略

  } finally {
    loading.value = false
  }
}

onMounted(loadHistory)

async function ask() {
  if (!question.value.trim()) return
  asking.value = true
  currentAnswer.value = null
  try {
    currentAnswer.value = await $fetch<{ question: string, answer: string }>("/api/qa", {
      method: "POST",
      body: { question: question.value },
    })
    question.value = ""
    await loadHistory()
  } catch {

    // 忽略

  } finally {
    asking.value = false
  }
}
</script>

<template>
  <UContainer class="py-10">
    <div class="mb-8">
      <h1 class="text-2xl font-semibold tracking-tight">智能答疑</h1>
      <p class="mt-1 text-sm text-muted">针对任一知识点提问，获取讲解与学习资料推荐</p>
    </div>

    <!-- 提问 -->
    <UCard class="mb-6">
      <div class="flex gap-3">
        <UInput
          v-model="question"
          placeholder="例如：如何入门 Vue.js？Python 数据分析的学习顺序？"
          class="flex-1"
          size="lg"
          @keyup.enter="ask"
        />
        <UButton color="primary" size="lg" :loading="asking" label="提问" @click="ask" />
      </div>
    </UCard>

    <!-- 当前回答 -->
    <UCard v-if="currentAnswer" class="mb-6">
      <div class="mb-3 font-medium">{{ currentAnswer.question }}</div>
      <div class="qa-answer text-sm text-muted" v-html="answerHtml(currentAnswer.answer)" />
    </UCard>

    <!-- 历史 -->
    <div v-if="loading" class="py-10 text-center text-muted">加载中…</div>
    <div v-else>
      <h2 class="mb-4 font-medium">问答历史</h2>
      <div v-if="history.length === 0" class="py-10 text-center text-muted">暂无记录</div>
      <div v-else class="space-y-3">
        <UCard v-for="item in history" :key="item.id">
          <div class="mb-2 font-medium text-sm">{{ item.question }}</div>
          <div v-if="item.answer" class="qa-answer text-sm text-muted" v-html="answerHtml(item.answer)" />
          <div class="mt-2 text-xs text-muted">{{ formatDateTime(item.created_at) }}</div>
        </UCard>
      </div>
    </div>
  </UContainer>
</template>

<style scoped>
.qa-answer :deep(p) {
  margin: 0.5rem 0;
  line-height: 1.7;
}

.qa-answer :deep(strong) {
  color: var(--ui-text-highlighted);
  font-weight: 600;
}

.qa-answer :deep(ul),
.qa-answer :deep(ol) {
  margin: 0.5rem 0;
  padding-left: 1.25rem;
}

.qa-answer :deep(ul) {
  list-style: disc;
}

.qa-answer :deep(ol) {
  list-style: decimal;
}

.qa-answer :deep(li) {
  margin: 0.25rem 0;
  line-height: 1.6;
}

.qa-answer :deep(a) {
  color: var(--ui-primary, #0d9488);
  text-decoration: underline;
  text-underline-offset: 2px;
}

.qa-answer :deep(code) {
  border-radius: 0.25rem;
  background: var(--ui-bg-elevated, #f1f5f9);
  padding: 0.1rem 0.3rem;
  font-size: 0.8125rem;
}
</style>
