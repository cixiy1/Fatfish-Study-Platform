<script setup lang="ts">
definePageMeta({ auth: false })

useHead({
  title: "FSP · AI 赋能学习平台",
  meta: [{ name: "description", content: "Fatfish Study Platform — AI 赋能的自主学习平台" }],
})

const { user, isLoggedIn } = useAuthSession()

const modules = [
  { icon: "i-lucide-clipboard-check", title: "职业测评", desc: "能力摸底测评，生成用户画像", to: "/assessment", color: "primary" },
  { icon: "i-lucide-network", title: "技能图谱", desc: "查看岗位技能体系，标记掌握情况", to: "/positions", color: "success" },
  { icon: "i-lucide-route", title: "个性化导学", desc: "智能生成学习路径，推荐学习资源", to: "/learning", color: "warning" },
  { icon: "i-lucide-message-circle-question", title: "智能答疑", desc: "输入问题，获取知识点与学习资料", to: "/qa", color: "info" },
  { icon: "i-lucide-chart-line", title: "学习复盘", desc: "阶段性评估，生成学习报告", to: "/reports", color: "secondary" },
  { icon: "i-lucide-user", title: "个人中心", desc: "学习档案、历史记录", to: "/account", color: "neutral" },
]
</script>

<template>
  <div>
    <!-- Hero -->
    <div class="border-b bg-gradient-to-br from-primary-50 to-neutral-50 dark:from-primary-950 dark:to-neutral-950">
      <UContainer class="py-16 text-center">
        <h1 class="text-4xl font-bold tracking-tight">
          Fatfish Study Platform
        </h1>
        <p class="mt-3 text-lg text-muted">
          AI 赋能的自主学习平台 · 从职业测评到学习复盘的全流程
        </p>
        <div v-if="!isLoggedIn" class="mt-8 flex justify-center gap-4">
          <UButton to="/login" size="lg" label="开始学习" />
          <UButton to="/register" size="lg" variant="outline" label="注册账号" />
        </div>
        <div v-else class="mt-8 text-sm text-muted">
          欢迎回来，{{ user?.name }}
        </div>
      </UContainer>
    </div>

    <!-- Modules -->
    <UContainer class="py-12">
      <div class="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        <UCard
          v-for="m in modules"
          :key="m.to"
          class="transition hover:shadow-lg cursor-pointer"
          @click="navigateTo(m.to)"
        >
          <div class="flex items-start gap-4">
            <div class="rounded-lg bg-elevated p-3">
              <UIcon :name="m.icon" class="text-2xl" />
            </div>
            <div class="flex-1">
              <h3 class="font-semibold">{{ m.title }}</h3>
              <p class="mt-1 text-sm text-muted">{{ m.desc }}</p>
            </div>
          </div>
        </UCard>
      </div>
    </UContainer>
  </div>
</template>
