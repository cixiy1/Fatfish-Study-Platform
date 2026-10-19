<script setup lang="ts">
interface AdminUser {
	id: number
	account: string
	name: string
	email: string
	role: string
	status: string
	emailVerifiedAt: string | null
	oauthProvider: string | null
	createdAt: string
	lastLoginAt: string | null
}

useHead({ title: "用户管理 · 管理后台 · FSP" })

const { user: currentUser } = useAuthSession()

const users = ref<AdminUser[]>([])
const total = ref(0)
const loading = ref(true)
const message = ref<{ color: "success" | "error", text: string } | null>(null)

async function loadUsers() {
	loading.value = true
	try {
		const data = await $fetch<{ users: AdminUser[], total: number }>("/api/admin/users")
		users.value = data.users
		total.value = data.total
	} catch {
		// 权限不足由中间件处理
	} finally {
		loading.value = false
	}
}

onMounted(loadUsers)

const statusColor = (status: string) =>
	status === "active" ? "success" : status === "pending" ? "warning" : "neutral"

const statusLabel = (status: string) =>
	status === "active" ? "正常" : status === "pending" ? "待激活" : "已禁用"

async function updateStatus(u: AdminUser, status: "active" | "pending" | "disabled") {
	message.value = null
	try {
		await $fetch(`/api/admin/users/${u.id}/status`, {
			method: "PATCH",
			body: { status },
		})
		u.status = status
		message.value = { color: "success", text: `已将 ${u.account} 设为${statusLabel(status)}` }
	} catch (error) {
		const data = (error as { data?: { message?: string } })?.data
		message.value = { color: "error", text: data?.message || "操作失败" }
	}
}
</script>

<template>
  <UContainer class="py-10">
    <div class="mb-8 flex items-center justify-between">
      <div>
        <h1 class="text-2xl font-semibold tracking-tight">用户管理</h1>
        <p class="mt-1 text-sm text-muted">
          共 {{ total }} 个用户
        </p>
      </div>
      <UButton to="/admin" variant="soft" label="返回后台" />
    </div>

    <UAlert
      v-if="message"
      :color="message.color"
      :title="message.text"
      class="mb-4"
    />

    <div v-if="loading" class="py-20 text-center text-muted">
      加载中…
    </div>

    <UCard v-else>
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead>
            <tr class="border-b text-left text-muted">
              <th class="py-3 pr-4">账号</th>
              <th class="py-3 pr-4">昵称</th>
              <th class="py-3 pr-4">邮箱</th>
              <th class="py-3 pr-4">角色</th>
              <th class="py-3 pr-4">状态</th>
              <th class="py-3 pr-4">注册方式</th>
              <th class="py-3 pr-4">注册时间</th>
              <th class="py-3 text-right">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="u in users"
              :key="u.id"
              class="border-b last:border-0"
            >
              <td class="py-3 pr-4 font-medium">{{ u.account }}</td>
              <td class="py-3 pr-4">{{ u.name }}</td>
              <td class="py-3 pr-4 text-muted">{{ u.email }}</td>
              <td class="py-3 pr-4">
                <UBadge
                  :color="u.role === 'admin' ? 'primary' : 'neutral'"
                  variant="soft"
                  size="sm"
                >
                  {{ u.role === "admin" ? "管理员" : "用户" }}
                </UBadge>
              </td>
              <td class="py-3 pr-4">
                <UBadge :color="statusColor(u.status)" variant="soft" size="sm">
                  {{ statusLabel(u.status) }}
                </UBadge>
              </td>
              <td class="py-3 pr-4 text-muted">
                {{ u.oauthProvider ? u.oauthProvider : "邮箱注册" }}
              </td>
              <td class="py-3 pr-4 text-muted whitespace-nowrap">{{ u.createdAt }}</td>
              <td class="py-3 text-right whitespace-nowrap">
                <template v-if="u.account !== currentUser?.account">
                  <UButton
                    v-if="u.status !== 'active'"
                    size="xs"
                    color="success"
                    variant="soft"
                    label="激活"
                    @click="updateStatus(u, 'active')"
                  />
                  <UButton
                    v-if="u.status === 'active' && u.role !== 'admin'"
                    size="xs"
                    color="neutral"
                    variant="soft"
                    label="禁用"
                    class="ml-2"
                    @click="updateStatus(u, 'disabled')"
                  />
                </template>
                <span v-else class="text-xs text-muted">（当前账号）</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </UCard>
  </UContainer>
</template>
