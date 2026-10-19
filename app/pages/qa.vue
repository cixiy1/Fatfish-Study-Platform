<script setup lang="ts">
definePageMeta({ layout: 'learning' })

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
      <p class="mt-1 text-sm text-muted">输入专业或职业相关问题，获取知识点与学习资料推荐</p>
    </div>

    <!-- 提问 -->
    <UCard class="mb-6">
      <div class="flex gap-3">
        <UInput
          v-model="question"
          placeholder="例如：如何学习 Vue.js？/ Python 数据分析怎么入门？"
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
      <div class="whitespace-pre-wrap text-sm text-muted">{{ currentAnswer.answer }}</div>
    </UCard>

    <!-- 历史 -->
    <div v-if="loading" class="py-10 text-center text-muted">加载中…</div>
    <div v-else>
      <h2 class="mb-4 font-medium">问答历史</h2>
      <div v-if="history.length === 0" class="py-10 text-center text-muted">暂无记录</div>
      <div v-else class="space-y-3">
        <UCard v-for="item in history" :key="item.id">
          <div class="mb-2 font-medium text-sm">{{ item.question }}</div>
          <div v-if="item.answer" class="whitespace-pre-wrap text-xs text-muted">{{ item.answer }}</div>
          <div class="mt-2 text-xs text-muted">{{ item.created_at }}</div>
        </UCard>
      </div>
    </div>
  </UContainer>
</template>
