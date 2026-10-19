<script setup lang="ts">
// 受保护页面示例：未登录访问会被全局中间件重定向到 /login?redirect=/account
definePageMeta({ auth: true })

useHead({
  title: "个人中心 · FSP",
  meta: [{ name: "robots", content: "noindex" }],
})

const { user, logout } = useAuthSession()
</script>

<template>
  <section
    class="mx-auto flex min-h-dvh w-full max-w-lg flex-col justify-center gap-6 px-5 py-16"
  >
    <div>
      <h1 class="text-2xl font-semibold tracking-tight">个人中心</h1>
      <p class="mt-2 text-sm text-muted">
        本页通过
        <code class="rounded bg-elevated px-1.5 py-0.5 text-xs"
          >definePageMeta({ auth: true })</code
        >
        声明需要登录。
      </p>
    </div>

    <UCard>
      <dl class="space-y-3 text-sm">
        <div class="flex justify-between gap-4">
          <dt class="text-muted">账号</dt>
          <dd class="font-medium">{{ user?.account }}</dd>
        </div>
        <div class="flex justify-between gap-4">
          <dt class="text-muted">昵称</dt>
          <dd class="font-medium">{{ user?.name }}</dd>
        </div>
      </dl>

      <template #footer>
        <div class="flex items-center justify-between gap-3">
          <UButton
            color="neutral"
            variant="outline"
            size="lg"
            to="/"
            label="返回首页"
          />
          <UButton
            color="primary"
            size="lg"
            label="退出登录"
            @click="logout()"
          />
        </div>
      </template>
    </UCard>

    <LazyUAlert
      color="neutral"
      variant="soft"
      title="开发占位会话：任意非空账号密码即可登录；生产环境登录接口会返回 501。"
    />
  </section>
</template>
