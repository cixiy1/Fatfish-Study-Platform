import type { DirectionCandidate, DirectionInterviewResponse, DirectionProfile, DirectionMessage } from "#shared/types/direction"
import { findAllPositions, findAllSkills, findSkillsByPosition } from "../../repositories/learning.repository"
import { findUserByAccount } from "../../repositories/user.repository"
import { encodePayload, sign } from "../../utils/crypto"
import type { DirectionCatalog } from "../../utils/direction-normalize"
import { normalizeDirections, skillKey } from "../../utils/direction-normalize"
import { chatJson } from "../../utils/llm"
import { requireLlm } from "../../utils/llm-guard"
import { asRecord, LlmFormatError, str, strArray } from "../../utils/llm-json"
import { checkRateLimit } from "../../utils/rate-limit"
import { getSessionSecret, readSession } from "../../utils/session"

/**
 * 学习方向访谈：POST /api/direction/interview
 *
 * 由模型动态追问（一次一个问题），信息足够后返回 1~3 个方向候选。
 * 平台不限定学习领域，技能点可以来自技能库，也可以由模型现场提出（newSkills）。
 * 服务端不盲信模型的 done，还有三重兜底：
 *   1. 回答轮数 < 2 → 继续问
 *   2. 回答轮数 >= 5 → 强制收口（额外一次调用，明确"不许再问"）
 *   3. 画像覆盖字段 < 2 → 继续问缺失项
 */

const MIN_TURNS = 2
const MAX_TURNS = 5
const MAX_HISTORY = 8
const TOKEN_TTL_SECONDS = 30 * 60

interface ModelTurn {
	done: boolean
	question?: string
	options?: string[]
	profile: DirectionProfile
	directions?: DirectionCandidate[]
}

interface SelectionPayload {
	v: 1
	uid: number
	exp: number
	profile: DirectionProfile
	directions: DirectionCandidate[]
}

function optionalStr(value: unknown, max = 120): string | null {
	if (typeof value !== "string") return null
	const trimmed = value.trim()
	return trimmed ? trimmed.slice(0, max) : null
}

function buildCatalog(): { text: string, catalog: DirectionCatalog } {
	const skills = findAllSkills()
	const ids = new Set<number>()
	const categoryOf = new Map<number, string>()
	const nameOf = new Map<number, string>()
	const idByName = new Map<string, number>()

	const lines = skills.map((skill) => {
		ids.add(skill.id)
		categoryOf.set(skill.id, skill.category)
		nameOf.set(skill.id, skill.name)
		const key = skillKey(skill.name)
		if (!idByName.has(key)) idByName.set(key, skill.id)
		const desc = (skill.description ?? "").slice(0, 30)
		return `${skill.id} [${skill.category}] ${skill.name}${desc ? ` —— ${desc}` : ""}`
	})

	return { text: lines.join("\n"), catalog: { ids, categoryOf, nameOf, idByName } }
}

function systemPrompt(catalogText: string): string {
	return `你是学习顾问，正在帮一名学习者规划「任何他想学的东西」——不限编程，语言、乐器、设计、烹饪、考证、专业课、职场技能都可以。

规则：
1. 每轮只问一个最关键的问题，并给 3~4 个短选项（每个不超过 14 字）。最后一个选项固定为"其他（我自己说）"。
2. 不要重复问已经问过的事。
3. 当已经知道以下至少两项时就可以结束提问：想学什么、当前基础、每周可投入时间、学习偏好。
4. 用户想学的东西可以不在下方技能目录里，照常给出方向，不要拒绝、不要劝他换方向。
5. 每个方向的技能点按"从入门到能做出来"的学习顺序排列，3~8 个，要具体可检验（写"用过去时讲昨天做了什么"，不要写"掌握语法"）。
6. 技能点优先复用下方目录里已有的（填 skillIds）；目录里没有的，用 newSkills 给名称（每条 2~20 字，可带 level 1-3）。
7. category 用简短领域词（如 语言、前端、设计、商科、生活），不必受目录分类限制。
8. 只输出 JSON，不要解释，不要 Markdown 代码块。

未问完时输出：
{"done":false,"question":"问题","options":["选项1","选项2","选项3"],"profile":{"goal":null,"level":null,"timeBudget":null,"preference":null}}

问完时输出：
{"done":true,"profile":{"goal":"...","level":"...","timeBudget":"...","preference":"...","summary":"一句话画像"},"directions":[{"name":"方向名","category":"语言","reason":"为什么这样安排，40字内","matchScore":85,"skillIds":[1,2],"newSkills":[{"name":"五十音与发音","level":1},{"name":"动词变形","level":2}],"skillLevels":{"1":1},"estimatedWeeks":10}]}

directions 给 1~3 个，按匹配度从高到低；estimatedWeeks 取 4~24。

下面是技能库里已有的技能（id [分类] 名称 —— 描述），能复用就复用：
${catalogText}`
}

/** 把历史对话转成一段纯文本记录，避免不同协议对 role 顺序的要求差异 */
function buildTranscript(history: DirectionMessage[]): string {
	if (history.length === 0) return "（对话还没开始）"
	return history
		.map((message) => `${message.role === "user" ? "学习者" : "顾问"}：${message.content}`)
		.join("\n")
}

function sanitizeHistory(input: unknown): DirectionMessage[] {
	if (!Array.isArray(input)) return []
	return input
		.filter((item): item is { role: string, content: string } =>
			!!item && typeof item === "object"
			&& ((item as { role?: unknown }).role === "user" || (item as { role?: unknown }).role === "assistant")
			&& typeof (item as { content?: unknown }).content === "string")
		.slice(-MAX_HISTORY)
		.map((item) => ({
			role: item.role as "user" | "assistant",
			content: item.content.trim().slice(0, 500),
		}))
}

/** 本地追问：模型已经说 done 但信息不足时用，避免再多一次调用 */
function followUpFor(profile: DirectionProfile): { question: string, options: string[] } {
	if (!profile.level) {
		return {
			question: "你在这个方向上目前的基础大概到哪一步？",
			options: ["完全没接触过", "看过教程没动手", "做过小项目", "其他（我自己说）"],
		}
	}
	if (!profile.timeBudget) {
		return {
			question: "你每周能稳定投入多少时间学习？",
			options: ["3 小时以内", "3~6 小时", "6~10 小时", "其他（我自己说）"],
		}
	}
	if (!profile.goal) {
		return {
			question: "你学这个主要想解决什么？",
			options: ["学完能上手做", "为考试或证书", "单纯感兴趣", "其他（我自己说）"],
		}
	}
	return {
		question: "你更喜欢哪种学习方式？",
		options: ["先看文档打基础", "边做项目边学", "刷题式巩固", "其他（我自己说）"],
	}
}

/** 演示模式的方向：直接复用已有岗位，保证没配 key 也能走完流程 */
function mockDirections(userId: number): DirectionCandidate[] {
	const positions = findAllPositions(userId).slice(0, 2)
	if (positions.length === 0) {
		throw new LlmFormatError("数据库里没有任何岗位，无法生成演示方向")
	}

	return positions.map((position, index) => {
		const skills = findSkillsByPosition(position.id).slice(0, 6)
		const skillLevels: Record<string, number> = {}
		skills.forEach((skill, skillIndex) => {
			skillLevels[String(skill.id)] = skillIndex < 2 ? 2 : 1
		})

		return {
			name: position.name,
			category: position.category,
			reason: `与该方向匹配，已预设 ${skills.length} 个技能点，可先生成一条完整路径。`,
			matchScore: 85 - index * 8,
			skillIds: skills.map((skill) => skill.id),
			skillLevels,
			previewSkills: skills.map((skill) => skill.name).slice(0, 6),
			estimatedWeeks: 8 + index * 2,
		}
	})
}

export default defineEventHandler(async (event): Promise<DirectionInterviewResponse> => {
	const session = readSession(event)
	if (!session) throw createError({ statusCode: 401, message: "未登录" })

	const user = findUserByAccount(session.account)
	if (!user) throw createError({ statusCode: 401, message: "用户不存在" })

	if (!checkRateLimit(`direction:${user.id}`, 30, 60_000)) {
		throw createError({ statusCode: 429, message: "问得太快了，稍等一下再继续" })
	}

	// 访谈完全由模型驱动：没配大模型就别装作在聊，直接让前端去配置
	requireLlm()

	const body = await readBody<{ history?: unknown }>(event).catch(() => null)
	const history = sanitizeHistory(body?.history)
	const userTurns = history.filter((message) => message.role === "user").length

	const built = buildCatalog()
	const catalogText = built.text
	const catalog = built.catalog

	const ask = async (overrideSystem?: string) => chatJson<ModelTurn>({
		messages: [
			{ role: "system", content: overrideSystem ?? systemPrompt(catalogText) },
			{
				role: "user",
				content: `对话记录：\n${buildTranscript(history)}\n\n现在请给出下一步，严格输出 JSON。`,
			},
		],
		temperature: 0.5,
		maxTokens: 900,
		timeoutMs: 15_000,
		retries: 1,
		maxAttempts: 2,
		tag: "direction:interview",
		// 大模型是强依赖：调用失败就报错，不能拿演示追问糊弄用户
		allowMockOnError: false,
		validate: (payload) => {
			const record = asRecord(payload)
			const profileRaw = asRecord(record.profile ?? {})
			const profile: DirectionProfile = {
				goal: optionalStr(profileRaw.goal),
				level: optionalStr(profileRaw.level),
				timeBudget: optionalStr(profileRaw.timeBudget),
				preference: optionalStr(profileRaw.preference),
				summary: optionalStr(profileRaw.summary, 200) ?? undefined,
			}

			const done = record.done === true
			if (!done) {
				return {
					done: false,
					question: str(record.question, 2, 120, "question"),
					options: strArray(record.options, 2, 4, 20, "options"),
					profile,
				}
			}

			return { done: true, profile, directions: normalizeDirections(record.directions, catalog) }
		},
		mock: () => {
			if (userTurns === 0) {
				return {
					done: false,
					question: "你最近最想学会的一件事是什么？",
					options: ["学一门语言", "学一项职业技能", "补一门专业课", "其他（我自己说）"],
					profile: { goal: null, level: null, timeBudget: null, preference: null },
				}
			}
			if (userTurns === 1) {
				return {
					done: false,
					question: "你在这方面目前的基础大概到哪一步？",
					options: ["完全没接触过", "看过教程没动手", "做过小项目", "其他（我自己说）"],
					profile: { goal: "学会一项新技能", level: null, timeBudget: null, preference: null },
				}
			}
			return {
				done: true,
				profile: {
					goal: "学会一项新技能",
					level: "看过教程但没动手",
					timeBudget: "每周 6~10 小时",
					preference: "项目驱动",
					summary: "想入门一项新技能、有自学基础、每周可投入 6~10 小时、偏好项目实战",
				},
				directions: mockDirections(user.id),
			}
		},
	})

	/** 把模型的失败翻译成前端能显示的提示，别让 500 直接糊到用户脸上 */
	const askSafe = async (overrideSystem?: string) => {
		try {
			return await ask(overrideSystem)
		} catch (error) {
			if (error instanceof LlmFormatError) {
				console.warn(`[direction] 格式不合格：${error.message}`)
				throw createError({ statusCode: 502, message: "模型没有按约定给出下一步问题，请重试" })
			}
			const detail = error instanceof Error ? error.message : "未知错误"
			console.error(`[direction] 模型调用失败：${detail}`)
			throw createError({
				statusCode: 502,
				message: "大模型调用失败，请确认 API Key 有效、额度充足后重试",
			})
		}
	}

	let result = await askSafe()

	// 轮次太少：即使模型说结束，也再问一个关键问题
	if (result.data.done && userTurns < MIN_TURNS) {
		const next = followUpFor(result.data.profile)
		result = {
			...result,
			data: { done: false, question: next.question, options: next.options, profile: result.data.profile },
		}
	}

	// 轮次到顶：强制收口，不允许再问
	if (userTurns >= MAX_TURNS && !result.data.done) {
		result = await askSafe(
			`${systemPrompt(catalogText)}\n\n补充要求：现在必须结束提问，直接输出 done=true 与 directions，不允许再问任何问题。`,
		)
		if (!result.data.done) throw createError({ statusCode: 502, message: "模型未能给出方向，请重试" })
	}

	// 画像覆盖不足：本地补问（不再调用模型）
	if (result.data.done) {
		const covered = [result.data.profile.goal, result.data.profile.level, result.data.profile.timeBudget]
			.filter(Boolean).length
		if (covered < 2 && userTurns < MAX_TURNS) {
			const next = followUpFor(result.data.profile)
			result = {
				...result,
				data: { done: false, question: next.question, options: next.options, profile: result.data.profile },
			}
		}
	}

	const turn = userTurns + (result.data.done ? 0 : 1)

	if (!result.data.done) {
		return {
			done: false,
			turn,
			question: result.data.question,
			options: result.data.options,
			profile: result.data.profile,
			mock: result.mock,
			model: result.model,
		}
	}

	const directions = result.data.directions ?? []
	const payload: SelectionPayload = {
		v: 1,
		uid: user.id,
		exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS,
		profile: result.data.profile,
		directions,
	}
	const encoded = encodePayload(payload)

	return {
		done: true,
		turn,
		profile: result.data.profile,
		directions,
		selectionToken: `${encoded}.${sign(encoded, getSessionSecret())}`,
		mock: result.mock,
		model: result.model,
	}
})
