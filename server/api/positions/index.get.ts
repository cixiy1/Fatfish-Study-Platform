import { findAllPositions } from "../../repositories/learning.repository"

/** 岗位列表：GET /api/positions */
export default defineEventHandler(() => {
	return findAllPositions()
})
