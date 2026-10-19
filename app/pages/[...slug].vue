<script setup lang="ts">
const route = useRoute()

useHead({
  title: () => `${route.path} · FSP`,
})
</script>

<template>
  <div>
    <h1>Hello World</h1>
  </div>
</template>

<script lang="ts">
console.log("Hello")
</script>
