<script setup lang="ts">
const emit = defineEmits<{ navigate: [] }>()

const route = useRoute()

/** `/` 要精确匹配，否则任何路径都会点亮「今日」 */
function isActive(to: string) {
  return to === "/" ? route.path === "/" : route.path.startsWith(to)
}
</script>

<template>
  <nav class="space-y-6">
    <div v-for="group in NAV_GROUPS" :key="group.title">
      <p class="px-3 pb-1.5 text-xs font-medium tracking-wide text-muted">
        {{ group.title }}
      </p>
      <ul class="space-y-0.5">
        <li v-for="item in group.items" :key="item.to">
          <NuxtLink
            :to="item.to"
            class="flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition"
            :class="
              isActive(item.to)
                ? 'bg-primary/10 font-medium text-primary'
                : 'text-default hover:bg-elevated'
            "
            @click="emit('navigate')"
          >
            <UIcon :name="item.icon" class="size-4 shrink-0" />
            {{ item.label }}
          </NuxtLink>
        </li>
      </ul>
    </div>
  </nav>
</template>
