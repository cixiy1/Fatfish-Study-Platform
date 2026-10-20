import { requireAdmin } from "../../utils/admin-guard"
import { isInstalled } from "../../utils/app-config"

interface FetchModelsBody {
	baseUrl?: string
	apiKey?: string
	apiFormat?: "openai" | "anthropic"
}

/**
 * 拉取模型列表：POST /api/admin/fetch-models
 *
 * 已安装时要求管理员权限；未安装时放行（install 向导中需要拉取模型）。
 */
export default defineEventHandler(async (event) => {
	if (isInstalled()) {
		requireAdmin(event)
	}

	const body = await readBody<FetchModelsBody>(event).catch(() => null)
	const baseUrl = (body?.baseUrl ?? "").trim().replace(/\/+$/, "")
	const apiKey = (body?.apiKey ?? "").trim()
	const apiFormat = body?.apiFormat ?? "openai"

	if (!baseUrl) throw createError({ statusCode: 400, message: "请填写 Base URL" })
	if (!apiKey) throw createError({ statusCode: 400, message: "请填写 API Key" })

	try {
		const headers: Record<string, string> = apiFormat === "anthropic"
			? {
					"x-api-key": apiKey,
					"anthropic-version": "2023-06-01",
				}
			: {
					authorization: `Bearer ${apiKey}`,
				}

		const res = await $fetch<{ data?: { id: string }[] }>(`${baseUrl}/models`, {
			method: "GET",
			headers,
			retry: 0,
			timeout: 15000,
		})

		const models = (res.data ?? [])
			.map((m) => m.id)
			.filter(Boolean)
			.sort()

		return { ok: true, models }
	} catch (error) {
		const data = (error as { data?: Record<string, unknown> })?.data
		if (data) {
			const err = data.error
			if (typeof err === "object" && err !== null) {
				const msg = (err as { message?: string }).message
				if (msg) throw createError({ statusCode: 502, message: `拉取模型列表失败: ${msg}` })
			}
			if (typeof err === "string") throw createError({ statusCode: 502, message: `拉取模型列表失败: ${err}` })
		}
		const msg = error instanceof Error ? error.message : "未知错误"
		throw createError({ statusCode: 502, message: `拉取模型列表失败: ${msg}` })
	}
})
