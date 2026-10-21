/**
 * 学习方向访谈相关的共享类型（服务端与前端共用）。
 */

import type { AssessmentQuestion } from "#shared/types/assessment"

/** 目录外的新技能点（学习平台不限定领域，模型可以现场提出） */
export interface DirectionNewSkill {
	name: string
	/** 建议掌握等级 1-3 */
	level: number
}

/** 模型给出的方向候选 */
export interface DirectionCandidate {
	name: string
	category: string
	reason: string
	/** 0-100 */
	matchScore: number
	skillIds: number[]
	/** skillId -> 建议掌握等级 */
	skillLevels: Record<string, number>
	/** 技能库里没有、需要落库的新技能点 */
	newSkills?: DirectionNewSkill[]
	/** 供前端预览的技能名（库内技能 + 新技能，最多 6 个） */
	previewSkills?: string[]
	estimatedWeeks: number
}

/** 访谈过程中逐步补齐的画像 */
export interface DirectionProfile {
	goal: string | null
	level: string | null
	timeBudget: string | null
	preference: string | null
	summary?: string
}

/** 一轮对话的消息（前端存的草稿也是这个结构） */
export interface DirectionMessage {
	role: "user" | "assistant"
	content: string
}

export interface DirectionInterviewResponse {
	/** 信息是否已足够，true 时带 directions 与 selectionToken */
	done: boolean
	/** 已经问过几轮 */
	turn: number
	/** 本轮的题目（多题型：单选/多选/填空/表单/自评/开放） */
	ask?: AssessmentQuestion
	/** 题干纯文本（已去掉 [[n]] 空位标记），写进对话记录用 */
	question?: string
	/** 兼容旧前端：仅单/多选题有值 */
	options?: string[]
	profile: DirectionProfile
	directions?: DirectionCandidate[]
	/** 选定方向时回传给 /api/direction/select，服务端验签防伪造 */
	selectionToken?: string
	mock: boolean
	model: string
}

export interface DirectionSelectResponse {
	positionId: number
	name: string
	skillCount: number
	/** 命中了已有岗位（种子或之前生成的同方向） */
	reused: boolean
}
