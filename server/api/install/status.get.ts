import { getInstallStatus } from "../../utils/installer"

/**
 * 安装状态查询：GET /api/install/status
 *
 * 只返回是否已安装等非敏感信息，供前端决定是否跳转 /install。
 */
export default defineEventHandler(() => {
	return getInstallStatus()
})
