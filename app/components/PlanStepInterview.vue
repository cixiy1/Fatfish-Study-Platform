<script setup lang="ts">
import type { DirectionMessage } from "#shared/types/direction"

/**
 * 方向访谈的对话界面：一屏一问，点选即答，也可以自己输入。
 */
const props = defineProps<{
  messages: DirectionMessage[]
  question: string
  options: string[]
  loading: boolean
  error: string
}>()

const emit = defineEmits<{ answer: [text: string] }>()

const custom = ref("")

const transcript = computed(() =>
  props.messages.filter((message) => message.content.trim().length > 0),
)

function pick(option: string) {
  if (props.loading) return
  // 「其他（我自己说）」只把焦点交给输入框，不直接发出去
  if (option.includes("我自己说")) {
    custom.value = ""
    return
  }
  emit("answer", option)
}

function submitCustom() {
  const value = custom.value.trim()
  if (!value || props.loading) return
  custom.value = ""
  emit("answer", value)
}
</script>

<template>
  <div>
    <h1 class="text-2xl font-semibold tracking-tight sm:text-3xl">明确学习目标</h1>
    <p class="mt-2 text-sm text-muted">回答 3~5 个问题，用于生成匹配的学习方向。</p>

    <div class="mt-6 space-y-3" aria-live="polite">
      <div
        v-for="(message, index) in transcript"
        :key="index"
        class="flex"
        :class="message.role === 'user' ? 'justify-end' : 'justify-start'"
      >
        <p
          class="max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed"
          :class="message.role === 'user'
            ? 'bg-primary text-white'
            : 'bg-elevated text-default'"
        >
          {{ message.content }}
        </p>
      </div>
    </div>

    <div v-if="loading" class="mt-6">
      <AiThinking title="正在生成问题" />
    </div>

    <div v-else-if="question" class="mt-6">
      <div class="space-y-2">
        <button
          v-for="option in options"
          :key="option"
          type="button"
          class="w-full rounded-xl border-2 border-default p-3 text-left text-sm transition hover:border-primary/40 hover:bg-elevated"
          @click="pick(option)"
        >
          {{ option }}
        </button>
      </div>

      <div class="mt-3 flex gap-2">
        <UInput
          v-model="custom"
          class="flex-1"
          size="lg"
          placeholder="或直接描述你的情况"
          aria-label="自定义回答"
          @keyup.enter="submitCustom"
        />
        <UButton
          size="lg"
          :disabled="!custom.trim()"
          label="发送"
          icon="i-lucide-arrow-right"
          @click="submitCustom"
        />
      </div>
    </div>

    <p v-if="error" class="mt-4 rounded-lg bg-error/10 px-3 py-2 text-sm text-error">
      {{ error }}
    </p>
  </div>
</template>
