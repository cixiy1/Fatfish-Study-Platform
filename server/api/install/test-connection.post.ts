import { validateDatabaseInput } from "#shared/utils/validate-install"
import { testDatabaseConnection } from "../../utils/installer"

/**
 * 测试数据库连通性：POST /api/install/test-connection
 *
 * 仅做连接校验，不写入任何应用配置。
 */
export default defineEventHandler(async (event) => {
	const body = await readBody<{ database?: { file?: string } }>(event).catch(() => null)
	const file = body?.database?.file ?? ""

	const result = validateDatabaseInput({ file })
	if (!result.ok) {
		throw createError({ statusCode: 400, message: result.message ?? "数据库参数不合法" })
	}

	try {
		const info = testDatabaseConnection(file)
		return { ok: true, file: info.file }
	} catch {
		throw createError({
			statusCode: 400,
			message: "数据库连接失败：无法创建或打开数据文件，请检查路径与权限",
		})
	}
})
