<script setup lang="ts">
useHead({
  title: "FSP",
  htmlAttrs: { lang: "zh-CN" },
})
</script>

<template>
  <UApp>
    <NuxtRouteAnnouncer />
    <main>
      <NuxtPage />
    </main>
  </UApp>
</template>
