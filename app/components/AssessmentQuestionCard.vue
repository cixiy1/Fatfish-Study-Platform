<script setup lang="ts">
import { QUESTION_KIND_ICON, QUESTION_KIND_LABEL } from "#shared/types/assessment"
import type { AnswerValue, AssessmentQuestion } from "#shared/types/assessment"

/**
 * 一道测评题的渲染。
 *
 * 六种题型各自一套交互：单选/多选是选项卡、填空按题干里的 [[n]] 内联输入、
 * 表单是字段列表、自评是刻度按钮、开放题是文本域。
 * 作答值的形状由父组件按题型初始化（emptyAnswer），这里只负责读写同一份引用。
 */

const props = defineProps<{ question: AssessmentQuestion }>()
const answer = defineModel<AnswerValue>({ required: true })

/** 题干按 [[1]] [[2]] 切成「文本 / 空位」片段 */
const blankParts = computed(() => {
  const parts: { text?: string, slot?: number }[] = []
  const text = props.question.question
  const regex = /\[\[(\d+)\]\]/g
  let last = 0
  let match = regex.exec(text)
  while (match) {
    if (match.index > last) parts.push({ text: text.slice(last, match.index) })
    parts.push({ slot: Number(match[1]) - 1 })
    last = match.index + match[0].length
    match = regex.exec(text)
  }
  if (last < text.length) parts.push({ text: text.slice(last) })
  return parts
})

const hasInlineBlanks = computed(() => blankParts.value.some((part) => part.slot !== undefined))

const blankCount = computed(() => props.question.blanks?.length ?? 1)

function blankAt(index: number): string {
  const value = answer.value
  if (!Array.isArray(value)) return ""
  return String(value[index] ?? "")
}

function setBlank(index: number, text: string) {
  const current = Array.isArray(answer.value) ? [...answer.value] : new Array(blankCount.value).fill("")
  current[index] = text
  answer.value = current
}

const singleValue = computed<number>({
  get: () => (typeof answer.value === "number" ? answer.value : -1),
  set: (value) => { answer.value = value },
})

const multiValue = computed<number[]>({
  get: () => (Array.isArray(answer.value) ? answer.value as number[] : []),
  set: (value) => { answer.value = value },
})

function toggleMulti(index: number) {
  const picked = new Set(multiValue.value)
  if (picked.has(index)) picked.delete(index)
  else picked.add(index)
  // 保序：按下标升序存，分析时选项顺序稳定
  multiValue.value = [...picked].sort((a, b) => a - b)
}

const formValue = computed<Record<string, string>>({
  get: () => {
    const value = answer.value
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, string> : {}
  },
  set: (value) => { answer.value = value },
})

function setField(key: string, text: string) {
  // 必须换新对象：直接改属性 Vue 追踪不到这个替换
  formValue.value = { ...formValue.value, [key]: text }
}

const scale = computed(() => props.question.scale ?? { min: 1, max: 5, minLabel: "完全没接触", maxLabel: "能独立完成" })

const scaleSteps = computed(() => {
  const { min, max } = scale.value
  return Array.from({ length: Math.max(2, max - min + 1) }, (_, i) => min + i)
})

const scaleValue = computed<number | null>({
  get: () => (typeof answer.value === "number" ? answer.value : null),
  set: (value) => { answer.value = value },
})

const textValue = computed<string>({
  get: () => (typeof answer.value === "string" ? answer.value : ""),
  set: (value) => { answer.value = value },
})
</script>

<template>
  <div>
    <div class="mb-2 flex flex-wrap items-center gap-2">
      <UBadge color="neutral" variant="soft" size="sm">
        <UIcon :name="QUESTION_KIND_ICON[question.kind]" class="mr-1 size-3.5" />
        {{ QUESTION_KIND_LABEL[question.kind] }}
      </UBadge>
      <span class="text-xs text-muted">{{ question.category }}</span>
    </div>

    <!-- 题干：填空有内联空位，其余题直接显示文字 -->
    <h3 class="font-medium leading-loose">
      <template v-if="question.kind === 'blank' && hasInlineBlanks">
        <template v-for="(part, i) in blankParts" :key="i">
          <span v-if="part.text !== undefined">{{ part.text }}</span>
          <input
            v-else
            :value="blankAt(part.slot ?? 0)"
            :placeholder="question.blanks?.[part.slot ?? 0]?.placeholder ?? '填写'"
            class="mx-1 inline-block h-7 w-24 rounded-md border border-default bg-default px-2 align-middle text-sm font-normal outline-none focus:border-primary"
            @input="setBlank(part.slot ?? 0, ($event.target as HTMLInputElement).value)"
          >
        </template>
      </template>
      <template v-else>{{ question.question }}</template>
    </h3>

    <p v-if="question.hint" class="mt-1 text-xs text-muted">{{ question.hint }}</p>

    <!-- 单选 -->
    <div v-if="question.kind === 'single'" class="mt-4 space-y-2">
      <button
        v-for="(opt, i) in question.options"
        :key="i"
        class="flex w-full items-center gap-3 rounded-lg border p-3 text-left transition hover:bg-elevated"
        :class="singleValue === i ? 'border-primary bg-primary/10' : 'border-default'"
        @click="singleValue = i"
      >
        <div
          class="flex size-6 shrink-0 items-center justify-center rounded-full border"
          :class="singleValue === i ? 'border-primary bg-primary text-white' : ''"
        >
          <span v-if="singleValue === i" class="text-xs">✓</span>
        </div>
        <span class="text-sm">{{ opt }}</span>
      </button>
    </div>

    <!-- 多选 -->
    <div v-else-if="question.kind === 'multi'" class="mt-4 space-y-2">
      <button
        v-for="(opt, i) in question.options"
        :key="i"
        class="flex w-full items-center gap-3 rounded-lg border p-3 text-left transition hover:bg-elevated"
        :class="multiValue.includes(i) ? 'border-primary bg-primary/10' : 'border-default'"
        @click="toggleMulti(i)"
      >
        <div
          class="flex size-6 shrink-0 items-center justify-center rounded-md border"
          :class="multiValue.includes(i) ? 'border-primary bg-primary text-white' : ''"
        >
          <span v-if="multiValue.includes(i)" class="text-xs">✓</span>
        </div>
        <span class="text-sm">{{ opt }}</span>
      </button>
      <p class="text-xs text-muted">可多选，选完点下一题</p>
    </div>

    <!-- 填空：题干里没有 [[n]] 占位时，按空位列表逐条填 -->
    <div v-else-if="question.kind === 'blank' && !hasInlineBlanks" class="mt-4 space-y-2">
      <div v-for="i in blankCount" :key="i" class="flex items-center gap-3">
        <span class="w-16 shrink-0 text-xs text-muted">
          {{ question.blanks?.[i - 1]?.label ?? `第 ${i} 空` }}
        </span>
        <UInput
          :model-value="blankAt(i - 1)"
          :placeholder="question.blanks?.[i - 1]?.placeholder ?? '填写答案'"
          class="flex-1"
          @update:model-value="setBlank(i - 1, String($event ?? ''))"
        />
      </div>
    </div>

    <!-- 表单 -->
    <div v-else-if="question.kind === 'form'" class="mt-4 space-y-3">
      <div v-for="field in question.fields" :key="field.key" class="flex flex-col gap-1.5">
        <label class="text-xs font-medium text-muted">
          {{ field.label }}
          <span v-if="field.required !== false" class="text-error">*</span>
        </label>
        <div class="flex items-center gap-2">
          <USelect
            v-if="field.type === 'select'"
            :model-value="formValue[field.key] ?? ''"
            :items="field.options ?? []"
            placeholder="请选择"
            class="flex-1"
            @update:model-value="setField(field.key, String($event ?? ''))"
          />
          <UInput
            v-else
            :model-value="formValue[field.key] ?? ''"
            :type="field.type === 'number' ? 'number' : 'text'"
            :placeholder="field.placeholder ?? ''"
            class="flex-1"
            @update:model-value="setField(field.key, String($event ?? ''))"
          />
          <span v-if="field.unit" class="shrink-0 text-sm text-muted">{{ field.unit }}</span>
        </div>
      </div>
    </div>

    <!-- 自评量表 -->
    <div v-else-if="question.kind === 'scale'" class="mt-4">
      <div class="flex gap-2">
        <button
          v-for="step in scaleSteps"
          :key="step"
          class="flex-1 rounded-lg border py-3 text-center transition hover:bg-elevated"
          :class="scaleValue === step ? 'border-primary bg-primary/10 font-medium text-primary' : 'border-default'"
          @click="scaleValue = step"
        >
          {{ step }}
        </button>
      </div>
      <div class="mt-2 flex justify-between text-xs text-muted">
        <span>{{ scale.minLabel }}</span>
        <span>{{ scale.maxLabel }}</span>
      </div>
    </div>

    <!-- 开放题 -->
    <div v-else-if="question.kind === 'text'" class="mt-4">
      <UTextarea
        v-model="textValue"
        :placeholder="question.placeholder ?? '写下你的想法，一两句话即可'"
        :rows="3"
        class="w-full"
      />
    </div>
  </div>
</template>
