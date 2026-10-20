<script setup lang="ts">
/**
 * 首页做登录态分流：
 * - 游客：价值主张 + 三步说明（只讲主线，不铺功能目录）
 * - 已登录：今日学习仪表盘（今天要做什么，而不是"有哪些功能"）
 */
definePageMeta({ auth: false })

const { user, isLoggedIn } = useAuthSession()
const { dashboard } = useLearner()

useHead(() => ({
  title: isLoggedIn.value ? "今日学习 · FSP" : "FSP · AI 学习平台",
  meta: [
    {
      name: "description",
      content: "面向任意主题的 AI 学习平台：访谈确认目标与基础，拆解技能点，生成按日推进的关卡路径。",
    },
  ],
}))

// 问候语依赖本地时间，SSR 与客户端可能不一致，只放在客户端赋值避免 hydration 抖动
const greeting = ref("你好")
onMounted(() => {
  const hour = new Date().getHours()
  greeting.value = hour < 6 ? "夜深了" : hour < 12 ? "早上好" : hour < 18 ? "下午好" : "晚上好"
})

const steps = [
  { icon: "i-lucide-message-circle", title: "描述目标", desc: "任一主题，一句话说明想学什么" },
  { icon: "i-lucide-timer", title: "设定节奏", desc: "每日 10 / 20 / 40 分钟，折算关卡数" },
  { icon: "i-lucide-swords", title: "按关推进", desc: "一关一个技能点，完成即解锁下一关" },
]
</script>

<template>
  <!-- ================= 游客 ================= -->
  <div v-if="!isLoggedIn">
    <section
      class="border-b border-default bg-gradient-to-br from-primary-50 to-neutral-50 dark:from-primary-950 dark:to-neutral-950"
    >
      <div class="mx-auto max-w-4xl px-4 py-20 text-center">
        <p class="mx-auto mt-3 inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-primary/5 px-3 py-1 text-xs text-primary">
          <UIcon name="i-lucide-sparkles" class="size-3.5" />
          任意主题 · AI 定制路径
        </p>
        <h1 class="mt-5 text-balance text-3xl font-bold tracking-tight sm:text-4xl">
          任何主题，拆成每天一关
        </h1>
        <p class="mx-auto mt-4 max-w-2xl text-balance text-muted">
          描述学习目标，AI 访谈确认基础后生成技能点与关卡。每天完成一关，自动解锁下一关。
        </p>
        <div class="mt-8 flex justify-center gap-3">
          <UButton to="/register" size="lg" label="开始使用" trailing-icon="i-lucide-arrow-right" />
          <UButton to="/login" size="lg" variant="outline" color="neutral" label="登录" />
        </div>
      </div>
    </section>

    <section class="mx-auto max-w-4xl px-4 py-14">
      <h2 class="text-center text-lg font-medium">三步开始</h2>      <div class="mt-8 grid gap-4 sm:grid-cols-3">
        <div
          v-for="(s, index) in steps"
          :key="s.title"
          class="rounded-xl border border-default p-5"
        >
          <div class="flex items-center gap-2">
            <span class="grid size-7 place-items-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
              {{ index + 1 }}
            </span>
            <UIcon :name="s.icon" class="size-4 text-muted" />
          </div>
          <h3 class="mt-3 font-medium">{{ s.title }}</h3>
          <p class="mt-1 text-sm text-muted">{{ s.desc }}</p>
        </div>
      </div>
    </section>
  </div>

  <!-- ================= 已登录：今日仪表盘 ================= -->
  <div v-else class="mx-auto w-full max-w-2xl px-4 py-8">
    <section class="flex items-center gap-4">
      <div class="min-w-0 flex-1">
        <p class="text-sm text-muted">{{ greeting }}，{{ user?.name }}</p>
        <h1 class="mt-1 text-xl font-semibold tracking-tight sm:text-2xl">
          {{ dashboard?.position ? `继续学习「${dashboard.position.name}」` : "制定学习计划" }}
        </h1>
        <p class="mt-2 text-sm text-muted">
          <template v-if="(dashboard?.todayDone ?? 0) >= (dashboard?.todayGoal ?? 0) && (dashboard?.todayGoal ?? 0) > 0">
            今日已完成 {{ dashboard?.todayDone ?? 0 }} 关
          </template>
          <template v-else>
            今日进度 {{ dashboard?.todayDone ?? 0 }}/{{ dashboard?.todayGoal ?? 0 }} 关
          </template>
        </p>
      </div>
      <DailyGoalRing
        :done="dashboard?.todayDone ?? 0"
        :total="dashboard?.todayGoal ?? 1"
        :size="88"
      />
    </section>

    <div class="mt-5 flex flex-wrap gap-2">
      <StatPill icon="i-lucide-flame" :value="dashboard?.streak ?? 0" label="天连续" tone="flame" />
      <StatPill icon="i-lucide-zap" :value="dashboard?.xp ?? 0" label="XP" tone="xp" />
      <StatPill
        icon="i-lucide-target"
        :value="`${dashboard?.todayDone ?? 0}/${dashboard?.todayGoal ?? 0}`"
        label="今日"
        tone="goal"
      />
    </div>

    <!-- 下一关 -->
    <UCard class="mt-8">
      <template #header>
        <div class="flex items-center justify-between">
          <span class="font-medium">继续学习</span>
          <UBadge variant="soft" color="neutral" size="sm">
            {{ dashboard?.completed ?? 0 }}/{{ dashboard?.total ?? 0 }} 关
          </UBadge>
        </div>
      </template>

      <div v-if="dashboard?.nextItem">
        <p class="text-xs text-muted">第 {{ dashboard.nextItem.index }} 关</p>
        <p class="mt-1 text-lg font-medium">{{ dashboard.nextItem.skillName }}</p>
        <p v-if="dashboard.nextItem.resourceTitle" class="mt-1 text-sm text-muted">
          {{ dashboard.nextItem.resourceTitle }}
        </p>
        <UButton
          class="mt-4"
          :to="`/learn/${dashboard.nextItem.id}`"
          size="lg"
          label="开始这一关"
          icon="i-lucide-play"
        />
      </div>

      <div v-else-if="dashboard?.hasPath" class="py-2">
        <p class="font-medium">全部关卡已完成</p>
        <p class="mt-1 text-sm text-muted">查看学习复盘，或切换学习方向开启新路径。</p>
        <div class="mt-4 flex gap-2">
          <UButton to="/reports" variant="soft" label="查看复盘" />
          <UButton to="/onboarding" variant="ghost" color="neutral" label="切换方向" />
        </div>
      </div>

      <div v-else class="py-2">
        <p class="font-medium">尚未制定学习计划</p>
        <p class="mt-1 text-sm text-muted">选择学习方向与每日时长，即可生成关卡路径。</p>
        <UButton class="mt-4" to="/onboarding" label="制定计划" icon="i-lucide-route" />
      </div>
    </UCard>

    <!-- 总进度 -->
    <section class="mt-6">
      <div class="flex items-center justify-between text-sm">
        <span class="text-muted">总进度</span>
        <span class="font-medium tabular-nums">{{ dashboard?.percent ?? 0 }}%</span>
      </div>
      <UProgress :model-value="dashboard?.percent ?? 0" class="mt-2" />
      <UButton
        class="mt-3"
        to="/learning"
        variant="ghost"
        color="neutral"
        size="sm"
        label="查看完整关卡路径"
        trailing-icon="i-lucide-arrow-right"
      />
    </section>

    <!-- 能力测评 -->
    <UCard class="mt-6">
      <div class="flex items-start gap-3">
        <span class="grid size-9 shrink-0 place-items-center rounded-lg bg-elevated">
          <UIcon name="i-lucide-clipboard-check" class="size-4" />
        </span>
        <div class="min-w-0 flex-1">
          <p class="font-medium">能力测评</p>
          <p class="mt-1 text-sm text-muted">
            8 题评估学习基础与偏好，生成初始画像与推荐方向。
          </p>
          <UButton class="mt-3" to="/assessment" size="sm" variant="soft" label="开始测评" />
        </div>
      </div>
    </UCard>
  </div>
</template>
