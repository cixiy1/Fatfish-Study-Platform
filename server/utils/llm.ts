import type { LlmConfig } from "#shared/types/auth"
import { getLlmConfig, getSetting } from "../repositories/settings.repository"
import { asRecord, backoffMs, extractJson, isRetryableError, LlmFormatError } from "./llm-json"

/**
 * 统一的大模型客户端（零新增依赖，基于 Nitro 全局 $fetch）。
 *
 * 支持两种协议：
 * - OpenAI 兼容（/chat/completions + Bearer）：华为云 MaaS、DeepSeek、通义、智谱等
 * - Anthropic（/v1/messages + x-api-key）
 *
 * 约定：
 * - 大模型是**强依赖**：没配置时业务接口应当直接拒绝（见 llm-guard.ts），而不是返回假数据；
 * - 这里保留 mock 仅用于 FSP_LLM_MOCK=1 的离线单测，正常运行时不会触发；
 * - 调用失败默认降级为 mock 只是给「测试连接」之外的工具兜底，
 *   业务调用一律传 allowMockOnError: false，让错误抛出去由接口层翻译成用户能看懂的提示；
 * - 配置存在但 apiKey 解不出来（sessionSecret 变更）时抛错，不能静默 mock。
 */

export type LlmRole = "system" | "user" | "assistant"

export interface LlmMessage {
	role: LlmRole
	content: string
}

export interface LlmUsage {
	inputTokens: number
	outputTokens: number
}

export interface LlmResult {
	text: string
	model: string
	mock: boolean
	usage?: LlmUsage
	durationMs: number
}

export interface ChatOptions {
	messages: LlmMessage[]
	temperature?: number
	maxTokens?: number
	json?: boolean
	timeoutMs?: number
	retries?: number
	tag?: string
	allowMockOnError?: boolean
}

/** 配置存在但密钥无法解密（通常是 sessionSecret 被换过） */
export class LlmKeyUnreadableError extends Error {
	constructor(message = "大模型 API Key 无法解密，请在管理后台重新保存") {
		super(message)
		this.name = "LlmKeyUnreadableError"
	}
}

/**
 * 完全没有配置大模型。
 *
 * 大模型是本项目的强依赖，没有它就不该产出任何学习内容，
 * 所以这里直接抛错——业务接口应当更早地用 requireLlm() 拦下来，
 * 走到这里说明某个调用点漏了守卫，不能再用假数据掩盖。
 */
export class LlmNotConfiguredError extends Error {
	constructor(message = "尚未配置大模型接口") {
		super(message)
		this.name = "LlmNotConfiguredError"
	}
}

const DEFAULT_TIMEOUT_MS = 30_000
const DEFAULT_MAX_TOKENS = 8192
/**
 * 输出 token 下限。
 *
 * 现在是思考型模型（deepseek-flash / v4 这类）当道：一次请求的 max_tokens 是
 * 「思考 + 正文」的总和，光推理就能吃掉几千 token。业务侧按「正文大概多长」
 * 传 900、1200 这种值，模型会把额度全用在推理上，返回 content 为空、
 * finish_reason=length——表现就是「模型像没干活」。
 * 所以这里给一个下限，业务传小了也会被抬到这个值（max_tokens 只是上限，不按量计费）。
 */
const MIN_OUTPUT_TOKENS = 4096
/**
 * 输出 token 的失控保护上限。
 *
 * 后台配置的 maxTokens 只是「缺省值」而不是硬上限（见 resolveMaxTokens）：
 * 业务侧按实际需要申请更大的额度时必须放行，否则写两篇 500~800 字的微课
 * 会被钳到 4096 而必然截断。这里只防「业务侧写错成 100 万」这种失控。
 */
const HARD_CEILING_TOKENS = 32_768
const ANTHROPIC_VERSION = "2023-06-01"

/**
 * 计算本次请求真正生效的 max_tokens。
 *
 * 语义（重要）：后台配置是**缺省值**，业务侧的显式请求优先。
 * 旧实现是 `min(业务值, 后台值)`，等于把后台配置当硬上限——
 * plan-generator 申请 12000 会被钳到 4096，必然触发 LlmTruncatedError，
 * 这是「学习计划生成失败」的根因。max_tokens 只是上限、不按量计费，钳死没有收益。
 */
export function resolveMaxTokens(configured: number | undefined, requested: number | undefined): number {
	const fallback = configured && configured > 0 ? configured : DEFAULT_MAX_TOKENS
	const wanted = Math.max(requested ?? fallback, MIN_OUTPUT_TOKENS)
	return Math.min(wanted, HARD_CEILING_TOKENS)
}

/** 模型输出被 max_tokens 截断（通常是思考型模型把额度用在了推理上） */
export class LlmTruncatedError extends Error {
	constructor(readonly maxTokens: number, readonly model: string) {
		super(
			`模型输出被截断：max_tokens=${maxTokens} 已被用尽（模型「${model}」是思考型模型，推理会先吃掉额度）。`
			+ "请在「大模型配置」把输出上限调到 16384 以上再试",
		)
		this.name = "LlmTruncatedError"
	}
}

function isTruncated(finishReason: string | null): boolean {
	return finishReason === "length" || finishReason === "max_tokens"
}

function isAnthropicFormat(config: LlmConfig): boolean {
	return config.apiFormat === "anthropic"
}

/** 拼接端点，兼容用户在 baseUrl 里已经填了完整路径的情况 */
function resolveEndpoint(baseUrl: string, path: string): string {
	const base = (baseUrl || "").replace(/\/+$/, "")
	if (base.endsWith(path)) return base
	return `${base}${path}`
}

interface OpenAiResponse {
	choices?: { message?: { content?: string }, finish_reason?: string }[]
	usage?: { prompt_tokens?: number, completion_tokens?: number }
}

interface AnthropicResponse {
	content?: { type: string, text?: string }[]
	stop_reason?: string
	usage?: { input_tokens?: number, output_tokens?: number }
}

function readFinishReason(response: OpenAiResponse | AnthropicResponse, anthropic: boolean): string | null {
	if (anthropic) return (response as AnthropicResponse).stop_reason ?? null
	return (response as OpenAiResponse).choices?.[0]?.finish_reason ?? null
}

function readText(response: OpenAiResponse | AnthropicResponse, anthropic: boolean): string {
	if (anthropic) {
		const blocks = (response as AnthropicResponse).content ?? []
		return blocks
			.filter((block) => block.type === "text" && typeof block.text === "string")
			.map((block) => block.text as string)
			.join("")
	}
	return (response as OpenAiResponse).choices?.[0]?.message?.content ?? ""
}

function readUsage(response: OpenAiResponse | AnthropicResponse, anthropic: boolean): LlmUsage | undefined {
	if (anthropic) {
		const usage = (response as AnthropicResponse).usage
		if (!usage) return undefined
		return { inputTokens: usage.input_tokens ?? 0, outputTokens: usage.output_tokens ?? 0 }
	}
	const usage = (response as OpenAiResponse).usage
	if (!usage) return undefined
	return { inputTokens: usage.prompt_tokens ?? 0, outputTokens: usage.completion_tokens ?? 0 }
}

/** 当前是否处于强制 mock（环境变量开关，仅用于离线单测） */
export function isLlmMockForced(): boolean {
	return process.env.FSP_LLM_MOCK === "1"
}

interface LlmRequest {
	endpoint: string
	headers: Record<string, string>
	body: Record<string, unknown>
	anthropic: boolean
	/** 本次请求实际生效的 max_tokens（截断报错时要用） */
	maxTokens: number
}

/** 按协议拼出一次请求的端点 / 请求头 / 请求体 */
function buildRequest(
	config: LlmConfig,
	messages: LlmMessage[],
	options: { temperature?: number, maxTokens?: number, json?: boolean } = {},
): LlmRequest {
	const anthropic = isAnthropicFormat(config)
	const endpoint = resolveEndpoint(config.baseUrl, anthropic ? "/messages" : "/chat/completions")
	// 后台配置是缺省值，业务侧的显式请求优先（详见 resolveMaxTokens 的说明）
	const maxTokens = resolveMaxTokens(config.maxTokens, options.maxTokens)
	const temperature = options.temperature ?? 0.4

	const systemMessage = messages.find((message) => message.role === "system")?.content ?? ""
	const dialogMessages = messages.filter((message) => message.role !== "system")

	const body: Record<string, unknown> = anthropic
		? {
				model: config.model,
				max_tokens: maxTokens,
				temperature,
				...(systemMessage ? { system: systemMessage } : {}),
				messages: dialogMessages.map((message) => ({ role: message.role, content: message.content })),
			}
		: {
				model: config.model,
				max_tokens: maxTokens,
				temperature,
				messages: messages.map((message) => ({ role: message.role, content: message.content })),
				...(options.json ? { response_format: { type: "json_object" } } : {}),
			}

	const headers: Record<string, string> = anthropic
		? {
				"content-type": "application/json",
				"x-api-key": config.apiKey,
				"anthropic-version": ANTHROPIC_VERSION,
			}
		: {
				"content-type": "application/json",
				authorization: `Bearer ${config.apiKey}`,
			}

	return { endpoint, headers, body, anthropic, maxTokens }
}

/** 发一次请求，把两种协议的返回统一成文本 + 用量 + 结束原因 */
async function sendRequest(request: LlmRequest, timeoutMs: number) {
	const response = await $fetch<OpenAiResponse | AnthropicResponse>(request.endpoint, {
		method: "POST",
		headers: request.headers,
		body: request.body,
		retry: 0,
		timeout: 0,
		signal: AbortSignal.timeout(timeoutMs),
	})

	return {
		text: readText(response, request.anthropic),
		usage: readUsage(response, request.anthropic),
		finishReason: readFinishReason(response, request.anthropic),
	}
}

/**
 * 用「还没写进数据库」的配置做一次真实调用。
 *
 * 用于安装向导和后台保存前的自检：此时配置尚未落库，chat() 读不到，
 * 所以这里显式接收 config，且不做任何 mock 兜底——要的就是真实结果。
 */
export async function probeLlm(
	config: LlmConfig,
	prompt = "只回复两个字：可用",
): Promise<{ text: string, model: string, usage?: LlmUsage, durationMs: number }> {
	if (!config.apiKey) throw new Error("API Key 为空")
	if (!config.model) throw new Error("模型名称为空")
	if (!config.baseUrl) throw new Error("Base URL 为空")

	const startedAt = Date.now()
	const request = buildRequest(config, [{ role: "user", content: prompt }], {
		temperature: 0.1,
		maxTokens: 512,
	})
	const { text, usage, finishReason } = await sendRequest(request, 40_000)
	const trimmed = text.trim()

	// 思考型模型可能把额度全用在推理上、正文为空：只要确实消耗了 token 就算连通
	if (!trimmed) {
		if ((usage?.outputTokens ?? 0) > 0 || isTruncated(finishReason)) {
			return {
				text: "模型已连通（本次只输出了推理过程，未返回正文）",
				model: config.model,
				usage,
				durationMs: Date.now() - startedAt,
			}
		}
		throw new Error("模型返回了空内容，请确认模型名称是否有效")
	}

	return { text: trimmed.slice(0, 500), model: config.model, usage, durationMs: Date.now() - startedAt }
}


/**
 * 发起一次对话。
 *
 * 失败时：可重试错误按指数退避重试；重试用尽或不可重试，
 * allowMockOnError !== false 时返回 mock，否则抛出原始错误。
 */
export async function chat(options: ChatOptions): Promise<LlmResult> {
	const startedAt = Date.now()
	const tag = options.tag ?? "chat"
	const temperature = options.temperature ?? 0.4
	const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
	const retries = options.retries ?? 2
	const allowMock = options.allowMockOnError !== false

	// 有密文却解不出 key，说明 sessionSecret 变了，必须显式报错
	const rawSetting = getSetting("llm")
	const config = getLlmConfig()
	if (rawSetting && (!config || !config.apiKey)) {
		throw new LlmKeyUnreadableError()
	}

	if (isLlmMockForced()) {
		console.info(`[llm] ${tag} mock=true reason=forced`)
		return { text: "", model: "mock", mock: true, durationMs: Date.now() - startedAt }
	}

	// 没配置就别假装调用过：整条业务链都依赖真实模型
	if (!config) throw new LlmNotConfiguredError()

	const request = buildRequest(config, options.messages, {
		temperature,
		maxTokens: options.maxTokens,
		json: options.json,
	})

	let lastError: unknown = null

	for (let attempt = 0; attempt <= retries; attempt++) {
		const attemptStart = Date.now()
		try {
			const { text, usage, finishReason } = await sendRequest(request, timeoutMs)
			const durationMs = Date.now() - startedAt

			console.info(
				`[llm] ${tag} protocol=${request.anthropic ? "anthropic" : "openai"} model=${config.model}`
				+ ` attempt=${attempt + 1} durationMs=${Date.now() - attemptStart}`
				+ ` in=${usage?.inputTokens ?? 0} out=${usage?.outputTokens ?? 0}`
				+ ` maxTokens=${request.maxTokens} finish=${finishReason ?? "-"} mock=false`,
			)

			// 被截断时正文多半是空的或者半截 JSON，重试同一个上限没有意义，直接报清楚
			if (isTruncated(finishReason)) {
				throw new LlmTruncatedError(request.maxTokens, config.model)
			}

			return { text, model: config.model, mock: false, usage, durationMs }
		} catch (error) {
			lastError = error
			// 上限不够属于配置问题，重试也不会变好
			if (error instanceof LlmTruncatedError) break

			const retryable = isRetryableError(error)
			const durationMs = Date.now() - attemptStart
			console.warn(
				`[llm] ${tag} attempt=${attempt + 1} failed durationMs=${durationMs}`
				+ ` retryable=${retryable} error=${(error as Error)?.message ?? "unknown"}`,
			)

			if (!retryable || attempt === retries) break
			await new Promise((resolve) => setTimeout(resolve, backoffMs(attempt)))
		}
	}

	if (allowMock) {
		console.warn(`[llm] ${tag} fallback to mock after failure`)
		return { text: "", model: "mock", mock: true, durationMs: Date.now() - startedAt }
	}

	throw lastError instanceof Error ? lastError : new Error("大模型请求失败")
}

export interface ChatJsonOptions<T> extends ChatOptions {
	/** 字段校验 + 归一化，抛 LlmFormatError 表示不合格 */
	validate: (value: unknown) => T
	mock: () => T
	/** 总调用次数上限（含首次与修复），默认 3 */
	maxAttempts?: number
}

/**
 * 要求模型返回 JSON，并做「解析失败就让模型自己修」的循环。
 *
 * 每次修复都是一次独立调用，因此单关最坏调用次数 = maxAttempts。
 */
export async function chatJson<T>(options: ChatJsonOptions<T>): Promise<{ data: T, mock: boolean, model: string, durationMs: number }> {
	const maxAttempts = options.maxAttempts ?? 3
	let lastText = ""

	for (let attempt = 0; attempt < maxAttempts; attempt++) {
		const messages: LlmMessage[] = attempt === 0 || !lastText
			? options.messages
			: [
					...options.messages,
					{ role: "assistant", content: lastText.slice(0, 4000) },
					{
						role: "user",
						content: "上面的输出不是合法 JSON 或字段不符合约定。只输出修正后的 JSON 对象，不要解释，不要 Markdown 代码块。",
					},
				]

		const result = await chat({ ...options, messages, json: true, retries: options.retries ?? 1 })

		if (result.mock) {
			return { data: options.mock(), mock: true, model: "mock", durationMs: result.durationMs }
		}

		try {
			const parsed = asRecord(extractJson(result.text))
			return { data: options.validate(parsed), mock: false, model: result.model, durationMs: result.durationMs }
		} catch (error) {
			lastText = result.text
			console.warn(
				`[llm] ${options.tag ?? "json"} attempt=${attempt + 1} invalid json`
				+ ` textLen=${result.text.length} error=${error instanceof LlmFormatError ? error.message : "parse error"}`,
			)
		}
	}

	// 修复次数用尽仍不合格：不再拿 mock 顶上，让调用方明确失败
	throw new LlmFormatError(`模型连续 ${maxAttempts} 次没有返回符合约定的 JSON`)
}

/**
 * 限并发地跑异步任务。
 *
 * SQLite 写入是同步的，这里只包 LLM 调用（纯网络、不写库），
 * 所以并发不会引入数据库锁问题。
 */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
	const results = new Array<R>(items.length)
	let cursor = 0

	async function worker(): Promise<void> {
		while (cursor < items.length) {
			const index = cursor
			cursor += 1
			results[index] = await fn(items[index] as T, index)
		}
	}

	const workerCount = Math.max(1, Math.min(limit, items.length))
	await Promise.all(Array.from({ length: workerCount }, () => worker()))
	return results
}

/** 读取整型环境变量，非法或缺失时用默认值 */
export function envInt(name: string, fallback: number): number {
	const raw = process.env[name]
	if (!raw) return fallback
	const num = Number(raw)
	return Number.isFinite(num) ? Math.round(num) : fallback
}

/* -------------------------------------------------------------------------- */
/* 流式调用                                                                    */
/* -------------------------------------------------------------------------- */

export interface ChatStreamOptions {
	messages: LlmMessage[]
	temperature?: number
	maxTokens?: number
	/**
	 * 空闲超时（毫秒）：自上次收到数据起重新计时。
	 *
	 * 注意这里**不是**整段流的墙钟上限——思考型模型可能 20~30s 后才吐第一个字，
	 * 用墙钟会把正常的长请求误杀。旧实现的语义是墙钟，已改。
	 */
	timeoutMs?: number
	tag?: string
	/** 上游取消信号（如客户端断开 SSE），中止后不再继续消耗模型额度 */
	signal?: AbortSignal
}

/** 流式调用结束后的元信息 */
export interface ChatStreamMeta {
	text: string
	model: string
	/** 输出是否因达到 max_tokens 而被截断 */
	truncated: boolean
	finishReason: string | null
	durationMs: number
}

/** 把业务信号与内部超时信号合并（Node 18 没有 AbortSignal.any） */
function combineSignals(signals: (AbortSignal | undefined)[]): AbortSignal {
	const controller = new AbortController()
	for (const signal of signals) {
		if (!signal) continue
		if (signal.aborted) {
			controller.abort()
			break
		}
		signal.addEventListener("abort", () => controller.abort(), { once: true })
	}
	return controller.signal
}

/**
 * 流式调用大模型，逐块 yield 文本片段。
 *
 * 用 native fetch 拿 ReadableStream，按 SSE 协议解析 delta。
 * OpenAI 和 Anthropic 两种格式都支持。
 * 生成器返回值是 ChatStreamMeta（含是否截断），对只做 `for await` 的调用方无影响。
 */
export async function* chatStream(options: ChatStreamOptions): AsyncGenerator<string, ChatStreamMeta> {
	const tag = options.tag ?? "stream"
	const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
	const startedAt = Date.now()

	const rawSetting = getSetting("llm")
	const config = getLlmConfig()
	if (rawSetting && (!config || !config.apiKey)) {
		throw new LlmKeyUnreadableError()
	}
	if (!config) throw new LlmNotConfiguredError()

	const request = buildRequest(config, options.messages, {
		temperature: options.temperature,
		maxTokens: options.maxTokens,
	})
	const body = { ...request.body, stream: true }

	// 建连阶段用整段超时（避免连不上时无限挂起），之后交给流内的空闲超时
	const response = await fetch(request.endpoint, {
		method: "POST",
		headers: request.headers,
		body: JSON.stringify(body),
		signal: combineSignals([options.signal, AbortSignal.timeout(timeoutMs)]),
	})

	if (!response.ok || !response.body) {
		const text = await response.text().catch(() => "")
		throw new Error(`大模型流式调用失败 status=${response.status} ${text.slice(0, 200)}`)
	}

	const reader = response.body.getReader()
	const decoder = new TextDecoder()
	let buffer = ""
	let fullText = ""
	let finishReason: string | null = null

	try {
		while (true) {
			// 每次读取单独计时，收到数据就重置：长流不会被固定墙钟误杀
			let idleHandle: ReturnType<typeof setTimeout> | undefined
			let idleReject: ((reason: Error) => void) | undefined
			const idle = new Promise<never>((_, reject) => {
				idleReject = reject
				idleHandle = setTimeout(() => {
					reject(new Error(`大模型流式响应空闲超过 ${Math.round(timeoutMs / 1000)}s`))
				}, timeoutMs)
			})

			let result: ReadableStreamReadResult<Uint8Array>
			try {
				result = await Promise.race([reader.read(), idle, abortPromise(options.signal)])
			} finally {
				if (idleHandle) clearTimeout(idleHandle)
				idleReject = undefined
			}

			const { done, value } = result
			if (done) break

			buffer += decoder.decode(value, { stream: true })
			const lines = buffer.split("\n")
			buffer = lines.pop() ?? ""

			for (const line of lines) {
				const trimmed = line.trim()
				if (!trimmed || !trimmed.startsWith("data:")) continue

				const data = trimmed.slice(5).trim()
				if (data === "[DONE]") break

				try {
					const parsed = JSON.parse(data) as Record<string, unknown>
					const reason = request.anthropic
						? extractAnthropicFinishReason(parsed)
						: extractOpenAiFinishReason(parsed)
					if (reason) finishReason = reason

					const delta = request.anthropic
						? extractAnthropicDelta(parsed)
						: extractOpenAiDelta(parsed)
					if (delta) {
						fullText += delta
						yield delta
					}
				} catch {
					// JSON 解析失败的单行跳过，SSE 可能有不完整片段
				}
			}
		}
	} finally {
		// 异常或提前 return 时也要真正关掉上游连接，否则长连接泄漏
		try {
			await reader.cancel()
		} catch {
			// 已读完或已断开
		}
		reader.releaseLock()
	}

	const meta: ChatStreamMeta = {
		text: fullText,
		model: config.model,
		truncated: isTruncated(finishReason),
		finishReason,
		durationMs: Date.now() - startedAt,
	}
	console.info(
		`[llm] ${tag} stream done protocol=${request.anthropic ? "anthropic" : "openai"} model=${config.model}`
		+ ` chars=${fullText.length} finish=${finishReason ?? "-"} truncated=${meta.truncated}`,
	)
	return meta
}

/** 把已中止/外部中止的 signal 转成一个会 reject 的 promise */
function abortPromise(signal?: AbortSignal): Promise<never> {
	if (!signal) return new Promise(() => {})
	if (signal.aborted) return Promise.reject(new Error("ABORTED"))
	return new Promise((_, reject) => {
		signal.addEventListener("abort", () => reject(new Error("ABORTED")), { once: true })
	})
}

function extractOpenAiFinishReason(parsed: Record<string, unknown>): string | null {
	const choices = parsed.choices as { finish_reason?: string | null }[] | undefined
	return choices?.[0]?.finish_reason ?? null
}

function extractAnthropicFinishReason(parsed: Record<string, unknown>): string | null {
	// Anthropic 的 message_delta 事件里带 delta.stop_reason
	const delta = parsed.delta as { stop_reason?: string | null } | undefined
	return delta?.stop_reason ?? null
}

function extractOpenAiDelta(parsed: Record<string, unknown>): string | null {
	const choices = parsed.choices as { delta?: { content?: string } }[] | undefined
	const content = choices?.[0]?.delta?.content
	return typeof content === "string" && content.length > 0 ? content : null
}

function extractAnthropicDelta(parsed: Record<string, unknown>): string | null {
	if (parsed.type !== "content_block_delta") return null
	const delta = parsed.delta as { type?: string, text?: string } | undefined
	if (delta?.type !== "text_delta") return null
	return typeof delta.text === "string" && delta.text.length > 0 ? delta.text : null
}
