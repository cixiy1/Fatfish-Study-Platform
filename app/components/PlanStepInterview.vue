<script setup lang="ts">
import type { AnswerValue, AssessmentQuestion } from "#shared/types/assessment"
import type { DirectionMessage } from "#shared/types/direction"
import { emptyAnswer, isAnswered } from "#shared/utils/assessment"

/**
 * 方向访谈的提问界面。
 *
 * 早期只能「单选 + 自由输入」，问什么都变成点选项。现在模型按信息类型挑题型：
 * 基础用自评、时间用表单、偏好用多选、具体考试用填空、目标可以放开写。
 * 这里只负责渲染当前这一题和已答记录，题型细节交给 AssessmentQuestionCard。
 */
const props = defineProps<{
  messages: DirectionMessage[]
  ask: AssessmentQuestion | null
  /** 模型正在流式撰写中的题干 */
  streamText: string
  turn: number
  loading: boolean
  error: string
}>()

const emit = defineEmits<{ answer: [value: AnswerValue], skip: [], retry: [] }>()

const draft = ref<AnswerValue>(null)
const custom = ref("")
/** 选项不合适时的自由输入口，默认收起，别抢了主交互的注意力 */
const showCustom = ref(false)

watch(
  () => props.ask,
  (ask) => {
    draft.value = ask ? emptyAnswer(ask) : null
    custom.value = ""
    showCustom.value = false
  },
  { immediate: true },
)

/** 已答完的问答：题干是上一条 assistant，回答是紧随其后的 user */
const pairs = computed(() => {
  const out: { question: string, answer: string }[] = []
  for (let i = 1; i < props.messages.length; i++) {
    const previous = props.messages[i - 1]
    const current = props.messages[i]
    if (previous.role === "assistant" && current.role === "user") {
      out.push({ question: previous.content, answer: current.content })
    }
  }
  return out
})

const ready = computed(() => Boolean(props.ask) && isAnswered(props.ask!, draft.value))

/** 能否提交：自由输入模式下看输入框，其余看控件是否填全 */
const canSubmit = computed(() => (showCustom.value ? custom.value.trim().length > 0 : ready.value))

/** 开放题本身就能写，没有「换个说法」的必要 */
const canUseCustom = computed(() => !!props.ask && props.ask.kind !== "text")

function submit() {
  if (props.loading || !props.ask) return
  const typed = custom.value.trim()
  if (showCustom.value && typed) {
    emit("answer", typed)
    return
  }
  if (!ready.value) return
  emit("answer", draft.value)
}

function submitCustom() {
  const typed = custom.value.trim()
  if (!typed || props.loading) return
  emit("answer", typed)
}
</script>

<template>
  <div>
    <div class="flex items-baseline justify-between gap-3">
      <h1 class="text-2xl font-semibold tracking-tight sm:text-3xl">明确学习目标</h1>
      <span v-if="ask" class="shrink-0 text-xs text-muted">第 {{ turn }} 题</span>
    </div>
    <p class="mt-2 text-sm text-muted">回答 3~5 个问题，题型会跟着问题变——选择题、填空、表单、自评都可能出现。</p>

    <!-- 已答记录：只保留问答对，当前问题在下面用卡片呈现 -->
    <div v-if="pairs.length > 0" class="mt-6 space-y-2">
      <div v-for="(pair, index) in pairs" :key="index" class="rounded-xl bg-elevated/60 px-3.5 py-2.5">
        <p class="text-xs leading-relaxed text-muted">{{ pair.question }}</p>
        <p class="mt-1 text-sm leading-relaxed">{{ pair.answer }}</p>
      </div>
    </div>

    <!-- 模型还在思考：墨迹条慢慢走，不要抢在问题前面跑完 -->
    <div v-if="loading && !streamText" class="mt-6">
      <AiThinking title="正在生成问题" />
    </div>

    <!-- 模型开始写题干：逐字显示，像有人在把问题写出来 -->
    <div v-else-if="loading" class="mt-6 rounded-2xl border border-default bg-default p-4 sm:p-5">
      <div class="flex items-center gap-2 text-xs text-muted">
        <span class="size-2 animate-pulse rounded-full bg-primary" />
        正在撰写问题
      </div>
      <p class="mt-3 text-lg font-medium leading-relaxed">
        {{ streamText }}<span class="ai-caret" />
      </p>
    </div>

    <div v-else-if="ask" class="mt-6 rounded-2xl border border-default bg-default p-4 sm:p-5">
      <AssessmentQuestionCard v-model="draft" :question="ask" />

      <!-- 自由输入：模型给的选项不合适时兜底，别再强迫用户点一个不像自己的答案 -->
      <div v-if="canUseCustom" class="mt-4">
        <button
          v-if="!showCustom"
          type="button"
          class="text-xs text-muted underline-offset-2 hover:text-primary hover:underline"
          @click="showCustom = true"
        >
          都不太合适？直接说
        </button>
        <div v-else class="flex flex-col gap-2">
          <UTextarea
            v-model="custom"
            :rows="2"
            class="w-full"
            placeholder="用自己的话描述一下"
            @keydown.meta.enter.prevent="submitCustom"
            @keydown.ctrl.enter.prevent="submitCustom"
          />
          <div class="flex gap-2">
            <UButton size="sm" label="用这段话回答" :disabled="!custom.trim()" @click="submitCustom" />
            <UButton size="sm" variant="ghost" color="neutral" label="收起" @click="showCustom = false" />
          </div>
        </div>
      </div>

      <div class="mt-5">
        <UButton
          block
          size="lg"
          :color="canSubmit ? 'primary' : 'neutral'"
          :variant="canSubmit ? 'solid' : 'soft'"
          :disabled="!canSubmit"
          :label="ask.kind === 'text' ? '提交回答' : '继续'"
          @click="submit"
        />
      </div>
      <button
        v-if="ask.kind === 'text'"
        type="button"
        class="mt-3 block w-full text-center text-xs text-muted hover:text-primary"
        @click="emit('skip')"
      >
        不确定，先跳过
      </button>
    </div>

    <div v-if="error" class="mt-4 rounded-lg bg-error/10 px-3 py-2 text-sm text-error">
      <p>{{ error }}</p>
      <UButton
        v-if="!loading"
        class="mt-2"
        size="xs"
        variant="soft"
        color="error"
        label="重试这一步"
        icon="i-lucide-refresh-cw"
        @click="emit('retry')"
      />
    </div>
  </div>
</template>

<style scoped>
/* 流式撰写中的细光标：比 ▌ 字符更轻，不会把一句话的末尾压成一块色块 */
.ai-caret {
  display: inline-block;
  width: 2px;
  height: 1.05em;
  margin-left: 2px;
  vertical-align: -0.14em;
  background: var(--ui-primary);
  animation: ai-caret-blink 1s steps(2, start) infinite;
}

@keyframes ai-caret-blink {
  50% {
    opacity: 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .ai-caret {
    animation: none;
  }
}
</style>
