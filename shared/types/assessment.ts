/**
 * 能力测评的题型与作答结构。
 *
 * 早期只有「单选」一种形式（question + options + answers: number[]），
 * 但真实测评需要多种交互：多选、填空、表单、自评量表、开放题。
 * 这里定义统一结构，服务端出题/分析、前端渲染三处共用，避免各写一套。
 */

/** 题型 */
export type QuestionKind =
	/** 单选：点一个选项 */
	| "single"
	/** 多选：可点多个选项 */
	| "multi"
	/** 填空：题干里用 [[1]] [[2]] 占位，内联输入 */
	| "blank"
	/** 表单：多个字段（文本/数字/下拉），适合填学习背景、工具、时长 */
	| "form"
	/** 自评量表：1~5 分滑块式选择，带两端语义 */
	| "scale"
	/** 开放题：一段自由文本 */
	| "text"

/** 填空题的一个空 */
export interface QuestionBlank {
	label?: string
	placeholder?: string
}

/** 表单字段 */
export interface QuestionField {
	key: string
	label: string
	type: "text" | "number" | "select"
	options?: string[]
	placeholder?: string
	unit?: string
	required?: boolean
}

/** 自评量表的刻度说明 */
export interface QuestionScale {
	min: number
	max: number
	minLabel: string
	maxLabel: string
}

/** 一道题（从模型返回、落库、下发前端都用这个结构） */
export interface AssessmentQuestion {
	kind: QuestionKind
	/** 题干；blank 题里用 [[1]] [[2]] 表示挖空位置 */
	question: string
	/** single / multi 的选项 */
	options?: string[]
	/** blank 的空位描述 */
	blanks?: QuestionBlank[]
	/** form 的字段 */
	fields?: QuestionField[]
	/** scale 的刻度 */
	scale?: QuestionScale
	/** text 的占位提示 */
	placeholder?: string
	/** 出题意图提示（一句话，例如「考察你是否真的用过 Flex 布局」） */
	hint?: string
	category: string
}

/**
 * 单题作答值。
 *
 * - single / scale → number
 * - multi          → number[]（选中项下标）
 * - blank          → string[]（每个空一个）
 * - form           → Record<string, string>
 * - text           → string
 */
export type AnswerValue = number | number[] | string[] | Record<string, string> | string | null

/** 题型的中文名，界面与提示词共用，避免两处文案不一致 */
export const QUESTION_KIND_LABEL: Record<QuestionKind, string> = {
	single: "单选",
	multi: "多选",
	blank: "填空",
	form: "表单",
	scale: "自评",
	text: "开放题",
}

/** 题型图标（lucide 名） */
export const QUESTION_KIND_ICON: Record<QuestionKind, string> = {
	single: "i-lucide-circle-dot",
	multi: "i-lucide-list-checks",
	blank: "i-lucide-pen-line",
	form: "i-lucide-clipboard-list",
	scale: "i-lucide-sliders-horizontal",
	text: "i-lucide-message-square-text",
}
