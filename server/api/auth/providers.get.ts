import { isGitHubConfigured } from "../../utils/oauth"

/**
 * 前端探测第三方登录是否可用：GET /api/auth/providers
 *
 * 只接 GitHub。没配凭证时登录页不显示第三方按钮，
 * 而不是点了之后弹一段 501 的 JSON。
 */
export default defineEventHandler(() => {
	return {
		github: isGitHubConfigured(),
	}
})
