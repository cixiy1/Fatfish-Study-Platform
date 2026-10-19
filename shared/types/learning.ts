/** 岗位 */
export interface Position {
	id: number
	name: string
	category: string
	description: string | null
	icon: string | null
}

/** 技能节点 */
export interface Skill {
	id: number
	name: string
	category: string
	parent_id: number | null
	level: number
	description: string | null
}

/** 岗位技能要求 */
export interface PositionSkill {
	position_id: number
	skill_id: number
	required_level: number
}

/** 用户技能掌握状态 */
export interface UserSkill {
	user_id: number
	skill_id: number
	status: "mastered" | "learning" | "not_started"
	self_assessed_level: number
}

/** 测评 */
export interface Assessment {
	id: number
	type: "career" | "skill" | "stage"
	title: string
	description: string | null
}

/** 测评题目 */
export interface AssessmentQuestion {
	id: number
	assessment_id: number
	question: string
	options: string[]
	correct_index: number | null
	category: string | null
	sort_order: number
}

/** 测评记录 */
export interface AssessmentRecord {
	id: number
	user_id: number
	assessment_id: number
	answers: number[]
	score: number
	result_data: string | null
	created_at: string
}

/** 用户画像 */
export interface UserProfile {
	user_id: number
	age: number | null
	education: string | null
	profession: string | null
	experience_years: number | null
	learning_goal: string | null
	career_direction: string | null
	assessment_completed: number
	profile_data: string | null
}

/** 学习资源 */
export interface LearningResource {
	id: number
	title: string
	type: "article" | "video" | "course" | "practice"
	url: string | null
	skill_id: number | null
	difficulty: "beginner" | "intermediate" | "advanced"
	description: string | null
	duration: number | null
}

/** 学习路径 */
export interface LearningPath {
	id: number
	user_id: number
	name: string
	target_position_id: number | null
	status: "active" | "completed" | "archived"
	created_at: string
	updated_at: string
}

/** 学习路径项 */
export interface LearningPathItem {
	id: number
	path_id: number
	skill_id: number | null
	resource_id: number | null
	sort_order: number
	status: "pending" | "in_progress" | "completed"
	started_at: string | null
	completed_at: string | null
}

/** 问答记录 */
export interface QARecord {
	id: number
	user_id: number
	question: string
	answer: string | null
	context: string | null
	created_at: string
}

/** 学习报告 */
export interface LearningReport {
	id: number
	user_id: number
	type: string
	period_start: string | null
	period_end: string | null
	summary: string | null
	created_at: string
}
