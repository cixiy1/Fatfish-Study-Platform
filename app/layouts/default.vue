<script setup lang="ts">
/**
 * 全站主布局：顶部导航 + 抽屉。
 * 注意：`<main>` 只在 app.vue 里有一处，这里不要再加，否则 a11y 会报重复 landmark。
 */
const isDrawerOpen = ref(false)
</script>

<template>
  <div class="flex min-h-dvh flex-col bg-default">
    <AppHeader @open-nav="isDrawerOpen = true" />
    <div class="flex-1">
      <slot />
    </div>
    <AppNavDrawer v-model:open="isDrawerOpen" />
  </div>
</template>
