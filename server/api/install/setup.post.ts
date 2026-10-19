import type { InstallPayload } from "#shared/types/install"
import { validateInstallPayload } from "#shared/utils/validate-install"
import { isInstalled } from "../../utils/app-config"
import { runInstall } from "../../utils/installer"

/**
 * 执行初始化：POST /api/install/setup
 *
 * 流程：已安装拦截 → 校验参数 → 建表 → 创建管理员 → 持久化配置 → 标记已安装。
 * 已安装时返回 409，防止被重复初始化。
 */
export default defineEventHandler(async (event) => {
	// 已安装优先拒绝，避免进入任何参数处理
	if (isInstalled()) {
		throw createError({ statusCode: 409, message: "系统已完成安装，禁止重复初始化" })
	}

	const body = await readBody<InstallPayload>(event).catch(() => null)
	if (!body || !body.database || !body.admin) {
		throw createError({ statusCode: 400, message: "请求参数不完整" })
	}

	const result = validateInstallPayload(body)
	if (!result.ok) {
		throw createError({ statusCode: 400, message: result.message ?? "参数校验失败" })
	}

	try {
		const config = runInstall(body)
		return { installed: true, installedAt: config.installedAt }
	} catch (error) {
		if (error instanceof Error && error.message === "ALREADY_INSTALLED") {
			throw createError({ statusCode: 409, message: "系统已完成安装，禁止重复初始化" })
		}
		throw createError({ statusCode: 500, message: "安装失败，请检查配置后重试" })
	}
})
