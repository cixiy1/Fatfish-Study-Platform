<script setup lang="ts">
const emit = defineEmits<{ "open-nav": [] }>()

const { user, isLoggedIn, logout } = useAuthSession()
const { dashboard } = useLearner()
const route = useRoute()

function isActive(to: string) {
  return to === "/" ? route.path === "/" : route.path.startsWith(to)
}
</script>

<template>
  <header class="sticky top-0 z-40 border-b border-default bg-default/85 backdrop-blur">
    <div class="mx-auto flex h-14 w-full max-w-6xl items-center gap-2 px-3 sm:px-4">
      <UButton
        variant="ghost"
        color="neutral"
        size="sm"
        icon="i-lucide-menu"
        aria-label="打开导航菜单"
        @click="emit('open-nav')"
      />

      <NuxtLink to="/" class="flex items-center gap-2" aria-label="FSP 首页">
        <img
          src="/logo-128.png"
          alt=""
          width="32"
          height="32"
          class="size-8 shrink-0 rounded-lg object-cover ring-1 ring-black/10 dark:ring-white/15"
        >
        <span class="hidden font-semibold sm:inline">FSP</span>
      </NuxtLink>

      <!-- 桌面端只放主线三项，其余功能在抽屉里 -->
      <nav v-if="isLoggedIn" class="ml-3 hidden items-center gap-1 lg:flex" aria-label="主导航">
        <NuxtLink
          v-for="item in PRIMARY_NAV"
          :key="item.to"
          :to="item.to"
          class="rounded-lg px-3 py-1.5 text-sm transition"
          :class="
            isActive(item.to)
              ? 'bg-primary/10 font-medium text-primary'
              : 'text-muted hover:bg-elevated hover:text-default'
          "
        >
          {{ item.label }}
        </NuxtLink>
      </nav>

      <div class="ml-auto flex items-center gap-1.5">
        <template v-if="isLoggedIn">
          <div v-if="dashboard" class="hidden items-center gap-1.5 md:flex">
            <StatPill icon="i-lucide-flame" :value="dashboard.streak" tone="flame" />
            <StatPill icon="i-lucide-zap" :value="dashboard.xp" tone="xp" />
          </div>
          <UButton
            to="/account"
            variant="ghost"
            color="neutral"
            size="sm"
            icon="i-lucide-user"
            :label="user?.name"
            class="hidden sm:inline-flex"
          />
          <UButton
            variant="ghost"
            color="neutral"
            size="sm"
            icon="i-lucide-log-out"
            aria-label="退出登录"
            @click="logout()"
          />
        </template>
        <template v-else>
          <UButton to="/login" size="sm" variant="ghost" color="neutral" label="登录" />
          <UButton to="/register" size="sm" label="开始使用" />
        </template>
      </div>
    </div>
  </header>
</template>
