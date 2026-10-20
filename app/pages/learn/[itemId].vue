<script setup lang="ts">
/**
 * 单关学习页：一关 = 一个技能点 + 一个学习资源。
 * 完成动作走 PATCH /api/learning-path/item/:id，成功后刷新仪表盘并回关卡地图。
 */
const route = useRoute()
const id = Number(route.params.itemId)

interface ItemDetail {
  item: {
    id: number
    status: string
    sortOrder: number
    index: number
    total: number
    estimatedMinutes: number | null
  }
  skill: {
    id: number
    name: string
    category: string
    level: number
    description: string | null
  } | null
  resource: {
    id: number
    title: string
    type: string
    url: string | null
    difficulty: string
    description: string | null
    summary: string | null
    objectives: string[]
    content: string | null
    duration: number | null
    generated: boolean
  } | null
  prevId: number | null
  nextId: number | null
}

const fetcher = import.meta.server ? useRequestFetch() : $fetch
const {
  data,
  error,
  refresh: refreshDetail,
} = await useAsyncData<ItemDetail>(`learn-item-${id}`, () =>
  fetcher<ItemDetail>(`/api/learning-path/item/${id}`),
)

if (error.value || !data.value) {
  throw createError({ statusCode: 404, statusMessage: "关卡不存在", fatal: true })
}

const detail = computed(() => data.value)
const skillName = computed(() => detail.value?.skill?.name ?? "学习资源")

// 只有 AI 生成且带正文的资料才走「正文阅读」形态，外链资料保持跳转
const hasContent = computed(() => Boolean(detail.value?.resource?.generated && detail.value.resource.content))
const contentHtml = computed(() => renderMarkdown(detail.value?.resource?.content))

useHead(() => ({ title: `${skillName.value} · FSP` }))

const { refresh } = useLearner()
const toast = useToast()

const completing = ref(false)

// 打开即视为"进行中"，让路径页能反映真实进度
onMounted(() => {
  if (data.value?.item.status === "pending") {
    $fetch(`/api/learning-path/item/${id}`, {
      method: "PATCH",
      body: { status: "in_progress" },
    }).catch(() => {})
  }
})

async function complete() {
  completing.value = true
  try {
    await $fetch(`/api/learning-path/item/${id}`, {
      method: "PATCH",
      body: { status: "completed" },
    })
    await Promise.all([refresh(), refreshDetail()])
    toast.add({
      title: "本关完成",
      description: "+10 XP，下一关已解锁",
      color: "success",
      icon: "i-lucide-check",
    })
    await navigateTo("/learning")
  } catch (err) {
    const message = (err as { data?: { message?: string } })?.data?.message
    toast.add({
      title: "无法完成这一关",
      description: message || "请稍后重试",
      color: "error",
    })
  } finally {
    completing.value = false
  }
}
</script>

<template>
  <div v-if="detail" class="mx-auto w-full max-w-2xl px-4 py-8">
    <div class="flex items-center justify-between">
      <UButton
        to="/learning"
        variant="ghost"
        color="neutral"
        size="sm"
        icon="i-lucide-arrow-left"
        label="返回路径"
      />
      <span class="text-sm tabular-nums text-muted">
        第 {{ detail.item.index }}/{{ detail.item.total }} 关
      </span>
    </div>

    <div class="mt-6">
      <p class="text-xs text-muted">
        {{ detail.skill?.category ?? "学习资源" }}
        <template v-if="detail.skill?.level"> · 难度 {{ detail.skill.level }}/5</template>
      </p>
      <h1 class="mt-1 text-2xl font-semibold tracking-tight">{{ skillName }}</h1>
      <UBadge
        v-if="detail.item.status === 'completed'"
        class="mt-2"
        color="success"
        variant="soft"
        size="sm"
      >
        已完成
      </UBadge>
    </div>

    <!-- 生成形态：目标 + 正文，读完就能直接做 -->
    <template v-if="hasContent">
      <UCard v-if="detail.resource?.objectives.length" class="mt-6">
        <h2 class="text-sm font-medium text-muted">学完这一关，你能</h2>
        <ul class="mt-3 space-y-2">
          <li
            v-for="objective in detail.resource.objectives"
            :key="objective"
            class="flex items-start gap-2 text-sm"
          >
            <UIcon name="i-lucide-circle-check" class="mt-0.5 size-4 shrink-0 text-primary" />
            <span>{{ objective }}</span>
          </li>
        </ul>
      </UCard>

      <article class="lesson-body mt-6" v-html="contentHtml" />

      <p v-if="detail.resource" class="mt-4 text-xs text-muted">
        约 {{ detail.resource.duration ?? 15 }} 分钟 · 内容由 AI 按学习方向生成
      </p>
    </template>

    <UCard v-else-if="detail.resource" class="mt-6">
      <div class="flex items-start gap-3">
        <span class="grid size-10 shrink-0 place-items-center rounded-lg bg-elevated">
          <UIcon name="i-lucide-book-open" class="size-5" />
        </span>
        <div class="min-w-0 flex-1">
          <p class="font-medium">{{ detail.resource.title }}</p>
          <p class="mt-1 text-sm text-muted">
            {{ detail.resource.type }} · {{ detail.resource.difficulty }}
            <template v-if="detail.resource.duration">
              · 约 {{ detail.resource.duration }} 分钟
            </template>
          </p>
          <p v-if="detail.resource.description" class="mt-2 text-sm text-muted">
            {{ detail.resource.description }}
          </p>
          <UButton
            v-if="detail.resource.url"
            class="mt-3"
            :to="detail.resource.url"
            target="_blank"
            size="sm"
            variant="soft"
            label="打开学习资料"
            trailing-icon="i-lucide-external-link"
          />
        </div>
      </div>
    </UCard>

    <UCard v-else class="mt-6">
      <div class="flex items-start gap-3">
        <span class="grid size-10 shrink-0 place-items-center rounded-lg bg-elevated">
          <UIcon name="i-lucide-message-circle-question" class="size-5" />
        </span>
        <div class="min-w-0 flex-1">
          <p class="font-medium">本关尚未关联资料</p>
          <p class="mt-1 text-sm text-muted">
            可在答疑区针对本关提问，答案会标注知识点出处。
          </p>
          <UButton
            class="mt-3"
            to="/qa"
            size="sm"
            variant="soft"
            label="发起答疑"
            icon="i-lucide-arrow-right"
          />
        </div>
      </div>
    </UCard>

    <section v-if="!hasContent" class="mt-8">
      <h2 class="text-sm font-medium text-muted">本关学习目标</h2>
      <p class="mt-2 whitespace-pre-line text-sm leading-relaxed">
        {{ detail.skill?.description || "本关暂无正文，可先阅读上方资料，完成后继续下一关。" }}
      </p>
      <UButton
        class="mt-4"
        to="/qa"
        variant="ghost"
        color="neutral"
        size="sm"
        icon="i-lucide-message-circle-question"
        label="本关有疑问？发起答疑"
      />
    </section>

    <div class="mt-10">
      <UButton
        v-if="detail.item.status !== 'completed'"
        block
        size="lg"
        :loading="completing"
        label="完成本关"
        icon="i-lucide-check"
        @click="complete"
      />
      <UButton
        v-else
        block
        size="lg"
        to="/learning"
        label="返回关卡路径"
        icon="i-lucide-route"
      />
    </div>

    <div class="mt-4 flex items-center justify-between">
      <UButton
        v-if="detail.prevId"
        :to="`/learn/${detail.prevId}`"
        variant="ghost"
        color="neutral"
        size="sm"
        icon="i-lucide-arrow-left"
        label="上一关"
      />
      <span v-else />

      <UButton
        v-if="detail.nextId && detail.item.status === 'completed'"
        :to="`/learn/${detail.nextId}`"
        variant="ghost"
        color="neutral"
        size="sm"
        trailing-icon="i-lucide-arrow-right"
        label="下一关"
      />
    </div>
  </div>
</template>

<style scoped>
/* v-html 的内容在 scoped 下需要 :deep 才能命中 */
.lesson-body :deep(h2) {
  margin-top: 1.75rem;
  margin-bottom: 0.5rem;
  font-size: 1.0625rem;
  font-weight: 600;
  letter-spacing: -0.01em;
}

.lesson-body :deep(h2:first-child) {
  margin-top: 0;
}

.lesson-body :deep(h3) {
  margin-top: 1.25rem;
  margin-bottom: 0.375rem;
  font-size: 0.9375rem;
  font-weight: 600;
}

.lesson-body :deep(p) {
  margin-bottom: 0.75rem;
  font-size: 0.9375rem;
  line-height: 1.75;
}

.lesson-body :deep(ul),
.lesson-body :deep(ol) {
  margin-bottom: 0.875rem;
  padding-left: 1.25rem;
  font-size: 0.9375rem;
  line-height: 1.75;
}

.lesson-body :deep(ul) {
  list-style: disc;
}

.lesson-body :deep(ol) {
  list-style: decimal;
}

.lesson-body :deep(li) {
  margin-bottom: 0.25rem;
}

.lesson-body :deep(strong) {
  font-weight: 600;
}

.lesson-body :deep(code) {
  border-radius: 0.25rem;
  background: var(--ui-bg-elevated);
  padding: 0.1rem 0.3rem;
  font-size: 0.85em;
}

.lesson-body :deep(pre) {
  margin-bottom: 0.875rem;
  overflow-x: auto;
  border-radius: 0.5rem;
  background: var(--ui-bg-elevated);
  padding: 0.875rem 1rem;
}

.lesson-body :deep(pre code) {
  background: transparent;
  padding: 0;
  font-size: 0.8125rem;
  line-height: 1.6;
}

.lesson-body :deep(blockquote) {
  margin-bottom: 0.875rem;
  border-left: 3px solid var(--ui-border);
  padding-left: 0.875rem;
  color: var(--ui-text-muted);
  font-size: 0.875rem;
}

.lesson-body :deep(hr) {
  margin: 1.5rem 0;
  border-color: var(--ui-border);
}
</style>
