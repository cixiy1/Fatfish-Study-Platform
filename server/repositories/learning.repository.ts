import { getDb } from "../utils/db"

/**
 * 学习平台数据访问层。
 *
 * 涵盖岗位、技能图谱、测评、学习路径、问答、报告。
 */

// --- 岗位 ---

export function findAllPositions(userId: number | null = null): { id: number, name: string, category: string, description: string | null, icon: string | null, skill_count: number }[] {
	// 种子岗位（owner_user_id IS NULL）所有人可见；AI 生成的方向只有本人可见，且草稿态不展示
	return getDb()
		.prepare(`
			SELECT p.*, COUNT(ps.skill_id) AS skill_count
			FROM positions p
			LEFT JOIN position_skills ps ON ps.position_id = p.id
			WHERE p.status <> 'archived'
			  AND (p.owner_user_id IS NULL OR p.owner_user_id = ?)
			GROUP BY p.id
			ORDER BY p.category, p.id
		`)
		.all(userId) as { id: number, name: string, category: string, description: string | null, icon: string | null, skill_count: number }[]
}

export function findPositionById(id: number): { id: number, name: string, category: string, description: string | null, icon: string | null, source: string, status: string, owner_user_id: number | null } | null {
	return (getDb().prepare("SELECT * FROM positions WHERE id = ?").get(id) as {
		id: number
		name: string
		category: string
		description: string | null
		icon: string | null
		source: string
		status: string
		owner_user_id: number | null
	} | undefined) ?? null
}

/** 按名称查重：优先命中种子岗位，其次命中本人的 AI 岗位 */
export function findPositionByName(name: string, userId: number | null = null): { id: number, name: string, source: string, owner_user_id: number | null } | null {
	return (getDb()
		.prepare(`
			SELECT id, name, source, owner_user_id FROM positions
			WHERE name = ? AND (owner_user_id IS NULL OR owner_user_id = ?)
			ORDER BY owner_user_id IS NOT NULL, id
			LIMIT 1
		`)
		.get(name, userId) as { id: number, name: string, source: string, owner_user_id: number | null } | undefined) ?? null
}

/** 创建 AI 生成的方向（草稿态，生成路径后转 active） */
export function createAiPosition(input: {
	userId: number
	name: string
	category: string
	description: string | null
	icon: string | null
}): number {
	return Number(getDb()
		.prepare(`
			INSERT INTO positions (name, category, description, icon, owner_user_id, source, status, generated_at)
			VALUES (?, ?, ?, ?, ?, 'ai', 'draft', datetime('now'))
		`)
		.run(input.name, input.category, input.description, input.icon, input.userId).lastInsertRowid)
}

/** 写入岗位技能（AI 方向按模型给出的顺序） */
export function addPositionSkill(positionId: number, skillId: number, requiredLevel = 1, sortOrder = 0): void {
	getDb()
		.prepare(`
			INSERT INTO position_skills (position_id, skill_id, required_level, sort_order)
			VALUES (?, ?, ?, ?)
			ON CONFLICT(position_id, skill_id) DO UPDATE SET
				required_level = excluded.required_level,
				sort_order = excluded.sort_order
		`)
		.run(positionId, skillId, requiredLevel, sortOrder)
}

export function updatePositionStatus(positionId: number, status: string): void {
	getDb().prepare("UPDATE positions SET status = ? WHERE id = ?").run(status, positionId)
}

/**
 * 用户「正在学」的方向：以 learning_paths 为准（有路径说明真的在学），
 * 每个方向取最新一条路径，带上关卡进度。
 *
 * 能力测评的方向选择器用它——不能用 findAllPositions，
 * 那会把全站种子岗位都列出来，等于让用户去测评没学过的方向。
 */
export function findStudyPositions(userId: number): {
	id: number
	name: string
	category: string
	description: string | null
	icon: string | null
	path_id: number
	generation_status: string
	item_count: number
	completed_count: number
	updated_at: string
}[] {
	return getDb()
		.prepare(`
			SELECT p.id, p.name, p.category, p.description, p.icon,
			       lp.id AS path_id, lp.generation_status, lp.updated_at,
			       COUNT(lpi.id) AS item_count,
			       SUM(CASE WHEN lpi.status = 'completed' THEN 1 ELSE 0 END) AS completed_count
			FROM positions p
			JOIN learning_paths lp ON lp.id = (
				SELECT x.id FROM learning_paths x
				WHERE x.user_id = ? AND x.target_position_id = p.id AND x.status <> 'archived'
				ORDER BY x.updated_at DESC, x.id DESC
				LIMIT 1
			)
			LEFT JOIN learning_path_items lpi ON lpi.path_id = lp.id
			WHERE p.status <> 'archived'
			GROUP BY p.id, lp.id
			ORDER BY lp.updated_at DESC, p.id
		`)
		.all(userId) as {
			id: number
			name: string
			category: string
			description: string | null
			icon: string | null
			path_id: number
			generation_status: string
			item_count: number
			completed_count: number
			updated_at: string
		}[]
}

// --- 技能 ---

/** 从方向上摘掉一个技能（只解绑，不删技能本身——它可能还挂在别的方向/路径上） */
export function removePositionSkill(positionId: number, skillId: number): boolean {
	return getDb()
		.prepare("DELETE FROM position_skills WHERE position_id = ? AND skill_id = ?")
		.run(positionId, skillId).changes > 0
}

/** 只改排序（演进里的 reorder），不动 required_level */
export function updatePositionSkillOrder(positionId: number, skillId: number, sortOrder: number): void {
	getDb()
		.prepare("UPDATE position_skills SET sort_order = ? WHERE position_id = ? AND skill_id = ?")
		.run(sortOrder, positionId, skillId)
}

export function findAllSkills(): { id: number, name: string, category: string, parent_id: number | null, level: number, description: string | null }[] {
	return getDb()
		.prepare("SELECT * FROM skills ORDER BY category, level, id")
		.all() as { id: number, name: string, category: string, parent_id: number | null, level: number, description: string | null }[]
}

export function findSkillsByPosition(positionId: number): { id: number, name: string, category: string, parent_id: number | null, level: number, description: string | null, required_level: number }[] {
	return getDb()
		.prepare(`
			SELECT s.*, ps.required_level
			FROM skills s
			JOIN position_skills ps ON ps.skill_id = s.id
			WHERE ps.position_id = ?
			ORDER BY ps.sort_order, s.id
		`)
		.all(positionId) as { id: number, name: string, category: string, parent_id: number | null, level: number, description: string | null, required_level: number }[]
}

/** 按名称找技能（大小写不敏感）；用于「模型给的技能名，库里已经有了就复用」 */
export function findSkillByName(name: string): { id: number, name: string, category: string, parent_id: number | null, level: number, description: string | null } | null {
	const row = getDb()
		.prepare("SELECT * FROM skills WHERE name = ? COLLATE NOCASE LIMIT 1")
		.get(name.trim()) as { id: number, name: string, category: string, parent_id: number | null, level: number, description: string | null } | undefined
	return row ?? null
}

/**
 * 新建技能（学习平台不限定领域，模型可以提出任何主题的技能点）。
 * `skills.name` 没有 UNIQUE 约束，所以调用方要先 findSkillByName 去重。
 */
export function createSkill(input: {
	name: string
	category: string
	level?: number
	description?: string | null
	parentId?: number | null
}): number {
	return Number(
		getDb()
			.prepare("INSERT INTO skills (name, category, level, description, parent_id) VALUES (?, ?, ?, ?, ?)")
			.run(input.name, input.category, input.level ?? 1, input.description ?? null, input.parentId ?? null)
			.lastInsertRowid,
	)
}

// --- 用户技能 ---

export function findUserSkills(userId: number): { skill_id: number, status: string, self_assessed_level: number }[] {
	return getDb()
		.prepare("SELECT skill_id, status, self_assessed_level FROM user_skills WHERE user_id = ?")
		.all(userId) as { skill_id: number, status: string, self_assessed_level: number }[]
}

export function upsertUserSkill(userId: number, skillId: number, status: string, level: number): void {
	getDb()
		.prepare(`
			INSERT INTO user_skills (user_id, skill_id, status, self_assessed_level, updated_at)
			VALUES (?, ?, ?, ?, datetime('now'))
			ON CONFLICT(user_id, skill_id) DO UPDATE SET
				status = excluded.status,
				self_assessed_level = excluded.self_assessed_level,
				updated_at = datetime('now')
		`)
		.run(userId, skillId, status, level)
}

// --- 测评 ---

export function findAssessmentByType(type: string): { id: number, type: string, title: string, description: string | null } | null {
	return (getDb().prepare("SELECT * FROM assessments WHERE type = ?").get(type) as { id: number, type: string, title: string, description: string | null } | undefined) ?? null
}

/**
 * 取种子题库（owner_user_id IS NULL）。
 *
 * 语义固定为「系统预置题」；用户专属的动态题必须用 findQuestionsByBatch 取，
 * 两者不能混——此前 analyze 拿种子题去配对动态答案，题目和答案会错位。
 */
export function findAssessmentQuestions(assessmentId: number): { id: number, question: string, options: string[], correct_index: number | null, category: string | null, sort_order: number }[] {
	const rows = getDb()
		.prepare("SELECT * FROM assessment_questions WHERE assessment_id = ? AND owner_user_id IS NULL ORDER BY sort_order")
		.all(assessmentId) as { id: number, question: string, options: string, correct_index: number | null, category: string | null, sort_order: number }[]
	return rows.map((r) => ({ ...r, options: JSON.parse(r.options) as string[] }))
}

/**
 * 落库一次动态出题结果。
 *
 * 模型出的题此前从不入库，导致分析时只能拿种子题去对答案，
 * 题数不一致会直接 400，题数碰巧一致则题目与答案错位。
 * 现在按 batch_id 存一批，分析时原样取回。
 */
export function insertDynamicQuestions(input: {
	assessmentId: number
	userId: number
	batchId: string
	positionId?: number | null
	questions: { question: string, options: string[], category?: string }[]
}): void {
	const stmt = getDb().prepare(
		`INSERT INTO assessment_questions
		 (assessment_id, question, options, correct_index, category, sort_order, owner_user_id, batch_id, source, position_id)
		 VALUES (?, ?, ?, NULL, ?, ?, ?, ?, 'ai', ?)`,
	)
	const run = getDb().transaction(() => {
		input.questions.forEach((q, index) => {
			stmt.run(
				input.assessmentId,
				q.question,
				JSON.stringify(q.options),
				q.category ?? null,
				index,
				input.userId,
				input.batchId,
				input.positionId ?? null,
			)
		})
	})
	run()
}

/**
 * 按批次取回某用户的一套动态题。
 *
 * 带 owner_user_id 条件，防止拿别人的批次拼答案。
 * 选 position_id：分析阶段要用「出题时那个方向」做判定范围，
 * 不能用当前方向（用户可能中途切换过）。
 */
export function findQuestionsByBatch(batchId: string, userId: number): { id: number, question: string, options: string[], correct_index: number | null, category: string | null, sort_order: number, position_id: number | null }[] {
	const rows = getDb()
		.prepare(
			"SELECT * FROM assessment_questions WHERE batch_id = ? AND owner_user_id = ? ORDER BY sort_order",
		)
		.all(batchId, userId) as { id: number, question: string, options: string, correct_index: number | null, category: string | null, sort_order: number, position_id: number | null }[]
	return rows.map((r) => ({ ...r, options: JSON.parse(r.options) as string[] }))
}

export function createAssessmentRecord(
	userId: number,
	assessmentId: number,
	answers: number[],
	score: number,
	resultData: string,
	positionId: number | null = null,
): void {
	getDb()
		.prepare("INSERT INTO assessment_records (user_id, assessment_id, answers, score, result_data, position_id) VALUES (?, ?, ?, ?, ?, ?)")
		.run(userId, assessmentId, JSON.stringify(answers), score, resultData, positionId)
}

export function findAssessmentRecordsByUser(userId: number): { id: number, assessment_id: number, score: number, result_data: string | null, created_at: string, position_id: number | null }[] {
	return getDb()
		.prepare("SELECT id, assessment_id, score, result_data, created_at, position_id FROM assessment_records WHERE user_id = ? ORDER BY created_at DESC")
		.all(userId) as { id: number, assessment_id: number, score: number, result_data: string | null, created_at: string, position_id: number | null }[]
}

// --- 用户画像 ---

export function findUserProfile(userId: number): { user_id: number, age: number | null, education: string | null, profession: string | null, experience_years: number | null, learning_goal: string | null, career_direction: string | null, assessment_completed: number, profile_data: string | null } | null {
	return (getDb().prepare("SELECT * FROM user_profiles WHERE user_id = ?").get(userId) as { user_id: number, age: number | null, education: string | null, profession: string | null, experience_years: number | null, learning_goal: string | null, career_direction: string | null, assessment_completed: number, profile_data: string | null } | undefined) ?? null
}

export function upsertUserProfile(userId: number, data: {
	age?: number | null
	education?: string | null
	profession?: string | null
	experience_years?: number | null
	learning_goal?: string | null
	career_direction?: string | null
	assessment_completed?: number
	profile_data?: string | null
}): void {
	const existing = findUserProfile(userId)
	if (existing) {
		getDb()
			.prepare(`
				UPDATE user_profiles SET
					age = ?, education = ?, profession = ?, experience_years = ?,
					learning_goal = ?, career_direction = ?, assessment_completed = ?,
					profile_data = ?, updated_at = datetime('now')
				WHERE user_id = ?
			`)
			.run(
				data.age ?? existing.age,
				data.education ?? existing.education,
				data.profession ?? existing.profession,
				data.experience_years ?? existing.experience_years,
				data.learning_goal ?? existing.learning_goal,
				data.career_direction ?? existing.career_direction,
				data.assessment_completed ?? existing.assessment_completed,
				data.profile_data ?? existing.profile_data,
				userId,
			)
	} else {
		getDb()
			.prepare(`
				INSERT INTO user_profiles
					(user_id, age, education, profession, experience_years, learning_goal, career_direction, assessment_completed, profile_data)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
			`)
			.run(
				userId,
				data.age ?? null,
				data.education ?? null,
				data.profession ?? null,
				data.experience_years ?? null,
				data.learning_goal ?? null,
				data.career_direction ?? null,
				data.assessment_completed ?? 0,
				data.profile_data ?? null,
			)
	}
}

// --- 学习计划设置（存 user_profiles.profile_data，避免加列） ---

export interface PlanSettings {
	dailyMinutes: number
}

const DEFAULT_PLAN_SETTINGS: PlanSettings = { dailyMinutes: 20 }

/** 解析 profile_data JSON；损坏或非对象一律当空对象 */
export function parseProfileData(raw: string | null): Record<string, unknown> {
	if (!raw) return {}
	try {
		const data = JSON.parse(raw) as unknown
		if (!data || typeof data !== "object" || Array.isArray(data)) return {}
		return data as Record<string, unknown>
	} catch {
		return {}
	}
}

/**
 * 通用 merge 写入 profile_data。
 *
 * 只覆盖传入的键，保留其余内容。之前的实现是「读出 {dailyMinutes} 再整体写回」，
 * 会把测评写入的 result 等键冲掉，所以统一走这里。
 */
export function mergeProfileData(userId: number, patch: Record<string, unknown>): Record<string, unknown> {
	const existing = findUserProfile(userId)
	const merged = { ...parseProfileData(existing?.profile_data ?? null), ...patch }
	upsertUserProfile(userId, { profile_data: JSON.stringify(merged) })
	return merged
}

export function getPlanSettings(userId: number): PlanSettings {
	const data = parseProfileData(findUserProfile(userId)?.profile_data ?? null)
	const minutes = Number(data.dailyMinutes)
	return Number.isFinite(minutes) && minutes > 0
		? { ...DEFAULT_PLAN_SETTINGS, dailyMinutes: minutes }
		: { ...DEFAULT_PLAN_SETTINGS }
}

export function setDailyMinutes(userId: number, dailyMinutes: number): void {
	mergeProfileData(userId, { dailyMinutes })
}

// --- 学习资源 ---

export function findResourcesBySkill(skillId: number, positionId?: number): { id: number, title: string, type: string, url: string | null, difficulty: string, description: string | null, duration: number | null }[] {
	if (positionId !== undefined) {
		// 优先取当前方向生成的资料，没有再退回旧资料（历史数据无方向标记）
		return getDb()
			.prepare(`
				SELECT id, title, type, url, difficulty, description, duration
				FROM learning_resources
				WHERE skill_id = ?
				ORDER BY (position_id = ?) DESC, id
			`)
			.all(skillId, positionId) as { id: number, title: string, type: string, url: string | null, difficulty: string, description: string | null, duration: number | null }[]
	}
	return getDb()
		.prepare("SELECT id, title, type, url, difficulty, description, duration FROM learning_resources WHERE skill_id = ?")
		.all(skillId) as { id: number, title: string, type: string, url: string | null, difficulty: string, description: string | null, duration: number | null }[]
}

export function findAllResources(): { id: number, title: string, type: string, url: string | null, skill_id: number | null, difficulty: string, description: string | null, duration: number | null, position_id: number | null }[] {
	return getDb()
		.prepare("SELECT id, title, type, url, skill_id, difficulty, description, duration, position_id FROM learning_resources ORDER BY id")
		.all() as { id: number, title: string, type: string, url: string | null, skill_id: number | null, difficulty: string, description: string | null, duration: number | null, position_id: number | null }[]
}

/**
 * 已有正文的资源可直接复用，避免同一技能重复调用模型。
 *
 * 传 positionId 时**只**复用为该方向生成的资料：技能是全局共享的，
 * 同名技能（如「短篇阅读与信息查找」）可能同时属于韩语和英语方向，
 * 跨方向复用会把韩语课文挂到英语路径上（v8 之前的真实事故）。
 * 历史无方向标记（position_id IS NULL）的资料同样不参与复用——
 * 宁可重新生成，也不赌它语言对不对。
 */
export function findReadyResourceBySkill(skillId: number, positionId?: number): { id: number, title: string, content: string | null, summary: string | null, objectives: string | null, estimated_minutes: number | null, model: string | null } | null {
	if (positionId !== undefined) {
		return (getDb()
			.prepare(`
				SELECT id, title, content, summary, objectives, duration AS estimated_minutes, model
				FROM learning_resources
				WHERE skill_id = ? AND position_id = ? AND status = 'ready' AND content IS NOT NULL AND content <> ''
				ORDER BY id DESC LIMIT 1
			`)
			.get(skillId, positionId) as { id: number, title: string, content: string | null, summary: string | null, objectives: string | null, estimated_minutes: number | null, model: string | null } | undefined) ?? null
	}
	return (getDb()
		.prepare(`
			SELECT id, title, content, summary, objectives, duration AS estimated_minutes, model
			FROM learning_resources
			WHERE skill_id = ? AND status = 'ready' AND content IS NOT NULL AND content <> ''
			ORDER BY id DESC LIMIT 1
		`)
		.get(skillId) as { id: number, title: string, content: string | null, summary: string | null, objectives: string | null, estimated_minutes: number | null, model: string | null } | undefined) ?? null
}

/** 单条资源详情（含正文），单关页用 */
export function findResourceById(resourceId: number): {
	id: number
	title: string
	type: string
	url: string | null
	difficulty: string
	description: string | null
	summary: string | null
	objectives: string | null
	content: string | null
	duration: number | null
	source: string
	status: string
	model: string | null
	references_json: string | null
} | null {
	return (getDb()
		.prepare(`
			SELECT id, title, type, url, difficulty, description, summary, objectives,
			       content, duration, source, status, model, references_json
			FROM learning_resources
			WHERE id = ?
		`)
		.get(resourceId) as {
		id: number
		title: string
		type: string
		url: string | null
		difficulty: string
		description: string | null
		summary: string | null
		objectives: string | null
		content: string | null
		duration: number | null
		source: string
		status: string
		model: string | null
		references_json: string | null
	} | undefined) ?? null
}

/** 写入模型生成的关卡资料，返回资源 id；positionId 记录「为哪个方向生成」 */
export function insertGeneratedResource(input: {
	skillId: number | null
	title: string
	summary: string
	objectives: string[]
	content: string
	difficulty: string
	estimatedMinutes: number
	model: string
	positionId?: number | null
	/** 参考来源（已 JSON 序列化）；没有就是 null */
	references?: string | null
}): number {
	return Number(getDb()
		.prepare(`
			INSERT INTO learning_resources
				(title, type, url, skill_id, difficulty, description, duration, content, summary, objectives, source, status, generated_at, model, position_id, references_json)
			VALUES (?, 'article', NULL, ?, ?, ?, ?, ?, ?, ?, 'ai', 'ready', datetime('now'), ?, ?, ?)
		`)
		.run(
			input.title,
			input.skillId,
			input.difficulty,
			input.summary,
			input.estimatedMinutes,
			input.content,
			input.summary,
			JSON.stringify(input.objectives),
			input.model,
			input.positionId ?? null,
			input.references ?? null,
		).lastInsertRowid)
}

/**
 * 原地覆盖一条已有资料。
 *
 * 用于「把离线模板升级成模型正文」：同一技能重复生成时不新增行，
 * 否则每次重新生成都会在库里堆一份重复资源。
 */
export function updateGeneratedResource(id: number, input: {
	title: string
	summary: string
	objectives: string[]
	content: string
	difficulty: string
	estimatedMinutes: number
	model: string
	references?: string | null
}): void {
	getDb()
		.prepare(`
			UPDATE learning_resources SET
				title = ?, difficulty = ?, description = ?, duration = ?,
				content = ?, summary = ?, objectives = ?,
				source = 'ai', status = 'ready',
				generated_at = datetime('now'), model = ?,
				references_json = COALESCE(?, references_json)
			WHERE id = ?
		`)
		.run(
			input.title,
			input.difficulty,
			input.summary,
			input.estimatedMinutes,
			input.content,
			input.summary,
			JSON.stringify(input.objectives),
			input.model,
			input.references ?? null,
			id,
		)
}

/** 只更新参考来源（给历史资料补引用时用，不动正文） */
export function updateResourceReferences(id: number, referencesJson: string | null): void {
	getDb()
		.prepare("UPDATE learning_resources SET references_json = ? WHERE id = ?")
		.run(referencesJson, id)
}

/** 生成失败时降级为外链资料，保证路径一定有可点的东西 */
export function insertFallbackResource(input: {
	skillId: number | null
	title: string
	url: string
	description: string | null
}): number {
	return Number(getDb()
		.prepare(`
			INSERT INTO learning_resources
				(title, type, url, skill_id, difficulty, description, duration, source, status, generated_at)
			VALUES (?, 'article', ?, ?, 'beginner', ?, 15, 'ai-fallback', 'fallback', datetime('now'))
		`)
		.run(input.title, input.url, input.skillId, input.description).lastInsertRowid)
}

// --- 学习路径 ---

export function createLearningPath(userId: number, name: string, targetPositionId: number | null): number {
	return Number(getDb()
		.prepare("INSERT INTO learning_paths (user_id, name, target_position_id) VALUES (?, ?, ?)")
		.run(userId, name, targetPositionId).lastInsertRowid)
}

export function addLearningPathItem(
	pathId: number,
	skillId: number | null,
	resourceId: number | null,
	sortOrder: number,
	itemType = "lesson",
	estimatedMinutes: number | null = null,
): number {
	return Number(getDb()
		.prepare(`
			INSERT INTO learning_path_items (path_id, skill_id, resource_id, sort_order, item_type, estimated_minutes)
			VALUES (?, ?, ?, ?, ?, ?)
		`)
		.run(pathId, skillId, resourceId, sortOrder, itemType, estimatedMinutes)
		.lastInsertRowid)
}

/** 更新路径的生成状态（generating / ready / degraded / failed） */
export function updatePathGenerationStatus(pathId: number, status: string, model: string | null = null, errorMessage: string | null = null): void {
	getDb()
		.prepare(`
			UPDATE learning_paths SET
				generation_status = ?,
				model = COALESCE(?, model),
				generated_at = CASE WHEN ? IN ('ready','degraded') THEN datetime('now') ELSE generated_at END,
				error_message = ?,
				updated_at = datetime('now')
			WHERE id = ?
		`)
		.run(status, model, status, errorMessage, pathId)
}

export function findLearningPathsByUser(userId: number): { id: number, name: string, target_position_id: number | null, status: string, generation_status: string, created_at: string, updated_at: string }[] {
	return getDb()
		.prepare("SELECT id, name, target_position_id, status, generation_status, created_at, updated_at FROM learning_paths WHERE user_id = ? ORDER BY created_at DESC")
		.all(userId) as { id: number, name: string, target_position_id: number | null, status: string, generation_status: string, created_at: string, updated_at: string }[]
}

export function findLearningPathItems(pathId: number): { id: number, skill_id: number | null, resource_id: number | null, sort_order: number, status: string, item_type: string, estimated_minutes: number | null, started_at: string | null, completed_at: string | null }[] {
	return getDb()
		.prepare(`
			SELECT id, skill_id, resource_id, sort_order, status, item_type, estimated_minutes, started_at, completed_at
			FROM learning_path_items WHERE path_id = ? ORDER BY sort_order
		`)
		.all(pathId) as { id: number, skill_id: number | null, resource_id: number | null, sort_order: number, status: string, item_type: string, estimated_minutes: number | null, started_at: string | null, completed_at: string | null }[]
}

export function updatePathItemStatus(itemId: number, status: string): void {
	const now = status === "completed" ? "datetime('now')" : null
	if (status === "completed") {
		getDb().prepare("UPDATE learning_path_items SET status = ?, completed_at = datetime('now') WHERE id = ?").run(status, itemId)
	} else if (status === "in_progress") {
		getDb().prepare("UPDATE learning_path_items SET status = ?, started_at = COALESCE(started_at, datetime('now')) WHERE id = ?").run(status, itemId)
	} else {
		getDb().prepare("UPDATE learning_path_items SET status = ? WHERE id = ?").run(status, itemId)
	}
	void now
}

/** 查询单条路径项（带归属校验，防止越权改别人的关卡） */
export function findPathItemForUser(itemId: number, userId: number): { id: number, path_id: number, skill_id: number | null, resource_id: number | null, sort_order: number, status: string, item_type: string, estimated_minutes: number | null, started_at: string | null, completed_at: string | null } | null {
	return (getDb()
		.prepare(`
			SELECT i.id, i.path_id, i.skill_id, i.resource_id, i.sort_order, i.status,
			       i.item_type, i.estimated_minutes, i.started_at, i.completed_at
			FROM learning_path_items i
			JOIN learning_paths p ON p.id = i.path_id
			WHERE i.id = ? AND p.user_id = ?
		`)
		.get(itemId, userId) as { id: number, path_id: number, skill_id: number | null, resource_id: number | null, sort_order: number, status: string, item_type: string, estimated_minutes: number | null, started_at: string | null, completed_at: string | null } | undefined) ?? null
}

/** 查询单条学习路径（带归属校验） */
export function findLearningPathById(pathId: number, userId: number): { id: number, name: string, target_position_id: number | null, status: string, generation_status: string, created_at: string, updated_at: string } | null {
	return (getDb()
		.prepare("SELECT id, name, target_position_id, status, generation_status, created_at, updated_at FROM learning_paths WHERE id = ? AND user_id = ?")
		.get(pathId, userId) as { id: number, name: string, target_position_id: number | null, status: string, generation_status: string, created_at: string, updated_at: string } | undefined) ?? null
}

/**
 * 是否算「已有可用学习计划」。
 *
 * 只看路径存在会把「生成中」和「生成失败的空壳」也算进去，
 * 导致中间件放行后用户进到一条没有关卡的路径。
 */
export function hasUsableLearningPath(userId: number): boolean {
	const row = getDb()
		.prepare(`
			SELECT COUNT(*) AS c
			FROM learning_path_items i
			JOIN learning_paths p ON p.id = i.path_id
			WHERE p.user_id = ? AND p.generation_status <> 'failed'
		`)
		.get(userId) as { c: number } | undefined
	return (row?.c ?? 0) > 0
}

/** 更新学习路径状态（带归属校验）。激活时自动将其他路径置为 archived */
export function updateLearningPathStatus(pathId: number, userId: number, status: "active" | "archived" | "completed"): boolean {
	const path = findLearningPathById(pathId, userId)
	if (!path) return false

	const db = getDb()
	if (status === "active") {
		db.transaction(() => {
			db.prepare("UPDATE learning_paths SET status = 'archived', updated_at = datetime('now') WHERE user_id = ? AND status = 'active'").run(userId)
			db.prepare("UPDATE learning_paths SET status = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?").run(status, pathId, userId)
		})()
	} else {
		db.prepare("UPDATE learning_paths SET status = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?").run(status, pathId, userId)
	}
	return true
}

/** 删除学习路径（带归属校验） */
export function deleteLearningPath(pathId: number, userId: number): boolean {
	const result = getDb()
		.prepare("DELETE FROM learning_paths WHERE id = ? AND user_id = ?")
		.run(pathId, userId)
	return result.changes > 0
}

// --- 问答 ---

export function createQARecord(userId: number, question: string, answer: string | null, context: string | null): void {
	getDb()
		.prepare("INSERT INTO qa_records (user_id, question, answer, context) VALUES (?, ?, ?, ?)")
		.run(userId, question, answer, context)
}

export function findQARecordsByUser(userId: number, limit = 50): { id: number, question: string, answer: string | null, context: string | null, created_at: string }[] {
	return getDb()
		.prepare("SELECT id, question, answer, context, created_at FROM qa_records WHERE user_id = ? ORDER BY created_at DESC LIMIT ?")
		.all(userId, limit) as { id: number, question: string, answer: string | null, context: string | null, created_at: string }[]
}

// --- 学习报告 ---

export function createLearningReport(userId: number, type: string, periodStart: string | null, periodEnd: string | null, summary: string): void {
	getDb()
		.prepare("INSERT INTO learning_reports (user_id, type, period_start, period_end, summary) VALUES (?, ?, ?, ?, ?)")
		.run(userId, type, periodStart, periodEnd, summary)
}

export function findReportsByUser(userId: number): { id: number, type: string, period_start: string | null, period_end: string | null, summary: string | null, created_at: string }[] {
	return getDb()
		.prepare("SELECT id, type, period_start, period_end, summary, created_at FROM learning_reports WHERE user_id = ? ORDER BY created_at DESC")
		.all(userId) as { id: number, type: string, period_start: string | null, period_end: string | null, summary: string | null, created_at: string }[]
}

// --- 学习记录 ---

export function findLearningRecordsByUser(userId: number): { id: number, resource_id: number | null, path_item_id: number | null, status: string, progress: number, time_spent: number, created_at: string }[] {
	return getDb()
		.prepare("SELECT id, resource_id, path_item_id, status, progress, time_spent, created_at FROM learning_records WHERE user_id = ? ORDER BY created_at DESC")
		.all(userId) as { id: number, resource_id: number | null, path_item_id: number | null, status: string, progress: number, time_spent: number, created_at: string }[]
}

// --- 阶段测评（mastery_checks） ---

export interface MasteryCheckRow {
	id: number
	user_id: number
	path_id: number
	skill_ids: string
	questions: string
	answers: string | null
	score: number | null
	result_data: string | null
	status: string
	model: string | null
	mock: number
	created_at: string
	scored_at: string | null
	accepted_at: string | null
}

export function createMasteryCheck(input: {
	userId: number
	pathId: number
	skillIds: number[]
	questions: unknown
	model: string
	mock: boolean
}): number {
	return Number(getDb()
		.prepare(`
			INSERT INTO mastery_checks (user_id, path_id, skill_ids, questions, model, mock, status)
			VALUES (?, ?, ?, ?, ?, ?, 'ready')
		`)
		.run(
			input.userId,
			input.pathId,
			JSON.stringify(input.skillIds),
			JSON.stringify(input.questions),
			input.model,
			input.mock ? 1 : 0,
		).lastInsertRowid)
}

export function findMasteryChecksByUser(userId: number, limit = 10): MasteryCheckRow[] {
	return getDb()
		.prepare("SELECT * FROM mastery_checks WHERE user_id = ? ORDER BY id DESC LIMIT ?")
		.all(userId, limit) as MasteryCheckRow[]
}

export function findMasteryCheckById(checkId: number, userId: number): MasteryCheckRow | null {
	return (getDb()
		.prepare("SELECT * FROM mastery_checks WHERE id = ? AND user_id = ?")
		.get(checkId, userId) as MasteryCheckRow | undefined) ?? null
}

export function updateMasteryCheckScored(checkId: number, answers: number[], score: number, resultData: string): void {
	getDb()
		.prepare(`
			UPDATE mastery_checks
			SET answers = ?, score = ?, result_data = ?, status = 'scored', scored_at = datetime('now')
			WHERE id = ?
		`)
		.run(JSON.stringify(answers), score, resultData, checkId)
}

export function updateMasteryCheckAccepted(checkId: number): void {
	getDb()
		.prepare("UPDATE mastery_checks SET status = 'accepted', accepted_at = datetime('now') WHERE id = ?")
		.run(checkId)
}

/**
 * 把「已完成但测评判定没掌握」的关卡退回待学状态。
 *
 * 没有这一步闭环是断的：moveSkillsToReview 只搬 pending 的关卡，
 * 而刚被测出没掌握的恰恰是 completed 的那一关——它会被留在原地假装学过了。
 */
export function reopenSkillsForReview(pathId: number, skillIds: number[]): number {
	if (skillIds.length === 0) return 0
	const db = getDb()
	const placeholders = skillIds.map(() => "?").join(",")
	// 故意保留 completed_at：它是「上次学完的时间」，今日任务调度据此算复习紧迫度
	// （原实现清空后就没法知道隔了多久）。所有统计口径都以 status = 'completed' 为准，
	// 所以留着这个时间戳不会把复习关算进连胜或今日完成数。
	return db
		.prepare(`
			UPDATE learning_path_items
			SET status = 'pending', item_type = 'review'
			WHERE path_id = ? AND skill_id IN (${placeholders}) AND status = 'completed'
		`)
		.run(pathId, ...skillIds).changes
}

/** 把某路径下指定技能的待学关卡移到末尾并标为复习关（只动 pending，in_progress 保持原位） */
export function moveSkillsToReview(pathId: number, skillIds: number[]): number {
	if (skillIds.length === 0) return 0
	const db = getDb()
	const placeholders = skillIds.map(() => "?").join(",")

	const maxRow = db.prepare("SELECT COALESCE(MAX(sort_order), -1) AS m FROM learning_path_items WHERE path_id = ?").get(pathId) as { m: number }
	let cursor = maxRow.m + 1

	const rows = db
		.prepare(`
			SELECT id FROM learning_path_items
			WHERE path_id = ? AND skill_id IN (${placeholders}) AND status = 'pending'
			ORDER BY sort_order
		`)
		.all(pathId, ...skillIds) as { id: number }[]

	const update = db.prepare("UPDATE learning_path_items SET sort_order = ?, item_type = 'review' WHERE id = ?")
	const run = db.transaction(() => {
		for (const row of rows) {
			update.run(cursor++, row.id)
		}
	})
	run()
	return rows.length
}

/** 重新压紧 sort_order，避免移动后出现稀疏序号 */
export function normalizePathOrder(pathId: number): void {
	const db = getDb()
	const rows = db
		.prepare("SELECT id FROM learning_path_items WHERE path_id = ? ORDER BY sort_order, id")
		.all(pathId) as { id: number }[]
	const update = db.prepare("UPDATE learning_path_items SET sort_order = ? WHERE id = ?")
	const run = db.transaction(() => {
		rows.forEach((row, index) => update.run(index, row.id))
	})
	run()
}

/** 删掉单个关卡（图谱演进后清理已不属于该方向的节点用） */
export function deletePathItem(itemId: number): void {
	getDb().prepare("DELETE FROM learning_path_items WHERE id = ?").run(itemId)
}

/** 按给定顺序一次性重排关卡；ids 之外的关卡保持不动 */
export function reorderPathItems(pathId: number, itemIds: number[]): void {
	if (itemIds.length === 0) return
	const db = getDb()
	const update = db.prepare("UPDATE learning_path_items SET sort_order = ? WHERE id = ? AND path_id = ?")
	const run = db.transaction(() => {
		itemIds.forEach((itemId, index) => update.run(index, itemId, pathId))
	})
	run()
}

/** 关卡数（图谱同步时判断"这条路径是不是空的"） */
export function countPathItems(pathId: number): number {
	const row = getDb()
		.prepare("SELECT COUNT(*) AS c FROM learning_path_items WHERE path_id = ?")
		.get(pathId) as { c: number }
	return row.c
}
