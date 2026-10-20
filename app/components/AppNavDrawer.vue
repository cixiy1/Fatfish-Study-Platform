<script setup lang="ts">
/**
 * 侧栏抽屉：桌面/移动共用同一套导航。
 * 顶部导航只放主线，其余功能（技能图谱、答疑、复盘、计划设置…）都从这里进。
 */
const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ "update:open": [boolean] }>()

const { user, logout } = useAuthSession()
const route = useRoute()

function close() {
  emit("update:open", false)
}

// 路由变化自动收起，避免点完还悬在页面上
watch(() => route.fullPath, close)

// 打开时锁住 body 滚动
watch(
  () => props.open,
  (value) => {
    if (!import.meta.client) return
    document.body.style.overflow = value ? "hidden" : ""
  },
)

function onKeydown(event: KeyboardEvent) {
  if (event.key === "Escape") close()
}

onMounted(() => window.addEventListener("keydown", onKeydown))
onBeforeUnmount(() => {
  window.removeEventListener("keydown", onKeydown)
  if (import.meta.client) document.body.style.overflow = ""
})
</script>

<template>
  <Teleport to="body">
    <Transition
      enter-active-class="transition-opacity duration-200"
      enter-from-class="opacity-0"
      leave-active-class="transition-opacity duration-150"
      leave-to-class="opacity-0"
    >
      <div v-if="open" class="fixed inset-0 z-50" @click="close">
        <div class="absolute inset-0 bg-black/40" />
      </div>
    </Transition>

    <Transition
      enter-active-class="transition-transform duration-250 ease-out"
      enter-from-class="-translate-x-full"
      leave-active-class="transition-transform duration-200 ease-in"
      leave-to-class="-translate-x-full"
    >
      <aside
        v-if="open"
        class="fixed inset-y-0 left-0 z-50 flex w-72 max-w-[82vw] flex-col border-r border-default bg-default shadow-xl"
        role="dialog"
        aria-modal="true"
        aria-label="功能导航"
        @click.stop
      >
        <div class="flex items-center justify-between border-b border-default px-3 py-3">
          <NuxtLink to="/" class="flex items-center gap-2" aria-label="FSP 首页">
            <img
              src="/logo-128.png"
              alt=""
              width="32"
              height="32"
              class="size-8 shrink-0 rounded-lg object-cover ring-1 ring-black/10 dark:ring-white/15"
            >
            <span class="font-semibold">FSP</span>
          </NuxtLink>
          <UButton
            variant="ghost"
            color="neutral"
            size="sm"
            icon="i-lucide-x"
            aria-label="关闭导航菜单"
            @click="close"
          />
        </div>

        <div class="flex-1 overflow-y-auto p-3">
          <NavMainList @navigate="close" />
        </div>

        <div class="space-y-1 border-t border-default p-3">
          <p class="truncate px-3 pb-1 text-xs text-muted">{{ user?.name }}</p>
          <NuxtLink
            v-if="user?.role === 'admin'"
            to="/admin"
            class="flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition hover:bg-elevated"
            @click="close"
          >
            <UIcon name="i-lucide-settings" class="size-4" />
            管理后台
          </NuxtLink>
          <button
            type="button"
            class="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm transition hover:bg-elevated"
            @click="logout()"
          >
            <UIcon name="i-lucide-log-out" class="size-4" />
            退出登录
          </button>
        </div>
      </aside>
    </Transition>
  </Teleport>
</template>
