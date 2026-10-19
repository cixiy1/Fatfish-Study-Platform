import { countUsers } from "../../repositories/user.repository"
import { requireAdmin } from "../../utils/admin-guard"

/**
 * 用户总数：GET /api/admin/user-count
 */
export default defineEventHandler((event) => {
	requireAdmin(event)
	return { count: countUsers() }
})
