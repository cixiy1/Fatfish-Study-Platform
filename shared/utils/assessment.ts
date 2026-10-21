import type {
	AnswerValue,
	AssessmentQuestion,
	QuestionBlank,
	QuestionField,
	QuestionScale,
} from "#shared/types/assessment"

/**
 * 测评题目的规范化与作答判定。
 *
 * 模型返回的 JSON 不可全信：字段可能缺失、题型可能乱填、填空占位符可能与
 * blanks 数组对不上。这里统一做一次校验与补全，产出的结构再落库与下发，
 * 前端就不必到处写防御代码。
 */

const KINDS = new Set(["single", "multi", "blank", "form", "scale", "text"])

function asText(value: unknown): string {
	return typeof value === "string" ? value.trim() : ""
}

function asTextArray(value: unknown): string[] {
	if (!Array.isArray(value)) return []
	return value
		.filter((item): item is string => typeof item === "string")
		.map((item) => item.trim())
		.filter((item) => item.length > 0)
}

function normalizeOptions(raw: unknown): string[] {
	const options = asTextArray(raw)
	// 2~5 个选项才有区分度；超出说明模型在凑数
	return options.length >= 2 && options.length <= 5 ? options : []
}

function normalizeBlanks(raw: unknown): QuestionBlank[] {
	if (!Array.isArray(raw)) return []
	return raw.slice(0, 4).map((item) => {
		const r = (item ?? {}) as Record<string, unknown>
		return {
			label: asText(r.label) || undefined,
			placeholder: asText(r.placeholder) || undefined,
		}
	})
}

function normalizeFields(raw: unknown): QuestionField[] {
	if (!Array.isArray(raw)) return []
	const fields: QuestionField[] = []
	raw.slice(0, 4).forEach((item, i) => {
		const r = (item ?? {}) as Record<string, unknown>
		const label = asText(r.label)
		if (!label) return
		const type = asText(r.type)
		const kind: QuestionField["type"] = type === "number" || type === "select" ? type : "text"
		const options = kind === "select" ? asTextArray(r.options).slice(0, 8) : []
		// 下拉但没有选项 → 退化成文本，否则前端渲染出一个空下拉
		if (kind === "select" && options.length === 0) {
			fields.push({
				key: asText(r.key) || `f${i + 1}`,
				label,
				type: "text",
				placeholder: asText(r.placeholder) || undefined,
				unit: asText(r.unit) || undefined,
				required: r.required !== false,
			})
			return
		}
		fields.push({
			key: asText(r.key) || `f${i + 1}`,
			label,
			type: kind,
			options: options.length > 0 ? options : undefined,
			placeholder: asText(r.placeholder) || undefined,
			unit: asText(r.unit) || undefined,
			required: r.required !== false,
		})
	})
	return fields
}

function normalizeScale(raw: unknown): QuestionScale {
	const r = (raw ?? {}) as Record<string, unknown>
	const min = Number(r.min)
	const max = Number(r.max)
	const lo = Number.isFinite(min) ? Math.max(0, Math.min(1, Math.trunc(min))) : 1
	const hi = Number.isFinite(max) ? Math.max(lo + 2, Math.min(7, Math.trunc(max))) : 5
	return {
		min: lo,
		max: hi,
		minLabel: asText(r.minLabel) || "完全没接触",
		maxLabel: asText(r.maxLabel) || "能独立完成",
	}
}

/** 题干里 `[[1]]` 这种占位的数量 */
export function countBlankSlots(question: string): number {
	return (question.match(/\[\[\d+\]\]/g) ?? []).length
}

/**
 * 把模型返回的任意 JSON 项规范化成一道题。
 *
 * 返回 null 表示这道题不可用（缺题干、选项不够、表单没字段……），
 * 由调用方丢弃——宁可少一题，也不要给前端一个渲染不出控件的题。
 */
export function normalizeQuestion(raw: unknown): AssessmentQuestion | null {
	if (!raw || typeof raw !== "object") return null
	const r = raw as Record<string, unknown>

	const question = asText(r.question)
	if (question.length < 4) return null

	const category = asText(r.category) || "综合"
	const hint = asText(r.hint) || undefined
	const declared = asText(r.kind) || asText(r.type)
	let kind = (KINDS.has(declared) ? declared : "") as AssessmentQuestion["kind"] | ""

	const options = normalizeOptions(r.options)

	// 模型常把「多选」写成选项题但 kind 缺失：有选项默认按单选处理
	if (!kind) {
		kind = options.length > 0 ? "single" : "text"
	}

	if (kind === "single" || kind === "multi") {
		if (options.length === 0) return null
		return { kind, question, options, category, hint }
	}

	if (kind === "blank") {
		const slots = countBlankSlots(question)
		const declaredBlanks = normalizeBlanks(r.blanks)
		// 以题干占位数为准，其次看 blanks 数组，都没有就补一个空
		const count = Math.min(Math.max(slots, declaredBlanks.length, 1), 4)
		const blanks = Array.from({ length: count }, (_, i) => declaredBlanks[i] ?? {})
		return { kind, question, blanks, category, hint }
	}

	if (kind === "form") {
		const fields = normalizeFields(r.fields)
		if (fields.length === 0) return null
		return { kind, question, fields, category, hint }
	}

	if (kind === "scale") {
		return { kind, question, scale: normalizeScale(r.scale), category, hint }
	}

	return {
		kind: "text",
		question,
		placeholder: asText(r.placeholder) || undefined,
		category,
		hint,
	}
}

/** 批量规范化；不可用的题直接丢弃 */
export function normalizeQuestions(raw: unknown): AssessmentQuestion[] {
	if (!Array.isArray(raw)) return []
	const out: AssessmentQuestion[] = []
	for (const item of raw) {
		const q = normalizeQuestion(item)
		if (q) out.push(q)
	}
	return out
}

/** 新建一份空作答（按题型给出正确的容器） */
export function emptyAnswer(question: AssessmentQuestion): AnswerValue {
	switch (question.kind) {
		case "single":
		case "scale":
			return null
		case "multi":
			return []
		case "blank":
			return new Array(question.blanks?.length ?? 1).fill("")
		case "form": {
			const record: Record<string, string> = {}
			for (const field of question.fields ?? []) record[field.key] = ""
			return record
		}
		default:
			return ""
	}
}

/**
 * 是否算「已作答」。
 *
 * 单选题必须选了（0 是合法下标，所以用 null 而不是 -1 表示未答）；
 * 多选题至少一项；填空题至少一个空有内容；表单看必填字段；
 * 开放题只要不是空白即可——开放题也允许跳过，由调用方决定是否强制。
 */
export function isAnswered(question: AssessmentQuestion, answer: AnswerValue): boolean {
	switch (question.kind) {
		case "single":
		case "scale":
			return typeof answer === "number" && Number.isFinite(answer)
		case "multi":
			return Array.isArray(answer) && answer.length > 0
		case "blank":
			return Array.isArray(answer) && answer.some((v) => String(v ?? "").trim().length > 0)
		case "form": {
			if (!answer || typeof answer !== "object" || Array.isArray(answer)) return false
			const record = answer as Record<string, string>
			const required = (question.fields ?? []).filter((f) => f.required !== false)
			// 没有必填字段时，只要任意一项有内容就算作答
			if (required.length === 0) {
				return Object.values(record).some((v) => String(v ?? "").trim().length > 0)
			}
			return required.every((f) => String(record[f.key] ?? "").trim().length > 0)
		}
		case "text":
			return typeof answer === "string" && answer.trim().length > 0
		default:
			return false
	}
}

/** 统计已作答题数 */
export function countAnswered(questions: AssessmentQuestion[], answers: AnswerValue[]): number {
	return questions.reduce((sum, q, i) => sum + (isAnswered(q, answers[i] ?? null) ? 1 : 0), 0)
}

/**
 * 把一题的作答转成给模型看的自然语言。
 *
 * 分析阶段不再只给「选项文本」，而是按题型描述：
 * 填空写「第 1 空：xxx」，表单写「每周时长：5 小时」，量表写「4/5（偏向能独立完成）」。
 */
export function describeAnswer(question: AssessmentQuestion, answer: AnswerValue): string {
	if (!isAnswered(question, answer)) return "未作答"

	switch (question.kind) {
		case "single": {
			const index = answer as number
			return question.options?.[index] ?? `选项 ${index + 1}`
		}
		case "multi": {
			const picked = (answer as number[])
				.map((index) => question.options?.[index])
				.filter((text): text is string => Boolean(text))
			return picked.length > 0 ? picked.join("；") : "未作答"
		}
		case "blank": {
			const values = answer as string[]
			return values
				.map((value, i) => {
					const label = question.blanks?.[i]?.label ?? `第 ${i + 1} 空`
					return `${label}：${value || "（空）"}`
				})
				.join("；")
		}
		case "form": {
			const record = answer as Record<string, string>
			return (question.fields ?? [])
				.map((field) => {
					const value = String(record[field.key] ?? "").trim() || "（未填）"
					return `${field.label}：${value}${field.unit && value !== "（未填）" ? field.unit : ""}`
				})
				.join("；")
		}
		case "scale": {
			const scale = question.scale ?? { min: 1, max: 5, minLabel: "", maxLabel: "" }
			const value = answer as number
			// 位置描述帮助模型理解「3 分」在量表里意味着什么
			const span = scale.max - scale.min || 1
			const ratio = (value - scale.min) / span
			const position = ratio <= 0.25 ? "偏「" + scale.minLabel + "」" : ratio >= 0.75 ? "偏「" + scale.maxLabel + "」" : "居中"
			return `${value}/${scale.max}（${position}）`
		}
		case "text":
			return String(answer).trim()
		default:
			return "未作答"
	}
}
