<script setup lang="ts">
import type { NuxtError } from "#app"

const props = defineProps<{
	error: NuxtError
}>()

const statusCode = computed(() => props.error.statusCode ?? 500)

const errorContent = computed(() => {
	switch (statusCode.value) {
		case 401:
			return { title: "未登录", description: "请先登录后再访问该页面。" }
		case 403:
			return { title: "无访问权限", description: "你没有权限访问该资源。" }
		case 404:
			return { title: "页面不存在", description: "你访问的页面可能已被移动或删除。" }
		default:
			return {
				title: "出错了",
				description:
					statusCode.value >= 500
						? "服务器暂时无法处理请求，请稍后重试。"
						: "请求处理失败，请稍后重试。",
			}
	}
})

function goHome() {
	clearError({ redirect: "/" })
}
</script>

<template>
	<UApp>
		<UContainer class="flex min-h-screen flex-col items-center justify-center gap-4 text-center">
			<p class="text-6xl font-bold text-primary">
				{{ statusCode }}
			</p>
			<h1 class="text-2xl font-semibold">
				{{ errorContent.title }}
			</h1>
			<p class="max-w-md text-neutral-500">
				{{ errorContent.description }}
			</p>
			<UButton class="mt-4" color="primary" size="lg" @click="goHome">
				返回首页
			</UButton>
		</UContainer>
	</UApp>
</template>
