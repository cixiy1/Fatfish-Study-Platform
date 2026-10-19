<script setup lang="ts">
definePageMeta({ auth: true, layout: 'learning' })

useHead({
  title: "个人中心 · FSP",
  meta: [{ name: "robots", content: "noindex" }],
})

const { user, logout, resolveUser } = useAuthSession()

onMounted(() => resolveUser(true))
</script>

<template>
  <section
    class="mx-auto flex min-h-dvh w-full max-w-lg flex-col justify-center gap-6 px-5 py-16"
  >
    <div>
      <h1 class="text-2xl font-semibold tracking-tight">个人中心</h1>
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
        <div class="flex justify-between gap-4">
          <dt class="text-muted">邮箱</dt>
          <dd class="font-medium">{{ user?.email || "未设置" }}</dd>
        </div>
        <div class="flex justify-between gap-4">
          <dt class="text-muted">角色</dt>
          <dd>
            <UBadge
              :color="user?.role === 'admin' ? 'primary' : 'neutral'"
              variant="soft"
              size="sm"
            >
              {{ user?.role === "admin" ? "管理员" : "普通用户" }}
            </UBadge>
          </dd>
        </div>
        <div class="flex justify-between gap-4">
          <dt class="text-muted">状态</dt>
          <dd>
            <UBadge
              :color="user?.status === 'active' ? 'success' : 'warning'"
              variant="soft"
              size="sm"
            >
              {{ user?.status === "active" ? "正常" : user?.status === "pending" ? "待激活" : user?.status }}
            </UBadge>
          </dd>
        </div>
      </dl>

      <template #footer>
        <div class="flex items-center justify-between gap-3">
          <div class="flex gap-2">
            <UButton
              color="neutral"
              variant="outline"
              size="lg"
              to="/"
              label="返回首页"
            />
            <UButton
              v-if="user?.role === 'admin'"
              color="primary"
              variant="soft"
              size="lg"
              to="/admin"
              label="管理后台"
            />
          </div>
          <UButton
            color="primary"
            size="lg"
            label="退出登录"
            @click="logout()"
          />
        </div>
      </template>
    </UCard>
  </section>
</template>
