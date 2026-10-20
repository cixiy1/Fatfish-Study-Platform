<script setup lang="ts">
import type { AdminSettingsResponse } from "#shared/types/auth"

useHead({ title: "管理后台 · FSP" })

const { user } = useAuthSession()

const settings = ref<AdminSettingsResponse | null>(null)
const userCount = ref(0)
const loading = ref(true)

// 站点地址：OAuth 回调地址与邮件里的链接都靠它，配错或为空会让第三方登录直接失败
const siteForm = reactive({ name: "FSP", url: "" })
const siteEffectiveUrl = ref("")
const siteSaving = ref(false)
const siteMessage = ref<{ color: "success" | "error", title: string } | null>(null)

/** 大模型就绪状态：settings 只能说明「填过」，能不能真调起来要看这里 */
const { llmReady, llmReasonText, load: loadStatus } = useSystemStatus()

async function saveSite() {
  siteMessage.value = null
  siteSaving.value = true
  try {
    const res = await $fetch<{ site: { name: string, url: string } }>("/api/admin/site", {
      method: "PUT",
      body: { name: siteForm.name, url: siteForm.url },
    })
    siteForm.name = res.site.name
    siteForm.url = res.site.url
    siteEffectiveUrl.value = res.site.url || siteEffectiveUrl.value
    siteMessage.value = { color: "success", title: "站点设置已保存" }
  } catch (error) {
    const message = (error as { data?: { message?: string } })?.data?.message || "保存失败"
    siteMessage.value = { color: "error", title: message }
  } finally {
    siteSaving.value = false
  }
}

onMounted(async () => {
  try {
    const [settingsData, countData, siteData] = await Promise.all([
      $fetch<AdminSettingsResponse>("/api/admin/settings"),
      $fetch<{ count: number }>("/api/admin/user-count"),
      $fetch<{ name: string, url: string, effectiveUrl: string }>("/api/admin/site"),
      loadStatus(true),
    ])
    settings.value = settingsData
    userCount.value = countData.count
    siteForm.name = siteData.name
    siteForm.url = siteData.url
    siteEffectiveUrl.value = siteData.effectiveUrl
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

      <!-- 站点地址决定 OAuth 回调与邮件链接，为空时第三方登录会直接失败，这里就地提供修复入口 -->
      <div
        class="mb-6 rounded-xl border p-4"
        :class="siteForm.url ? 'border-default' : 'border-error/40 bg-error/5'"
      >
        <div class="flex items-start gap-3">
          <UIcon
            :name="siteForm.url ? 'i-lucide-globe' : 'i-lucide-triangle-alert'"
            class="mt-0.5 size-5 shrink-0"
            :class="siteForm.url ? 'text-primary' : 'text-error'"
          />
          <div class="min-w-0 flex-1">
            <p class="font-medium" :class="siteForm.url ? '' : 'text-error'">
              {{ siteForm.url ? "站点设置" : "站点地址未配置，GitHub 登录不可用" }}
            </p>
            <p class="mt-1 text-sm text-muted">
              用于 GitHub 登录回调与邮件里的验证、重置链接。部署到正式域名后务必改成正式地址。
            </p>
            <form class="mt-3 flex flex-col gap-2 sm:flex-row" @submit.prevent="saveSite">
              <UInput
                v-model="siteForm.name"
                placeholder="站点名称"
                class="sm:w-40"
                aria-label="站点名称"
              />
              <UInput
                v-model="siteForm.url"
                placeholder="https://example.com"
                class="flex-1"
                aria-label="站点地址"
              />
              <UButton type="submit" :loading="siteSaving" label="保存" />
            </form>
            <p class="mt-2 text-xs text-muted">
              当前生效：{{ siteEffectiveUrl }}
              <span v-if="!siteForm.url">（未显式配置，按访问地址推导）</span>
            </p>
            <p
              v-if="siteMessage"
              class="mt-1 text-xs"
              :class="siteMessage.color === 'success' ? 'text-success' : 'text-error'"
            >
              {{ siteMessage.title }}
            </p>
          </div>
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
