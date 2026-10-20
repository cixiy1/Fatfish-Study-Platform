import { findUserByIdentifier, touchLastLogin } from "../../repositories/user.repository"
import { findUserProfile, hasUsableLearningPath } from "../../repositories/learning.repository"
import { isInstalled } from "../../utils/app-config"
import { verifyPassword } from "../../utils/password"

interface LoginBody {
	account?: string
	password?: string
	remember?: boolean
}

/**
 * 登录：POST /api/auth/login
 *
 * 对接数据库校验凭证。为防账号枚举，账号不存在 / 密码错误 / 账号停用统一返回同一提示。
 * 方案 X：仅当账号存在且密码正确时才返回 403（未验证邮箱），否则统一 401。
 */
export default defineEventHandler(async (event) => {
	if (!isInstalled()) {
		throw createError({ statusCode: 503, message: "系统尚未安装，请先访问 /install 完成初始化" })
	}

	const body = await readBody<LoginBody>(event).catch(() => null)

	const account = (body?.account ?? "").trim()
	const password = body?.password ?? ""

	if (!account || !password) {
		throw createError({ statusCode: 400, message: "账号和密码不能为空" })
	}

	// 账号或邮箱均可登录
	const user = findUserByIdentifier(account)

	// 账号不存在或密码错误 → 统一 401（防枚举）
	if (!user || !verifyPassword(password, user.password_hash)) {
		throw createError({ statusCode: 401, message: "账号或密码错误" })
	}

	// 密码正确但未验证邮箱 → 403（方案 X：仅密码正确时才区分）
	if (user.status === "pending") {
		throw createError({ statusCode: 403, message: "账号尚未验证邮箱，请查收验证邮件或联系管理员" })
	}

	// 其他非 active 状态（如停用）→ 统一 401
	if (user.status !== "active") {
		throw createError({ statusCode: 401, message: "账号或密码错误" })
	}

	touchLastLogin(user.id)

	const sessionUser = { account: user.account, name: user.name }

	// 记住我 = 7 天，不勾选则用会话 cookie（关浏览器即失效）
	setSession(event, sessionUser, body?.remember ? 60 * 60 * 24 * 7 : undefined)

	const profile = findUserProfile(user.id)
	const hasPath = hasUsableLearningPath(user.id)

	return {
		user: {
			...sessionUser,
			role: user.role,
			career_direction: profile?.career_direction ?? null,
			assessment_completed: profile?.assessment_completed ?? 0,
			has_learning_path: hasPath,
		},
	}
})
