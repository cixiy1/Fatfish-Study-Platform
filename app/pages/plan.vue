<script setup lang="ts">
/**
 * 计划设置：调整每日学习时长、换学习方向。
 * 每日时长存在 user_profiles.profile_data，不改表结构。
 */
useHead({ title: "计划设置 · FSP" })

const { dashboard, refresh } = useLearner()
const toast = useToast()

const GOALS = [
  { minutes: 10, title: "轻度", desc: "每天约 1 关" },
  { minutes: 20, title: "标准", desc: "每天约 2 关" },
  { minutes: 40, title: "强化", desc: "每天约 4 关" },
]

const minutes = ref(20)
const saving = ref(false)

watchEffect(() => {
  if (dashboard.value) minutes.value = dashboard.value.dailyMinutes
})

async function save() {
  saving.value = true
  try {
    await $fetch("/api/plan", {
      method: "POST",
      body: { dailyMinutes: minutes.value },
    })
    await refresh()
    toast.add({
      title: "已保存",
      description: `每天学习 ${minutes.value} 分钟`,
      color: "success",
      icon: "i-lucide-check",
    })
  } catch {
    toast.add({ title: "保存失败", description: "请稍后重试", color: "error" })
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="mx-auto w-full max-w-2xl px-4 py-8">
    <h1 class="text-2xl font-semibold tracking-tight">计划设置</h1>
    <p class="mt-1 text-sm text-muted">调整每日时长或切换学习方向，关卡将按新设置重算。</p>

    <UCard class="mt-6">
      <template #header>
        <span class="font-medium">当前方向</span>
      </template>
      <div class="flex items-center justify-between gap-3">
        <div class="min-w-0">
          <p class="truncate font-medium">
            {{ dashboard?.position?.name ?? "还没有学习方向" }}
          </p>
          <p class="mt-1 text-sm text-muted">
            已完成 {{ dashboard?.completed ?? 0 }}/{{ dashboard?.total ?? 0 }} 关 ·
            {{ dashboard?.percent ?? 0 }}%
          </p>
        </div>
        <UButton
          to="/onboarding"
          size="sm"
          variant="soft"
          icon="i-lucide-plus"
          label="换方向"
        />
      </div>
    </UCard>

    <UCard class="mt-6">
      <template #header>
        <span class="font-medium">每日学习时长</span>
      </template>

      <div class="grid gap-3 sm:grid-cols-3">
        <button
          v-for="g in GOALS"
          :key="g.minutes"
          type="button"
          class="rounded-xl border-2 p-4 text-left transition"
          :class="
            minutes === g.minutes
              ? 'border-primary bg-primary/5'
              : 'border-default hover:border-primary/40'
          "
          :aria-pressed="minutes === g.minutes"
          @click="minutes = g.minutes"
        >
          <span class="block font-medium">{{ g.title }}</span>
          <span class="mt-1 block text-sm text-muted">{{ g.minutes }} 分钟 · {{ g.desc }}</span>
        </button>
      </div>

      <template #footer>
        <div class="flex justify-end">
          <UButton :loading="saving" label="保存设置" icon="i-lucide-save" @click="save" />
        </div>
      </template>
    </UCard>
  </div>
</template>
