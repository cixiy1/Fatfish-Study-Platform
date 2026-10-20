<script setup lang="ts">
useHead({
  title: "FSP",
  htmlAttrs: { lang: "zh-CN" },
})
</script>

<template>
  <UApp>
    <NuxtRouteAnnouncer />
    <!-- 全站唯一 landmark 容器；各布局内部不要再加同样标签，否则 a11y 会报重复 -->
    <main>
      <NuxtLayout>
        <NuxtPage />
      </NuxtLayout>
    </main>
  </UApp>
</template>
