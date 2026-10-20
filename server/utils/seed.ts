import type { Database } from "better-sqlite3"

/**
 * 种子数据。
 *
 * 只播种测评题库：题库属于功能配置，没有它测评页就没题可答。
 *
 * 岗位、技能、资源**不再自动播种**：
 * 1. 本平台面向「任何领域」，预置 6 个 IT 岗位会把用户限制在技术方向上；
 * 2. seed 的判定是「表为空就插」，用户清空数据后重启服务又会冒出来，删不干净。
 *
 * 下方的 seedPositions / seedSkills / seedPositionSkills / seedResources 仅作为
 * 演示数据来源保留，需要时手动调用，不在启动流程里执行。
 */
export function seed(db: Database): void {
	seedAssessments(db)
}

function seedPositions(db: Database): void {
	const count = (db.prepare("SELECT COUNT(*) AS c FROM positions").get() as { c: number }).c
	if (count > 0) return

	const positions = [
		{ name: "前端开发工程师", category: "IT", description: "负责 Web 前端界面开发，使用 Vue/React 等框架", icon: "i-lucide-layout" },
		{ name: "后端开发工程师", category: "IT", description: "负责服务端 API 开发、数据库设计与业务逻辑", icon: "i-lucide-server" },
		{ name: "全栈工程师", category: "IT", description: "掌握前后端全链路开发能力", icon: "i-lucide-layers" },
		{ name: "数据分析师", category: "数据", description: "负责数据采集、清洗、分析与可视化", icon: "i-lucide-chart-bar" },
		{ name: "AI 算法工程师", category: "AI", description: "负责机器学习模型训练、部署与优化", icon: "i-lucide-brain" },
		{ name: "智能制造工程师", category: "制造", description: "负责工业自动化、PLC 编程与产线集成", icon: "i-lucide-factory" },
	]
	const insert = db.prepare("INSERT INTO positions (name, category, description, icon) VALUES (?, ?, ?, ?)")
	for (const p of positions) insert.run(p.name, p.category, p.description, p.icon)
}

function seedSkills(db: Database): void {
	const count = (db.prepare("SELECT COUNT(*) AS c FROM skills").get() as { c: number }).c
	if (count > 0) return

	const insert = db.prepare("INSERT INTO skills (name, category, parent_id, level, description) VALUES (?, ?, ?, ?, ?)")

	const categories = [
		{ cat: "前端", skills: [
			{ name: "HTML/CSS", level: 0, desc: "网页结构与样式基础" },
			{ name: "JavaScript", level: 0, desc: "前端编程语言" },
			{ name: "TypeScript", level: 1, desc: "JS 类型超集", parent: "JavaScript" },
			{ name: "Vue.js", level: 1, desc: "渐进式前端框架", parent: "JavaScript" },
			{ name: "React", level: 1, desc: "组件化前端框架", parent: "JavaScript" },
			{ name: "CSS 框架", level: 1, desc: "Tailwind/Bootstrap 等", parent: "HTML/CSS" },
			{ name: "前端工程化", level: 1, desc: "Vite/Webpack/ESLint", parent: "JavaScript" },
		]},
		{ cat: "后端", skills: [
			{ name: "Node.js", level: 0, desc: "服务端 JS 运行时" },
			{ name: "Python", level: 0, desc: "通用编程语言" },
			{ name: "数据库", level: 0, desc: "数据存储与管理" },
			{ name: "SQL", level: 1, desc: "结构化查询语言", parent: "数据库" },
			{ name: "SQLite", level: 2, desc: "轻量级关系数据库", parent: "SQL" },
			{ name: "API 设计", level: 1, desc: "RESTful/GraphQL", parent: "Node.js" },
			{ name: "Nuxt/Nitro", level: 1, desc: "全栈框架", parent: "Node.js" },
		]},
		{ cat: "数据", skills: [
			{ name: "统计学", level: 0, desc: "数据分析数学基础" },
			{ name: "Pandas/NumPy", level: 0, desc: "Python 数据处理库" },
			{ name: "数据可视化", level: 0, desc: "图表与可视化" },
			{ name: "SQL 查询", level: 0, desc: "数据库查询能力" },
			{ name: "Excel 高级", level: 0, desc: "电子表格分析" },
		]},
		{ cat: "AI", skills: [
			{ name: "机器学习", level: 0, desc: "ML 基础理论" },
			{ name: "深度学习", level: 1, desc: "神经网络", parent: "机器学习" },
			{ name: "PyTorch", level: 1, desc: "深度学习框架", parent: "深度学习" },
			{ name: "NLP", level: 1, desc: "自然语言处理", parent: "机器学习" },
			{ name: "大语言模型", level: 2, desc: "LLM 应用与微调", parent: "NLP" },
			{ name: "Prompt 工程", level: 2, desc: "提示词工程", parent: "大语言模型" },
		]},
		{ cat: "制造", skills: [
			{ name: "PLC 编程", level: 0, desc: "可编程逻辑控制器" },
			{ name: "工业网络", level: 0, desc: "工业通信协议" },
			{ name: "机器人技术", level: 0, desc: "工业机器人编程" },
			{ name: "MES 系统", level: 0, desc: "制造执行系统" },
			{ name: "数字孪生", level: 0, desc: "产线仿真与建模" },
		]},
	]

	for (const group of categories) {
		const parentMap = new Map<string, number>()
		for (const s of group.skills) {
			const parentId = s.parent ? parentMap.get(s.parent) ?? null : null
			const info = insert.run(s.name, group.cat, parentId, s.level, s.desc)
			parentMap.set(s.name, Number(info.lastInsertRowid))
		}
	}
}

function seedPositionSkills(db: Database): void {
	const count = (db.prepare("SELECT COUNT(*) AS c FROM position_skills").get() as { c: number }).c
	if (count > 0) return

	const posByName = (name: string) => (db.prepare("SELECT id FROM positions WHERE name = ?").get(name) as { id: number } | undefined)?.id
	const skillByName = (name: string, cat: string) => (db.prepare("SELECT id FROM skills WHERE name = ? AND category = ?").get(name, cat) as { id: number } | undefined)?.id

	const insert = db.prepare("INSERT OR IGNORE INTO position_skills (position_id, skill_id, required_level) VALUES (?, ?, ?)")

	const links: { pos: string, skill: string, cat: string, level: number }[] = [
		{ pos: "前端开发工程师", skill: "HTML/CSS", cat: "前端", level: 2 },
		{ pos: "前端开发工程师", skill: "JavaScript", cat: "前端", level: 2 },
		{ pos: "前端开发工程师", skill: "TypeScript", cat: "前端", level: 2 },
		{ pos: "前端开发工程师", skill: "Vue.js", cat: "前端", level: 2 },
		{ pos: "前端开发工程师", skill: "React", cat: "前端", level: 1 },
		{ pos: "前端开发工程师", skill: "CSS 框架", cat: "前端", level: 1 },
		{ pos: "前端开发工程师", skill: "前端工程化", cat: "前端", level: 1 },
		{ pos: "后端开发工程师", skill: "Node.js", cat: "后端", level: 2 },
		{ pos: "后端开发工程师", skill: "Python", cat: "后端", level: 1 },
		{ pos: "后端开发工程师", skill: "SQL", cat: "后端", level: 2 },
		{ pos: "后端开发工程师", skill: "API 设计", cat: "后端", level: 2 },
		{ pos: "后端开发工程师", skill: "Nuxt/Nitro", cat: "后端", level: 2 },
		{ pos: "全栈工程师", skill: "Vue.js", cat: "前端", level: 2 },
		{ pos: "全栈工程师", skill: "Node.js", cat: "后端", level: 2 },
		{ pos: "全栈工程师", skill: "SQL", cat: "后端", level: 2 },
		{ pos: "全栈工程师", skill: "API 设计", cat: "后端", level: 2 },
		{ pos: "数据分析师", skill: "统计学", cat: "数据", level: 2 },
		{ pos: "数据分析师", skill: "Pandas/NumPy", cat: "数据", level: 2 },
		{ pos: "数据分析师", skill: "数据可视化", cat: "数据", level: 2 },
		{ pos: "数据分析师", skill: "SQL 查询", cat: "数据", level: 2 },
		{ pos: "AI 算法工程师", skill: "机器学习", cat: "AI", level: 2 },
		{ pos: "AI 算法工程师", skill: "深度学习", cat: "AI", level: 2 },
		{ pos: "AI 算法工程师", skill: "PyTorch", cat: "AI", level: 2 },
		{ pos: "AI 算法工程师", skill: "大语言模型", cat: "AI", level: 2 },
		{ pos: "AI 算法工程师", skill: "Prompt 工程", cat: "AI", level: 1 },
		{ pos: "智能制造工程师", skill: "PLC 编程", cat: "制造", level: 2 },
		{ pos: "智能制造工程师", skill: "工业网络", cat: "制造", level: 1 },
		{ pos: "智能制造工程师", skill: "机器人技术", cat: "制造", level: 1 },
		{ pos: "智能制造工程师", skill: "MES 系统", cat: "制造", level: 1 },
	]

	for (const l of links) {
		const pid = posByName(l.pos)
		const sid = skillByName(l.skill, l.cat)
		if (pid && sid) insert.run(pid, sid, l.level)
	}
}

function seedAssessments(db: Database): void {
	const count = (db.prepare("SELECT COUNT(*) AS c FROM assessments").get() as { c: number }).c
	if (count > 0) return

	const insertA = db.prepare("INSERT INTO assessments (type, title, description) VALUES (?, ?, ?)")
	const insertQ = db.prepare("INSERT INTO assessment_questions (assessment_id, question, options, correct_index, category, sort_order) VALUES (?, ?, ?, ?, ?, ?)")

	const aid = Number(insertA.run("career", "基础能力测评", "评估学习基础与偏好，用于生成初始画像").lastInsertRowid)

	const questions = [
		{ q: "你更倾向于哪种学习方式？", opts: ["一个人安静钻研", "和别人一起讨论", "边做边找人问", "先定计划再推进"], cat: "学习风格" },
		{ q: "面对一个全新的领域，你通常？", opts: ["先看官方文档或教材", "跟着教程一步步做", "直接上手试错", "找个真实任务练手"], cat: "学习风格" },
		{ q: "你更享受哪一类事情？", opts: ["做出看得见摸得着的东西", "搞懂背后的原理和机制", "用数据或证据说明问题", "通过表达和设计打动人"], cat: "兴趣倾向" },
		{ q: "你在这个领域的基础？", opts: ["完全新手", "懂一点，能照着做", "独立完成过完整作品", "有长期实践经验"], cat: "基础水平" },
		{ q: "遇到卡住的地方，你通常？", opts: ["先搜关键词找答案", "逐步拆解排查", "找人问或去社区", "回头检查整体思路"], cat: "问题解决" },
		{ q: "你希望学习的节奏是？", opts: ["系统化循序渐进", "项目驱动快速上手", "按需查阅即学即用", "理论实践并重"], cat: "学习偏好" },
		{ q: "面对需要计算或推理的内容，你？", opts: ["很喜欢，愿意深挖", "能接受，够用就行", "尽量避开", "想专门补强"], cat: "基础能力" },
		{ q: "你的学习目标是？", opts: ["深入一个专业方向", "支撑当前学业", "独立完成项目", "跨领域入门"], cat: "学习目标" },
	]

	questions.forEach((item, i) => {
		insertQ.run(aid, item.q, JSON.stringify(item.opts), null, item.cat, i)
	})
}

function seedResources(db: Database): void {
	const count = (db.prepare("SELECT COUNT(*) AS c FROM learning_resources").get() as { c: number }).c
	if (count > 0) return

	const skillByName = (name: string, cat: string) => (db.prepare("SELECT id FROM skills WHERE name = ? AND category = ?").get(name, cat) as { id: number } | undefined)?.id
	const insert = db.prepare("INSERT INTO learning_resources (title, type, url, skill_id, difficulty, description, duration) VALUES (?, ?, ?, ?, ?, ?, ?)")

	const resources = [
		{ title: "MDN Web 文档", type: "article", url: "https://developer.mozilla.org", skill: "HTML/CSS", cat: "前端", diff: "beginner", desc: "最权威的 Web 技术文档", dur: null },
		{ title: "Vue.js 官方教程", type: "article", url: "https://vuejs.org/tutorial", skill: "Vue.js", cat: "前端", diff: "beginner", desc: "Vue 3 交互式教程", dur: 60 },
		{ title: "TypeScript 入门", type: "article", url: "https://www.typescriptlang.org/docs/handbook/intro.html", skill: "TypeScript", cat: "前端", diff: "beginner", desc: "TS 官方手册", dur: 30 },
		{ title: "Node.js 入门", type: "article", url: "https://nodejs.org/en/docs", skill: "Node.js", cat: "后端", diff: "beginner", desc: "Node.js 官方文档", dur: 45 },
		{ title: "SQL 基础教程", type: "article", url: "https://www.w3schools.com/sql", skill: "SQL", cat: "后端", diff: "beginner", desc: "SQL 语法入门", dur: 60 },
		{ title: "Python 数据分析", type: "article", url: "https://pandas.pydata.org/docs/getting_started", skill: "Pandas/NumPy", cat: "数据", diff: "intermediate", desc: "Pandas 入门指南", dur: 90 },
		{ title: "机器学习导论", type: "article", url: "https://scikit-learn.org/stable/tutorial", skill: "机器学习", cat: "AI", diff: "intermediate", desc: "scikit-learn 教程", dur: 120 },
		{ title: "深度学习 PyTorch", type: "article", url: "https://pytorch.org/tutorials", skill: "PyTorch", cat: "AI", diff: "advanced", desc: "PyTorch 官方教程", dur: 180 },
		{ title: "PLC 编程基础", type: "article", url: null, skill: "PLC 编程", cat: "制造", diff: "beginner", desc: "PLC 梯形图编程入门", dur: 60 },
	]

	for (const r of resources) {
		const sid = skillByName(r.skill, r.cat)
		insert.run(r.title, r.type, r.url, sid ?? null, r.diff, r.desc, r.dur)
	}
}
