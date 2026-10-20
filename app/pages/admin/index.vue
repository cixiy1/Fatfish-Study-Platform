<script setup lang="ts">
import type { AdminSettingsResponse } from "#shared/types/auth"

useHead({ title: "管理后台 · FSP" })

const { user } = useAuthSession()

const settings = ref<AdminSettingsResponse | null>(null)
const userCount = ref(0)
const loading = ref(true)

// 大模型就绪状态：settings 只能说明「填过」，能不能真调起来要看这里
const { llmReady, llmReasonText, load: loadStatus } = useSystemStatus()

onMounted(async () => {
  try {
    const [settingsData, countData] = await Promise.all([
      $fetch<AdminSettingsResponse>("/api/admin/settings"),
      $fetch<{ count: number }>("/api/admin/user-count"),
      loadStatus(true),
    ])
    settings.value = settingsData
    userCount.value = countData.count
  } catch {
    // 权限不足或未登录由中间件处理
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <UContainer class="py-10">
    <div class="mb-8 flex items-center justify-between">
      <div>
        <h1 class="text-2xl font-semibold tracking-tight">管理后台</h1>
        <p class="mt-1 text-sm text-muted">
          欢迎回来，{{ user?.name }}
        </p>
      </div>
      <UButton to="/" variant="soft" label="返回首页" />
    </div>

    <div v-if="loading" class="py-20 text-center text-muted">
      加载中…
    </div>

    <template v-else>
      <!-- 大模型是必填依赖：没配好时全站 AI 功能都不可用，必须先说清楚 -->
      <div
        v-if="!llmReady"
        class="mb-6 rounded-xl border border-error/40 bg-error/5 p-4"
      >
        <div class="flex items-start gap-3">
          <UIcon name="i-lucide-plug-zap" class="mt-0.5 size-5 shrink-0 text-error" />
          <div class="min-w-0 flex-1">
            <p class="font-medium text-error">
              大模型接口未就绪，核心功能不可用
            </p>
            <p class="mt-1 text-sm text-muted">
              {{ llmReasonText }}
              学生端的方向访谈将被拦截，且无法生成关卡资料。
            </p>
          </div>
          <UButton to="/admin/llm" size="sm" color="error" label="立即配置" />
        </div>
      </div>

      <div class="grid gap-6 md:grid-cols-2">
      <UCard>
        <template #header>
          <div class="flex items-center justify-between">
            <h2 class="font-medium">SMTP 邮件配置</h2>
            <UBadge :color="settings?.smtp ? 'success' : 'neutral'" variant="soft">
              {{ settings?.smtp ? '已配置' : '未配置' }}
            </UBadge>
          </div>
        </template>
        <div v-if="settings?.smtp" class="space-y-2 text-sm">
          <div class="flex justify-between">
            <span class="text-muted">预设</span>
            <span>{{ settings.smtp.preset }}</span>
          </div>
          <div class="flex justify-between">
            <span class="text-muted">服务器</span>
            <span>{{ settings.smtp.host }}:{{ settings.smtp.port }}</span>
          </div>
          <div class="flex justify-between">
            <span class="text-muted">发件人</span>
            <span>{{ settings.smtp.from }}</span>
          </div>
        </div>
        <p v-else class="text-sm text-muted">
          尚未配置 SMTP，注册用户将无法收到验证邮件。
        </p>
        <template #footer>
          <UButton to="/admin/smtp" variant="soft" label="配置 SMTP" block />
        </template>
      </UCard>

      <UCard>
        <template #header>
          <div class="flex items-center justify-between">
            <h2 class="font-medium">OAuth 第三方登录</h2>
            <UBadge
              :color="settings?.oauth?.github ? 'success' : 'neutral'"
              variant="soft"
            >
              {{ settings?.oauth?.github ? '已配置' : '未配置' }}
            </UBadge>
          </div>
        </template>
        <div class="space-y-2 text-sm">
          <div class="flex items-center justify-between">
            <span>GitHub</span>
            <UBadge :color="settings?.oauth?.github ? 'success' : 'neutral'" variant="soft" size="sm">
              {{ settings?.oauth?.github ? '已配置' : '未配置' }}
            </UBadge>
          </div>
        </div>
        <template #footer>
          <UButton to="/admin/oauth" variant="soft" label="配置 OAuth" block />
        </template>
      </UCard>

      <UCard>
        <template #header>
          <div class="flex items-center justify-between">
            <h2 class="font-medium">大模型 AI 接口</h2>
            <UBadge :color="llmReady ? 'success' : 'error'" variant="soft">
              {{ llmReady ? '已就绪' : '未配置（必填）' }}
            </UBadge>
          </div>
        </template>
        <div v-if="settings?.llm" class="space-y-2 text-sm">
          <div class="flex justify-between">
            <span class="text-muted">提供商</span>
            <span>{{ settings.llm.provider }}</span>
          </div>
          <div class="flex justify-between">
            <span class="text-muted">模型</span>
            <span>{{ settings.llm.model }}</span>
          </div>
          <div class="flex justify-between">
            <span class="text-muted">Base URL</span>
            <span class="truncate ml-2">{{ settings.llm.baseUrl }}</span>
          </div>
        </div>
        <p v-else class="text-sm text-muted">
          尚未配置大模型（必填）。学生无法完成方向访谈，也无法生成关卡资料。
        </p>
        <template #footer>
          <UButton to="/admin/llm" variant="soft" label="配置大模型" block />
        </template>
      </UCard>

      <UCard>
        <template #header>
          <h2 class="font-medium">系统概览</h2>
        </template>
        <div class="space-y-2 text-sm">
          <div class="flex justify-between">
            <span class="text-muted">用户总数</span>
            <span>{{ userCount }}</span>
          </div>
        </div>
        <template #footer>
          <UButton to="/admin/users" variant="soft" label="用户管理" block />
        </template>
      </UCard>
      </div>
    </template>
  </UContainer>
</template>
