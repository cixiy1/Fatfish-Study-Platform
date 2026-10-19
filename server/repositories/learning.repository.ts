import { getDb } from "../utils/db"

/**
 * 学习平台数据访问层。
 *
 * 涵盖岗位、技能图谱、测评、学习路径、问答、报告。
 */

// --- 岗位 ---

export function findAllPositions(): { id: number, name: string, category: string, description: string | null, icon: string | null, skill_count: number }[] {
	return getDb()
		.prepare(`
			SELECT p.*, COUNT(ps.skill_id) AS skill_count
			FROM positions p
			LEFT JOIN position_skills ps ON ps.position_id = p.id
			GROUP BY p.id
			ORDER BY p.category, p.id
		`)
		.all() as { id: number, name: string, category: string, description: string | null, icon: string | null, skill_count: number }[]
}

export function findPositionById(id: number): { id: number, name: string, category: string, description: string | null, icon: string | null } | null {
	return (getDb().prepare("SELECT * FROM positions WHERE id = ?").get(id) as { id: number, name: string, category: string, description: string | null, icon: string | null } | undefined) ?? null
}

// --- 技能 ---

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
			ORDER BY s.level, s.id
		`)
		.all(positionId) as { id: number, name: string, category: string, parent_id: number | null, level: number, description: string | null, required_level: number }[]
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

export function findAssessmentQuestions(assessmentId: number): { id: number, question: string, options: string[], correct_index: number | null, category: string | null, sort_order: number }[] {
	const rows = getDb()
		.prepare("SELECT * FROM assessment_questions WHERE assessment_id = ? ORDER BY sort_order")
		.all(assessmentId) as { id: number, question: string, options: string, correct_index: number | null, category: string | null, sort_order: number }[]
	return rows.map((r) => ({ ...r, options: JSON.parse(r.options) as string[] }))
}

export function createAssessmentRecord(userId: number, assessmentId: number, answers: number[], score: number, resultData: string): void {
	getDb()
		.prepare("INSERT INTO assessment_records (user_id, assessment_id, answers, score, result_data) VALUES (?, ?, ?, ?, ?)")
		.run(userId, assessmentId, JSON.stringify(answers), score, resultData)
}

export function findAssessmentRecordsByUser(userId: number): { id: number, assessment_id: number, score: number, result_data: string | null, created_at: string }[] {
	return getDb()
		.prepare("SELECT id, assessment_id, score, result_data, created_at FROM assessment_records WHERE user_id = ? ORDER BY created_at DESC")
		.all(userId) as { id: number, assessment_id: number, score: number, result_data: string | null, created_at: string }[]
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

// --- 学习资源 ---

export function findResourcesBySkill(skillId: number): { id: number, title: string, type: string, url: string | null, difficulty: string, description: string | null, duration: number | null }[] {
	return getDb()
		.prepare("SELECT id, title, type, url, difficulty, description, duration FROM learning_resources WHERE skill_id = ?")
		.all(skillId) as { id: number, title: string, type: string, url: string | null, difficulty: string, description: string | null, duration: number | null }[]
}

export function findAllResources(): { id: number, title: string, type: string, url: string | null, skill_id: number | null, difficulty: string, description: string | null, duration: number | null }[] {
	return getDb()
		.prepare("SELECT id, title, type, url, skill_id, difficulty, description, duration FROM learning_resources ORDER BY id")
		.all() as { id: number, title: string, type: string, url: string | null, skill_id: number | null, difficulty: string, description: string | null, duration: number | null }[]
}

// --- 学习路径 ---

export function createLearningPath(userId: number, name: string, targetPositionId: number | null): number {
	return Number(getDb()
		.prepare("INSERT INTO learning_paths (user_id, name, target_position_id) VALUES (?, ?, ?)")
		.run(userId, name, targetPositionId).lastInsertRowid)
}

export function addLearningPathItem(pathId: number, skillId: number | null, resourceId: number | null, sortOrder: number): void {
	getDb()
		.prepare("INSERT INTO learning_path_items (path_id, skill_id, resource_id, sort_order) VALUES (?, ?, ?, ?)")
		.run(pathId, skillId, resourceId, sortOrder)
}

export function findLearningPathsByUser(userId: number): { id: number, name: string, target_position_id: number | null, status: string, created_at: string, updated_at: string }[] {
	return getDb()
		.prepare("SELECT id, name, target_position_id, status, created_at, updated_at FROM learning_paths WHERE user_id = ? ORDER BY created_at DESC")
		.all(userId) as { id: number, name: string, target_position_id: number | null, status: string, created_at: string, updated_at: string }[]
}

export function findLearningPathItems(pathId: number): { id: number, skill_id: number | null, resource_id: number | null, sort_order: number, status: string, started_at: string | null, completed_at: string | null }[] {
	return getDb()
		.prepare("SELECT id, skill_id, resource_id, sort_order, status, started_at, completed_at FROM learning_path_items WHERE path_id = ? ORDER BY sort_order")
		.all(pathId) as { id: number, skill_id: number | null, resource_id: number | null, sort_order: number, status: string, started_at: string | null, completed_at: string | null }[]
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

/** 查询单条学习路径（带归属校验） */
export function findLearningPathById(pathId: number, userId: number): { id: number, name: string, target_position_id: number | null, status: string, created_at: string, updated_at: string } | null {
	return (getDb()
		.prepare("SELECT id, name, target_position_id, status, created_at, updated_at FROM learning_paths WHERE id = ? AND user_id = ?")
		.get(pathId, userId) as { id: number, name: string, target_position_id: number | null, status: string, created_at: string, updated_at: string } | undefined) ?? null
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
