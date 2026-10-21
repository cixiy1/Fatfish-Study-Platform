import type {
	DirectionCandidate,
	DirectionMessage,
	DirectionProfile,
} from "#shared/types/direction"
import type { AssessmentQuestion } from "#shared/types/assessment"
import { normalizeQuestion, plainQuestion } from "#shared/utils/assessment"
import { findAllPositions, findAllSkills, findSkillsByPosition } from "../repositories/learning.repository"
import { encodePayload, sign } from "./crypto"
import type { DirectionCatalog } from "./direction-normalize"
import { normalizeDirections, skillKey } from "./direction-normalize"
import type { LlmMessage } from "./llm"
import { asRecord, LlmFormatError } from "./llm-json"
import { getSessionSecret } from "./session"

/**
 * 方向访谈的共用逻辑。
 *
 * 同一套提问规则要供两个入口使用：
 * - `interview.post.ts`：一次性返回 JSON，兼容旧前端与自动化测试
 * - `interview.stream.post.ts`：SSE 逐字吐出题干，避免用户盯着一个转圈等
 * 提示词、题型兜底、轮次兜底、选择令牌都在这里，避免两处实现慢慢漂移。
 */

export const MIN_TURNS = 2
export const MAX_TURNS = 5
const MAX_HISTORY = 8
const TOKEN_TTL_SECONDS = 30 * 60

export interface ModelTurn {
	done: boolean
	/** 结构化题目：题型由模型按信息类型挑 */
	ask?: AssessmentQuestion
	/** 题干纯文本（兼容旧协议，前端写对话记录用） */
	question?: string
	options?: string[]
	profile: DirectionProfile
	directions?: DirectionCandidate[]
}

export interface SelectionPayload {
	v: 1
	uid: number
	exp: number
	profile: DirectionProfile
	directions: DirectionCandidate[]
}

export function optionalStr(value: unknown, max = 120): string | null {
	if (typeof value !== "string") return null
	const trimmed = value.trim()
	return trimmed ? trimmed.slice(0, max) : null
}

export function buildCatalog(): { text: string, catalog: DirectionCatalog } {
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

export function systemPrompt(catalogText: string): string {
	return `你是学习顾问，正在帮一名学习者规划「任何他想学的东西」——不限编程，语言、乐器、设计、烹饪、考证、专业课、职场技能都可以。

规则：
1. 每轮只问一个最关键的问题。题型从下面六种里挑最合适的一种，不要每轮都用单选：
   - single 单选：互斥的类别或程度，2~4 个短选项（每个不超过 14 字）
   - multi 多选：可以同时成立的偏好、习惯、工具，3~5 个短选项
   - blank 填空：只缺一两个具体名词或数字，题干里用 [[1]] [[2]] 标出空位，最多 3 个空
   - form 表单：要同时收集 1~3 个字段时（如每周时长、可学习时段、目标日期），字段支持 text / number / select
   - scale 自评：让学习者给自己打分（当前基础、信心程度），给两端语义
   - text 开放题：需要一段描述（想学什么、想解决什么问题）
2. 题型要和信息匹配：想学什么 → text 或 single；当前基础 → scale；每周/每天可投入时间 → form（number 字段带 unit）；学习偏好、习惯、设备 → multi；考试名称、证书、专业、目标岗位、截止日期这类具体名词 → blank；目标节点 → form 或 single。form 的字段名和 select 选项必须贴合当轮问题，不要照抄示例（「早晨/午休/晚上」只在真的问学习时段时用）。
3. 不要连续两轮用同一题型；对话超过两轮后，form、scale、multi 应至少各出现一次。
4. 不要重复问已经问过的事。
5. 不要给「其他（我自己说）」这类兜底选项，界面另有无障碍的自由输入。
6. 收口前尽量凑齐四类信息：想学什么、当前基础、每周可投入时间、学习偏好（偏好用 multi 问）。至少问满 3 轮再结束，最多 5 轮；不要问两个选项题就急着给方向。
7. 用户想学的东西可以不在下方技能目录里，照常给出方向，不要拒绝、不要劝他换方向。
8. 每个方向的技能点按"从入门到能做出来"的学习顺序排列，3~8 个，要具体可检验（写"用过去时讲昨天做了什么"，不要写"掌握语法"）。
9. 技能点优先复用下方目录里已有的（填 skillIds）；目录里没有的，用 newSkills 给名称（每条 2~20 字，可带 level 1-3）。
10. category 用简短领域词（如 语言、前端、设计、商科、生活），不必受目录分类限制。
11. 只输出 JSON，不要解释，不要 Markdown 代码块。

未问完时输出（ask 里只写当前题型需要的字段，category 用信息类别如 目标/基础/时间/偏好）：
{"done":false,"ask":{"kind":"scale","question":"你现在的基础大概在哪个位置？","scale":{"min":1,"max":5,"minLabel":"完全没接触","maxLabel":"能独立做出东西"},"category":"基础","hint":"凭感觉选就行，不影响后面的难度"},"profile":{"goal":null,"level":null,"timeBudget":null,"preference":null}}

其它题型的写法（按需选用，不要照抄题目）：
{"kind":"single","question":"你更想先解决哪一类问题？","options":["能看懂别人写的东西","自己能从头做出来","能改别人的东西"],"category":"目标"}
{"kind":"multi","question":"你平时更习惯怎么学？","options":["看视频跟练","读文档打基础","边做项目边学","刷题巩固"],"category":"偏好"}
{"kind":"form","question":"排节奏之前，先确认两件事","fields":[{"key":"hours","label":"每周能稳定投入","type":"number","unit":"小时","placeholder":"例如 6"},{"key":"slot","label":"通常什么时候学","type":"select","options":["早晨","午休","晚上","不固定"]}],"category":"时间"}
{"kind":"blank","question":"你打算考的是 [[1]]，目标在 [[2]] 前拿下？","blanks":[{"label":"考试名称","placeholder":"例如 教资笔试"},{"label":"时间","placeholder":"例如 明年 3 月"}],"category":"目标"}
{"kind":"text","question":"具体想学什么？说说你希望学完能做成什么事。","placeholder":"例如：半年内能用 Python 处理工作里的表格","category":"目标"}

问完时输出：
{"done":true,"profile":{"goal":"...","level":"...","timeBudget":"...","preference":"...","summary":"一句话画像"},"directions":[{"name":"方向名","category":"语言","reason":"为什么这样安排，40字内","matchScore":85,"skillIds":[1,2],"newSkills":[{"name":"五十音与发音","level":1},{"name":"动词变形","level":2}],"skillLevels":{"1":1},"estimatedWeeks":10}]}

directions 给 1~3 个，按匹配度从高到低；estimatedWeeks 取 4~24。

下面是技能库里已有的技能（id [分类] 名称 —— 描述），能复用就复用：
${catalogText}`
}

/** 轮次到顶时必须收口，追加这段要求 */
export function forceDonePrompt(catalogText: string): string {
	return `${systemPrompt(catalogText)}

补充要求：现在必须结束提问，直接输出 done=true 与 directions，不允许再问任何问题。`
}

/** 本轮对话要发给模型的消息 */
export function buildMessages(history: DirectionMessage[], catalogText: string, forceDone = false): LlmMessage[] {
	return [
		{
			role: "system",
			content: forceDone ? forceDonePrompt(catalogText) : systemPrompt(catalogText),
		},
		{
			role: "user",
			content: `对话记录：\n${buildTranscript(history)}\n\n现在请给出下一步，严格输出 JSON。`,
		},
	]
}

/** 把历史对话转成一段纯文本记录，避免不同协议对 role 顺序的要求差异 */
export function buildTranscript(history: DirectionMessage[]): string {
	if (history.length === 0) return "（对话还没开始）"
	return history
		.map((message) => `${message.role === "user" ? "学习者" : "顾问"}：${message.content}`)
		.join("\n")
}

export function sanitizeHistory(input: unknown): DirectionMessage[] {
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

export function countUserTurns(history: DirectionMessage[]): number {
	return history.filter((message) => message.role === "user").length
}

/**
 * 把模型的输出解析成一道可渲染的题。
 *
 * 新协议是结构化 ask；老协议（question + options）也认，避免模型偶尔退回旧格式
 * 时整轮报错——访谈卡住比题型退化更糟。
 */
export function resolveAsk(record: Record<string, unknown>): AssessmentQuestion {
	const structured = normalizeQuestion(record.ask)
	if (structured) return structured

	const options = Array.isArray(record.options) ? record.options : []
	const legacy = normalizeQuestion({
		kind: options.length >= 2 ? "single" : "text",
		question: record.question,
		options,
		category: "目标",
	})
	if (legacy) return legacy

	throw new LlmFormatError("ask 为空或字段不完整")
}

/** 把题目包成「还没问完」那一轮的响应 */
export function askTurn(ask: AssessmentQuestion, profile: DirectionProfile): ModelTurn {
	return {
		done: false,
		ask,
		question: plainQuestion(ask),
		options: ask.kind === "single" || ask.kind === "multi" ? ask.options ?? [] : [],
		profile,
	}
}

/** 本地追问：模型已经说 done 但信息不足时用，避免再多一次调用 */
export function followUpFor(profile: DirectionProfile): AssessmentQuestion {
	if (!profile.level) {
		return {
			kind: "scale",
			question: "你在这个方向上目前的基础大概到哪一步？",
			scale: { min: 1, max: 5, minLabel: "完全没接触", maxLabel: "能独立做出东西" },
			category: "基础",
			hint: "凭感觉选就行，这只影响起点，不影响最终目标",
		}
	}
	if (!profile.timeBudget) {
		return {
			kind: "form",
			question: "安排节奏前，先确认你的时间",
			fields: [
				{ key: "hours", label: "每周能稳定投入", type: "number", unit: "小时", placeholder: "例如 6", required: true },
				{
					key: "slot",
					label: "通常什么时候学",
					type: "select",
					options: ["早晨", "午休", "晚上", "不固定"],
					required: false,
				},
			],
			category: "时间",
		}
	}
	if (!profile.goal) {
		return {
			kind: "single",
			question: "你学这个主要想解决什么？",
			options: ["学完能上手做", "为考试或证书", "单纯感兴趣", "补一门专业课"],
			category: "目标",
		}
	}
	return {
		kind: "multi",
		question: "你更喜欢哪些学习方式？可以多选",
		options: ["看视频跟练", "读文档打基础", "边做项目边学", "刷题巩固"],
		category: "偏好",
	}
}

/** 演示模式的方向：直接复用已有岗位，保证没配 key 也能走完流程 */
export function mockDirections(userId: number): DirectionCandidate[] {
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

/** 校验模型返回的这一步：题目或方向二选一 */
export function validateTurn(payload: unknown, catalog: DirectionCatalog): ModelTurn {
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
	if (!done) return askTurn(resolveAsk(record), profile)

	return { done: true, profile, directions: normalizeDirections(record.directions, catalog) }
}

/**
 * 从「还没写完的 JSON」里读出 ask.question 的当前值。
 *
 * 流式展示要求模型一边写、界面一边长字，但模型吐的是 JSON 而不是纯文本：
 * 直接把原始 chunk 丢给前端，用户会看到 `{"done":false,"ask":{"kind":...` 这种东西。
 * 这里只把 question 字段的字符串值取出来，并容忍转义写到一半、unicode 只写了几位。
 */
export function readPartialQuestion(text: string): string {
	const match = /"question"\s*:\s*"/.exec(text)
	if (!match) return ""

	let index = match.index + match[0].length
	let out = ""
	let escaped = false
	let unicode = ""

	while (index < text.length) {
		const char = text[index]

		if (unicode) {
			unicode += char
			if (unicode.length === 6) {
				const code = Number.parseInt(unicode.slice(2), 16)
				if (Number.isFinite(code)) out += String.fromCharCode(code)
				unicode = ""
			}
			index++
			continue
		}

		if (escaped) {
			if (char === "u") {
				unicode = "\\u"
			} else if (char === "n" || char === "t" || char === "r") {
				out += " "
			} else {
				out += char
			}
			escaped = false
			index++
			continue
		}

		if (char === "\\") {
			escaped = true
			index++
			continue
		}
		// 字符串结束：后面的内容不再是题干
		if (char === "\"") break

		out += char
		index++
	}

	return out.trimEnd()
}

/** 生成本轮的结果：模型说完了但信息不够时，本地补一个问题 */export function settleTurn(turn: ModelTurn, userTurns: number): ModelTurn {
	if (!turn.done) return turn
	if (userTurns < MIN_TURNS) return askTurn(followUpFor(turn.profile), turn.profile)

	const covered = [turn.profile.goal, turn.profile.level, turn.profile.timeBudget].filter(Boolean).length
	if (covered < 2 && userTurns < MAX_TURNS) {
		return askTurn(followUpFor(turn.profile), turn.profile)
	}
	return turn
}

/** 选定方向时回传给 /api/direction/select 的签名令牌，防止前端伪造方向 */
export function signSelection(
	userId: number,
	profile: DirectionProfile,
	directions: DirectionCandidate[],
): string {
	const payload: SelectionPayload = {
		v: 1,
		uid: userId,
		exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS,
		profile,
		directions,
	}
	const encoded = encodePayload(payload)
	return `${encoded}.${sign(encoded, getSessionSecret())}`
}
