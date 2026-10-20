<script setup lang="ts">
import type { InstallPayload } from "#shared/types/install"
import type { SmtpPreset, LlmProvider } from "#shared/types/auth"
import { SMTP_PRESETS, LLM_PROVIDER_DEFAULTS } from "#shared/types/auth"
import { validateInstallPayload } from "#shared/utils/validate-install"

definePageMeta({ layout: "blank" })

useHead({ title: "初始化安装 · FSP" })

const { testConnection, setup } = useInstall()

const form = reactive({
	database: { file: "fsp.db" },
	admin: { account: "", password: "", confirm: "", name: "", email: "" },
	site: { name: "FSP", url: "" },
	smtp: {
		enabled: false,
		preset: "gmail" as SmtpPreset,
		host: "",
		port: 587,
		secure: false,
		user: "",
		pass: "",
		from: "",
	},
	oauth: {
		github: { enabled: false, clientId: "", clientSecret: "" },
	},
	llm: {
		provider: "openai" as LlmProvider,
		baseUrl: "",
		apiKey: "",
		model: "",
		maxTokens: 4096,
	},
})

const testing = ref(false)
const installing = ref(false)
const testMessage = ref<{ color: "success" | "error" | "warning", title: string, text?: string } | null>(null)
const smtpTesting = ref(false)
const smtpTestTo = ref("")
const smtpTestMessage = ref<{ color: "success" | "error" | "warning", title: string, text?: string } | null>(null)
const llmTesting = ref(false)
const llmTestMessage = ref<{ color: "success" | "error" | "warning", title: string, text?: string } | null>(null)
const message = ref<{ color: "success" | "error" | "warning", title: string, text?: string } | null>(null)

const smtpPresetOptions = [
	{ label: "Gmail", value: "gmail" },
	{ label: "QQ 邮箱", value: "qq" },
	{ label: "163 邮箱", value: "163" },
	{ label: "自定义", value: "custom" },
]

const llmProviderOptions = [
	{ label: "OpenAI", value: "openai" },
	{ label: "Anthropic Claude", value: "anthropic" },
	{ label: "自定义（兼容 OpenAI 格式）", value: "custom" },
]

watch(() => form.smtp.preset, (preset) => {
	if (preset !== "custom" && preset in SMTP_PRESETS) {
		const p = SMTP_PRESETS[preset as Exclude<SmtpPreset, "custom">]
		form.smtp.host = p.host
		form.smtp.port = p.port
		form.smtp.secure = p.secure
	}
})

watch(() => form.llm.provider, (provider) => {
	if (provider !== "custom" && provider in LLM_PROVIDER_DEFAULTS) {
		const d = LLM_PROVIDER_DEFAULTS[provider as Exclude<LlmProvider, "custom">]
		form.llm.baseUrl = d.baseUrl
		form.llm.model = d.model
	}
})

function extractMessage(error: unknown): string {
	if (!error || typeof error !== "object") return "未知错误"
	const err = error as { message?: string, statusMessage?: string, data?: { message?: string } }
	return err.data?.message || err.message || err.statusMessage || "未知错误"
}

async function onTest() {
	testMessage.value = null
	testing.value = true
	try {
		const res = await testConnection(form.database.file)
		testMessage.value = { color: "success", title: "连接成功", text: `数据文件：${res.file}` }
	} catch (error) {
		testMessage.value = { color: "error", title: "连接失败", text: extractMessage(error) }
	} finally {
		testing.value = false
	}
}

async function onTestSmtp() {
	smtpTestMessage.value = null
	smtpTesting.value = true
	try {
		const res = await $fetch<{ message: string }>("/api/install/test-smtp", {
			method: "POST",
			body: { smtp: form.smtp, to: smtpTestTo.value },
		})
		smtpTestMessage.value = { color: "success", title: res.message }
	} catch (error) {
		smtpTestMessage.value = { color: "error", title: "SMTP 测试失败", text: extractMessage(error) }
	} finally {
		smtpTesting.value = false
	}
}

async function onTestLlm() {
	llmTestMessage.value = null
	llmTesting.value = true
	try {
		const res = await $fetch<{ message: string, reply?: string }>("/api/install/test-llm", {
			method: "POST",
			body: { llm: { ...form.llm } },
			timeout: 40_000,
		})
		llmTestMessage.value = { color: "success", title: res.message, text: res.reply }
	} catch (error) {
		llmTestMessage.value = { color: "error", title: "大模型调用失败", text: extractMessage(error) }
	} finally {
		llmTesting.value = false
	}
}

async function onSubmit() {
	message.value = null

	if (form.admin.password !== form.admin.confirm) {
		message.value = { color: "warning", title: "两次输入的密码不一致" }
		return
	}
	const payload: InstallPayload = {
		database: { file: form.database.file },
		admin: {
			account: form.admin.account,
			password: form.admin.password,
			name: form.admin.name || form.admin.account,
			email: form.admin.email || undefined,
		},
		site: { name: form.site.name, url: form.site.url },
	}

	if (form.smtp.enabled) {
		payload.smtp = {
			preset: form.smtp.preset,
			host: form.smtp.host,
			port: form.smtp.port,
			secure: form.smtp.secure,
			user: form.smtp.user,
			pass: form.smtp.pass,
			from: form.smtp.from,
		}
	}

	const hasOAuth = form.oauth.github.enabled
	if (hasOAuth) {
		payload.oauth = {
			github: { clientId: form.oauth.github.clientId, clientSecret: form.oauth.github.clientSecret },
		}
	}

	// 大模型是必填项，不做「跳过」分支
	payload.llm = {
		provider: form.llm.provider,
		baseUrl: form.llm.baseUrl || undefined,
		apiKey: form.llm.apiKey,
		model: form.llm.model,
		maxTokens: form.llm.maxTokens,
	}

	const check = validateInstallPayload(payload)
	if (!check.ok) {
		message.value = { color: "warning", title: check.message ?? "请检查表单填写" }
		return
	}

	installing.value = true
	try {
		await setup(payload)
		message.value = { color: "success", title: "安装完成", text: "正在跳转到登录页…" }
		await navigateTo("/login", { replace: true })
	} catch (error) {
		message.value = { color: "error", title: "安装失败", text: extractMessage(error) }
	} finally {
		installing.value = false
	}
}
</script>

<template>
	<UContainer class="py-10">
		<UCard class="mx-auto max-w-2xl">
			<template #header>
				<h1 class="text-xl font-semibold">
					FSP 初始化安装
				</h1>
				<p class="mt-1 text-sm text-neutral-500">
          首次部署请完成数据库、管理员与大模型配置，配置保存至服务器本地。大模型为必填项，未配置将无法完成首次引导。
				</p>
			</template>

			<div class="space-y-8">
				<section class="space-y-3">
					<h2 class="font-medium">
						数据库配置
					</h2>
					<div>
						<label class="mb-1 block text-sm">数据文件路径</label>
						<UInput v-model="form.database.file" placeholder="data/fsp.db" class="w-full" />
						<p class="mt-1 text-xs text-neutral-500">
							SQLite 数据文件，相对数据目录（默认项目根下 data/），也可填绝对路径。
						</p>
					</div>
					<UButton variant="soft" :loading="testing" @click="onTest">
						测试连接
					</UButton>
					<UAlert
						v-if="testMessage"
						:color="testMessage.color"
						:title="testMessage.title"
						:description="testMessage.text"
					/>
				</section>

				<section class="space-y-3">
					<h2 class="font-medium">
						管理员账号
					</h2>
					<div>
						<label class="mb-1 block text-sm">账号</label>
						<UInput v-model="form.admin.account" placeholder="admin" class="w-full" />
					</div>
					<div>
						<label class="mb-1 block text-sm">密码</label>
						<UInput v-model="form.admin.password" type="password" placeholder="至少 8 位，含字母和数字" class="w-full" />
					</div>
					<div>
						<label class="mb-1 block text-sm">确认密码</label>
						<UInput v-model="form.admin.confirm" type="password" class="w-full" />
					</div>
					<div class="grid gap-3 sm:grid-cols-2">
						<div>
							<label class="mb-1 block text-sm">昵称（可选）</label>
							<UInput v-model="form.admin.name" class="w-full" />
						</div>
						<div>
							<label class="mb-1 block text-sm">邮箱（可选）</label>
							<UInput v-model="form.admin.email" type="email" class="w-full" />
						</div>
					</div>
				</section>

				<section class="space-y-3">
					<h2 class="font-medium">
						站点信息
					</h2>
					<div class="grid gap-3 sm:grid-cols-2">
						<div>
							<label class="mb-1 block text-sm">站点名称</label>
							<UInput v-model="form.site.name" placeholder="FSP" class="w-full" />
						</div>
						<div>
							<label class="mb-1 block text-sm">站点地址</label>
							<UInput v-model="form.site.url" placeholder="https://example.com" class="w-full" />
							<p class="mt-1 text-xs text-neutral-500">
								用于邮件验证链接与 OAuth 回调，务必填写正确。
							</p>
						</div>
					</div>
				</section>

				<section class="space-y-3">
					<div class="flex items-center justify-between">
						<h2 class="font-medium">
							SMTP 邮件配置（可选）
						</h2>
						<USwitch v-model="form.smtp.enabled" />
					</div>
					<p v-if="!form.smtp.enabled" class="text-sm text-neutral-500">
						跳过则不配置邮件发送，注册用户需联系管理员激活。可后续在管理后台配置。
					</p>
					<div v-else class="space-y-3">
						<div>
							<label class="mb-1 block text-sm">预设类型</label>
							<USelect v-model="form.smtp.preset" :items="smtpPresetOptions" class="w-full" />
						</div>
						<div v-if="form.smtp.preset === 'custom'" class="grid gap-3 sm:grid-cols-2">
							<div>
								<label class="mb-1 block text-sm">SMTP 主机</label>
								<UInput v-model="form.smtp.host" placeholder="smtp.example.com" class="w-full" />
							</div>
							<div>
								<label class="mb-1 block text-sm">端口</label>
								<UInput v-model.number="form.smtp.port" type="number" class="w-full" />
							</div>
						</div>
						<div>
							<label class="mb-1 block text-sm">用户名</label>
							<UInput v-model="form.smtp.user" placeholder="QQ/163 填完整邮箱地址" class="w-full" />
						</div>
						<div>
							<label class="mb-1 block text-sm">密码</label>
							<UInput v-model="form.smtp.pass" type="password" placeholder="QQ/163 填授权码" class="w-full" />
						</div>
					<div>
						<label class="mb-1 block text-sm">发件人邮箱</label>
						<UInput v-model="form.smtp.from" type="email" class="w-full" />
					</div>
					<div>
						<label class="mb-1 block text-sm">测试收件人邮箱</label>
						<UInput v-model="smtpTestTo" type="email" placeholder="输入邮箱后点击下方按钮发送测试邮件" class="w-full" />
					</div>
					<div class="flex items-center gap-3">
						<UButton variant="soft" :loading="smtpTesting" :disabled="!smtpTestTo" @click="onTestSmtp">
							发送测试邮件
						</UButton>
					</div>
					<UAlert
						v-if="smtpTestMessage"
						:color="smtpTestMessage.color"
						:title="smtpTestMessage.title"
						:description="smtpTestMessage.text"
					/>
				</div>
				</section>

				<section class="space-y-3">
					<h2 class="font-medium">
						OAuth 第三方登录（可选）
					</h2>
					<p class="text-sm text-neutral-500">
						可跳过，后续在管理后台配置。在 GitHub Settings → Developer settings → OAuth Apps 创建应用并获取凭证。
					</p>
					<div class="space-y-4">
						<div class="rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
							<div class="mb-3 flex items-center justify-between">
								<span class="font-medium">GitHub</span>
								<USwitch v-model="form.oauth.github.enabled" />
							</div>
							<div v-if="form.oauth.github.enabled" class="grid gap-3 sm:grid-cols-2">
								<UInput v-model="form.oauth.github.clientId" placeholder="Client ID" class="w-full" />
								<UInput v-model="form.oauth.github.clientSecret" type="password" placeholder="Client Secret" class="w-full" />
							</div>
						</div>
					</div>
				</section>

				<section class="space-y-3">
					<div class="flex items-center justify-between">
						<h2 class="font-medium">
							大模型 AI 接口配置（必填）
						</h2>
						<UBadge color="error" variant="soft" size="sm">
							必填
						</UBadge>
					</div>
					<p class="text-sm text-neutral-500">
						方向访谈、路径规划与关卡资料均由大模型生成，未配置则无法完成首次引导。
						支持 OpenAI 兼容协议（华为云 MaaS、DeepSeek、通义、智谱等）与 Anthropic。
					</p>
					<div class="space-y-3">
						<div>
							<label class="mb-1 block text-sm">提供商</label>
							<USelect v-model="form.llm.provider" :items="llmProviderOptions" class="w-full" />
						</div>
						<div v-if="form.llm.provider === 'custom'">
							<label class="mb-1 block text-sm">Base URL</label>
							<UInput v-model="form.llm.baseUrl" placeholder="https://your-api-endpoint/v1" class="w-full" />
						</div>
						<div>
							<label class="mb-1 block text-sm">API Key</label>
							<UInput v-model="form.llm.apiKey" type="password" placeholder="sk-..." class="w-full" />
						</div>
						<div class="grid gap-3 sm:grid-cols-2">
							<div>
								<label class="mb-1 block text-sm">模型名称</label>
								<UInput v-model="form.llm.model" placeholder="gpt-4o / claude-3-5-sonnet-..." class="w-full" />
							</div>
							<div>
								<label class="mb-1 block text-sm">最大输出 Token</label>
								<UInput v-model.number="form.llm.maxTokens" type="number" placeholder="4096" class="w-full" />
							</div>
						</div>
						<div class="flex items-center gap-3">
							<UButton
								variant="soft"
								:loading="llmTesting"
								:disabled="!form.llm.apiKey || !form.llm.model"
								@click="onTestLlm"
							>
								测试大模型连接
							</UButton>
							<span class="text-xs text-neutral-500">建议先点一次，确认 Key 和模型名都能用再安装</span>
						</div>
						<UAlert
							v-if="llmTestMessage"
							:color="llmTestMessage.color"
							:title="llmTestMessage.title"
							:description="llmTestMessage.text"
						/>
					</div>
				</section>

				<UAlert
					v-if="message"
					:color="message.color"
					:title="message.title"
					:description="message.text"
				/>
			</div>

			<template #footer>
				<UButton block size="lg" :loading="installing" @click="onSubmit">
					开始安装
				</UButton>
			</template>
		</UCard>
	</UContainer>
</template>
