/**
 * 整套学习资料的生成器。
 *
 * 一次请求要产出「一条路径上的全部关卡资料」，所以这里做三件事：
 * 1. 分块：每次只让模型写 2 个技能点，输出不会超长被截断；
 * 2. 限并发：块与块之间最多 2 路并行，避免触发限流；
 * 3. 严格失败：大模型是强依赖，任何一块没生成出来就整体报错，
 *    由接口层标记 failed 让用户重试——绝不拿模板冒充模型产出。
 *
 * buildStub 只在显式降级（离线单测 / FSP_LLM_MOCK=1）时才会被用到。
 */
import { insertGeneratedResource, updateGeneratedResource } from "../repositories/learning.repository"
import { chatJson, isLlmMockForced, mapLimit } from "./llm"
import { asRecord, clampInt, LlmFormatError, oneOf, str, strArray } from "./llm-json"

export interface PlanSkill {
	id: number
	name: string
	category: string
	level: number
	description: string | null
	required_level: number
}

export type Difficulty = "beginner" | "intermediate" | "advanced"

export interface PlanMaterial {
	skillId: number
	title: string
	summary: string
	objectives: string[]
	content: string
	minutes: number
	difficulty: Difficulty
	/** model = 真模型生成，stub = 本地模板兜底 */
	origin: "model" | "stub"
}

export interface GenerateContext {
	positionName: string
	goal: string | null
	level: string | null
	dailyMinutes: number
}

/** 每次让模型写几个技能点 */
const CHUNK_SIZE = 2
/** 块间并发上限 */
const CONCURRENCY = 2
/** 整套资料的总时间预算，超了就降级，不让请求一直挂着 */
export const DEFAULT_BUDGET_MS = 300_000
/** 单块超时：一块写 2 篇，给足时间但别无限等 */
const CHUNK_TIMEOUT_MS = 120_000

const DIFFICULTIES = ["beginner", "intermediate", "advanced"] as const

function difficultyOf(level: number): Difficulty {
	if (level <= 1) return "beginner"
	if (level <= 3) return "intermediate"
	return "advanced"
}

function describeProfile(ctx: GenerateContext): string {
	const parts = [
		ctx.goal ? `目标：${ctx.goal}` : "",
		ctx.level ? `当前基础：${ctx.level}` : "",
		`每天可投入：${ctx.dailyMinutes} 分钟`,
	]
	return parts.filter(Boolean).join("；")
}

function buildMessages(skills: PlanSkill[], ctx: GenerateContext) {
	const list = skills
		.map((skill, index) => {
			const desc = skill.description?.trim()
				? `（${skill.description}）`
				: `（${skill.name}的核心概念与实操）`
			return `${index + 1}. ${skill.name}｜分类：${skill.category}｜难度：${difficultyOf(skill.level)}${desc}`
		})
		.join("\n")

	return [
		{
			role: "system" as const,
			content: [
				"你是学习内容设计师，为「零基础但肯动手」的学习者写微课资料。",
				"写作要求：多用短句，先讲清「这东西解决什么问题」，再给能照着做的步骤或示例（涉及代码就给可运行的代码）。",
				"禁止空话套话（如「随着互联网的发展」），禁止写「以下是」「希望对你有帮助」。",
				"只输出 JSON 对象，不要 Markdown 代码块包裹。",
				"每个技能点的 content 必须不少于 400 字，否则视为不合格。",
			].join("\n"),
		},
		{
			role: "user" as const,
			content: [
				`学习方向：${ctx.positionName}`,
				`学习者情况：${describeProfile(ctx)}`,
				"",
				`请为下面 ${skills.length} 个技能点各写一份微课资料，编号与顺序必须对应：`,
				list,
				"",
				"输出格式：",
				'{"materials":[{"index":1,"title":"关卡标题（12字内，动词开头）","summary":"一句话说明这关能干什么","objectives":["学完能做到的事","..."],"content":"Markdown正文","minutes":20,"difficulty":"beginner"}]}',
				"",
				"字段要求：",
				"- index：对应上面的编号，从 1 开始",
				"- title：12 字以内，用动词开头，如「用 Flex 排三栏布局」",
				"- summary：20~40 字，说清学完能解决什么具体问题",
				"- objectives：2~4 条，每条 15 字以内，都以「能」开头",
				"- minutes：整数，10~45，按难度给",
				"- difficulty：beginner / intermediate / advanced 三选一",
				"- content：Markdown 正文，依次包含四个二级标题：## 为什么学它、## 核心概念、## 动手做一遍、## 容易踩的坑",
				"  正文 500~800 字；代码用 ``` 代码块，操作步骤用有序列表；不要出现一级标题，不要重复 title",
				"  content 绝不能为空或过短，每个技能点都要写满四个章节。",
			].join("\n"),
		},
	]
}

/** 校验一块（最多 CHUNK_SIZE 个技能）的返回，按下标对齐到技能 */
function validateChunk(value: unknown, skills: PlanSkill[]): PlanMaterial[] {
	const record = asRecord(value)
	const raw = record.materials ?? record.items
	if (!Array.isArray(raw) || raw.length === 0) {
		throw new LlmFormatError("缺少 materials 数组")
	}

	const result: PlanMaterial[] = []
	let invalidCount = 0

	for (const [position, item] of raw.entries()) {
		const material = asRecord(item)
		const index = clampInt(material.index, 1, skills.length, position + 1)
		const skill = skills[index - 1]
		if (!skill) continue

		try {
			result.push({
				skillId: skill.id,
				title: str(material.title, 2, 40, "title"),
				summary: str(material.summary, 5, 120, "summary"),
				objectives: strArray(material.objectives, 1, 5, 60, "objectives"),
				content: str(material.content, 80, 6000, "content"),
				minutes: clampInt(material.minutes, 5, 60, 15),
				difficulty: oneOf(material.difficulty, DIFFICULTIES, difficultyOf(skill.level)),
				origin: "model",
			})
		} catch (error) {
			invalidCount += 1
			const reason = error instanceof Error ? error.message : "unknown"
			const contentPreview = typeof material.content === "string"
				? `contentLen=${material.content.length}`
				: `contentType=${typeof material.content}`
			console.warn(
				`[plan-generator] skill ${skill.id} (${skill.name}) validation failed: ${reason}`
				+ ` ${contentPreview}`
				+ ` keys=${Object.keys(material).join(",")}`,
			)
		}
	}

	if (result.length === 0) {
		throw new LlmFormatError(`materials 全部无效（${invalidCount} 个校验失败）`)
	}
	if (invalidCount > 0) {
		console.warn(`[plan-generator] chunk partial success: ${result.length} ok, ${invalidCount} invalid`)
	}
	return result
}

/** 本地模板兜底：没有模型时也能读到有信息量的内容 */
function buildStub(skill: PlanSkill): PlanMaterial {
	const what = skill.description?.trim() || `${skill.name} 的核心用法`
	const steps = [
		`先花 5 分钟搞清「${skill.name}」到底解决什么问题，把一句话解释写在纸上。`,
		`照着最短示例敲一遍，跑通后再逐行改动参数，看输出怎么变。`,
		`关掉示例，从空白开始重写一遍；卡住的地方就是要重点记的地方。`,
	]
	const content = [
		"## 为什么学它",
		`${what} 是「${skill.category}」方向上的基础能力，后面还会反复用到。`,
		"",
		"## 核心概念",
		`本关聚焦「${skill.name}」，先记住它的输入、输出和适用场景三件事。`,
		"",
		"## 动手做一遍",
		...steps.map((step, index) => `${index + 1}. ${step}`),
		"",
		"## 容易踩的坑",
		"- 只看不写：手敲一遍比读三遍有效。",
		"- 一次改太多：每次只改一个变量，才能看出因果。",
		"",
		"> 这段是离线兜底内容。大模型可用后重新生成本关，会得到更具体的示例。",
	].join("\n")

	return {
		skillId: skill.id,
		title: `${skill.name} 入门`,
		summary: `用最短路径上手 ${skill.name}，先跑通再理解。`,
		objectives: [`能说清 ${skill.name} 的作用`, `能独立完成一个最小示例`],
		content,
		minutes: difficultyOf(skill.level) === "beginner" ? 15 : 25,
		difficulty: difficultyOf(skill.level),
		origin: "stub",
	}
}

export interface GenerateResult {
	materials: PlanMaterial[]
	/** 模型成功产出几个 */
	generated: number
	/** 本地兜底几个 */
	fallback: number
	model: string
	/** 有兜底内容即视为降级 */
	degraded: boolean
	elapsedMs: number
}

/** 有技能点没生成出来：接口层据此标记 failed 并让用户重试 */
export class PlanGenerationError extends Error {
	constructor(message: string, readonly failedSkills: string[]) {
		super(message)
		this.name = "PlanGenerationError"
	}
}

export interface GenerateOptions {
	/** 单次总预算，默认 DEFAULT_BUDGET_MS */
	budgetMs?: number
	/** 允许本地模板兜底（离线单测用），默认 false */
	allowDegrade?: boolean
}

/**
 * 生成整套资料。
 *
 * 默认严格模式：只要有一个技能点没拿到模型正文就抛 PlanGenerationError，
 * 调用方不会拿到「一半真一半假」的结果。
 */
export async function generatePlanMaterials(
	skills: PlanSkill[],
	ctx: GenerateContext,
	options: GenerateOptions = {},
): Promise<GenerateResult> {
	const budgetMs = options.budgetMs ?? DEFAULT_BUDGET_MS
	// 强制 mock 就是离线模式，此时才允许用模板顶上
	const allowDegrade = options.allowDegrade ?? isLlmMockForced()
	const startedAt = Date.now()
	const collected = new Map<number, PlanMaterial>()
	let model = "stub"

	if (skills.length === 0) {
		return { materials: [], generated: 0, fallback: 0, model, degraded: false, elapsedMs: 0 }
	}

	const chunks: PlanSkill[][] = []
	for (let i = 0; i < skills.length; i += CHUNK_SIZE) {
		chunks.push(skills.slice(i, i + CHUNK_SIZE))
	}

	await mapLimit(chunks, CONCURRENCY, async (chunk) => {
		// 预算用完就别再发请求了，剩下的走本地模板
		if (Date.now() - startedAt > budgetMs) {
			console.warn(`[plan-generator] budget exhausted, skip ${chunk.length} skills`)
			return
		}

		/** 单个技能点单独生成：token 需求更小，整块失败或只回来一半时用它补齐 */
		async function fillIndividually(targets: PlanSkill[]) {
			for (const skill of targets) {
				if (collected.has(skill.id)) continue
				if (Date.now() - startedAt > budgetMs) break

				try {
					const single = await chatJson<PlanMaterial[]>({
						messages: buildMessages([skill], ctx),
						temperature: 0.5,
						maxTokens: 8000,
						timeoutMs: CHUNK_TIMEOUT_MS,
						maxAttempts: 3,
						tag: `plan:single:${skill.id}`,
						validate: (value) => validateChunk(value, [skill]),
						allowMockOnError: false,
						mock: () => [],
					})
					if (!single.mock) {
						model = single.model
						for (const material of single.data) {
							collected.set(material.skillId, material)
						}
					}
				} catch (singleError) {
					console.warn(
						`[plan-generator] single retry failed skill=${skill.id} (${skill.name})`
						+ ` error=${singleError instanceof Error ? singleError.message : "unknown"}`,
					)
				}
			}
		}

		try {
			const res = await chatJson<PlanMaterial[]>({
				messages: buildMessages(chunk, ctx),
				temperature: 0.5,
				// 思考型模型的推理 token 也算在 max_tokens 里，一块两篇至少给到 12000
				maxTokens: 12000,
				timeoutMs: CHUNK_TIMEOUT_MS,
				maxAttempts: 3,
				tag: `plan:${chunk.map((s) => s.id).join(",")}`,
				validate: (value) => validateChunk(value, chunk),
				// 网络/限流失败必须抛出去，让整次生成明确失败，而不是悄悄写模板
				allowMockOnError: false,
				mock: () => [],
			})

			if (res.mock) return
			model = res.model
			for (const material of res.data) {
				collected.set(material.skillId, material)
			}
		} catch (error) {
			console.warn(
				`[plan-generator] chunk failed skills=${chunk.map((s) => s.id).join(",")}`
				+ ` error=${error instanceof Error ? error.message : "unknown"}, retrying individually`,
			)
		}

		// 整块抛错、或者只回来一部分（validateChunk 允许部分成功）时，剩下的逐个补
		await fillIndividually(chunk)
	})

	const materials: PlanMaterial[] = []
	const missing: string[] = []
	let generated = 0
	let fallback = 0

	for (const skill of skills) {
		const material = collected.get(skill.id)
		if (material) {
			generated += 1
			materials.push(material)
			continue
		}
		fallback += 1
		missing.push(skill.name)
		materials.push(buildStub(skill))
	}

	// 严格模式：缺一个就不交付，宁可让用户重试也不给半真半假的内容
	if (missing.length > 0 && !allowDegrade) {
		console.warn(
			`[plan-generator] incomplete generated=${generated} missing=${missing.join("、")}`,
		)
		throw new PlanGenerationError(
			`有 ${missing.length} 个技能点没生成出资料（${missing.slice(0, 3).join("、")}`
			+ `${missing.length > 3 ? " 等" : ""}），可以稍后重试`,
			missing,
		)
	}

	return {
		materials,
		generated,
		fallback,
		model,
		degraded: fallback > 0,
		elapsedMs: Date.now() - startedAt,
	}
}

/**
 * 落库并返回 skillId → resourceId。
 *
 * - replaceById 里有这个技能：原地覆盖那条旧资料（典型场景：把离线模板升级成模型正文）
 * - 没有：新建一行
 *
 * 调用方只传「确实需要写正文」的技能，所以这里不再判断谁该跳过。
 */
export function persistMaterials(
	materials: PlanMaterial[],
	replaceById: Map<number, number> = new Map(),
): Map<number, number> {
	const resourceIds = new Map<number, number>()

	for (const material of materials) {
		const payload = {
			title: material.title,
			summary: material.summary,
			objectives: material.objectives,
			content: material.content,
			difficulty: material.difficulty,
			estimatedMinutes: material.minutes,
			model: material.origin === "model" ? "llm" : "stub",
		}

		const existingId = replaceById.get(material.skillId)
		if (existingId) {
			updateGeneratedResource(existingId, payload)
			resourceIds.set(material.skillId, existingId)
			continue
		}

		resourceIds.set(material.skillId, insertGeneratedResource({ ...payload, skillId: material.skillId }))
	}

	return resourceIds
}
