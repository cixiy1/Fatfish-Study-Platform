<script setup lang="ts">
const { user, logout } = useAuthSession()
const route = useRoute()

const navItems = [
  { icon: "i-lucide-clipboard-check", label: "职业测评", to: "/assessment" },
  { icon: "i-lucide-network", label: "技能图谱", to: "/positions" },
  { icon: "i-lucide-route", label: "个性化导学", to: "/learning" },
  { icon: "i-lucide-message-circle-question", label: "智能答疑", to: "/qa" },
  { icon: "i-lucide-chart-line", label: "学习复盘", to: "/reports" },
  { icon: "i-lucide-user", label: "个人中心", to: "/account" },
]

const isActive = (to: string) => {
  if (to === "/positions") return route.path.startsWith("/positions")
  return route.path === to
}

const isMobileOpen = ref(false)
</script>

<template>
  <div class="flex min-h-dvh">
    <!-- 桌面侧边栏 -->
    <aside class="hidden w-60 shrink-0 border-r bg-muted/30 lg:flex lg:flex-col">
      <div class="flex items-center gap-2.5 border-b p-4">
        <span class="grid size-8 place-items-center rounded-lg bg-primary text-sm font-bold text-primary-foreground">F</span>
        <span class="font-semibold">FSP</span>
      </div>

      <nav class="flex-1 space-y-1 p-3">
        <NuxtLink
          v-for="item in navItems"
          :key="item.to"
          :to="item.to"
          class="flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition"
          :class="isActive(item.to) ? 'bg-primary text-primary-foreground' : 'hover:bg-elevated'"
        >
          <UIcon :name="item.icon" class="text-lg" />
          {{ item.label }}
        </NuxtLink>
      </nav>

      <div class="border-t p-3">
        <div class="mb-2 px-3 text-xs text-muted">{{ user?.name }}</div>
        <div class="space-y-1">
          <NuxtLink
            v-if="user?.role === 'admin'"
            to="/admin"
            class="flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition hover:bg-elevated"
          >
            <UIcon name="i-lucide-settings" class="text-lg" />
            管理后台
          </NuxtLink>
          <NuxtLink
            to="/"
            class="flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition hover:bg-elevated"
          >
            <UIcon name="i-lucide-home" class="text-lg" />
            首页
          </NuxtLink>
          <button
            class="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm transition hover:bg-elevated"
            @click="logout()"
          >
            <UIcon name="i-lucide-log-out" class="text-lg" />
            退出登录
          </button>
        </div>
      </div>
    </aside>

    <!-- 移动端顶栏 -->
    <div class="fixed inset-x-0 top-0 z-50 flex items-center justify-between border-b bg-background p-3 lg:hidden">
      <div class="flex items-center gap-2">
        <span class="grid size-7 place-items-center rounded-lg bg-primary text-xs font-bold text-primary-foreground">F</span>
        <span class="font-semibold text-sm">FSP</span>
      </div>
      <UButton
        variant="ghost"
        size="sm"
        :icon="isMobileOpen ? 'i-lucide-x' : 'i-lucide-menu'"
        @click="isMobileOpen = !isMobileOpen"
      />
    </div>

    <!-- 移动端抽屉 -->
    <Teleport to="body">
      <div v-if="isMobileOpen" class="fixed inset-0 z-40 lg:hidden" @click="isMobileOpen = false">
        <div class="absolute inset-0 bg-black/50" />
        <aside class="absolute left-0 top-0 h-full w-64 border-r bg-background p-3" @click.stop>
          <nav class="space-y-1">
            <NuxtLink
              v-for="item in navItems"
              :key="item.to"
              :to="item.to"
              class="flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition"
              :class="isActive(item.to) ? 'bg-primary text-primary-foreground' : 'hover:bg-elevated'"
              @click="isMobileOpen = false"
            >
              <UIcon :name="item.icon" class="text-lg" />
              {{ item.label }}
            </NuxtLink>
          </nav>
          <div class="mt-4 border-t pt-3">
            <button
              class="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm transition hover:bg-elevated"
              @click="logout()"
            >
              <UIcon name="i-lucide-log-out" class="text-lg" />
              退出登录
            </button>
          </div>
        </aside>
      </div>
    </Teleport>

    <!-- 主内容区 -->
    <main class="flex-1 pt-14 lg:pt-0">
      <slot />
    </main>
  </div>
</template>
