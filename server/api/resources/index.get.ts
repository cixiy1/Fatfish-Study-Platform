import { findAllResources } from "../../repositories/learning.repository"

/** 学习资源列表：GET /api/resources */
export default defineEventHandler(() => {
	return findAllResources()
})
