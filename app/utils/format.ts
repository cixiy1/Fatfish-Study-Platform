/**
 * 日期格式化工具（实用示例）。
 *
 * app/utils/ 下的具名导出函数会被自动导入，全局可用，无需手动 import。
 */

/** 格式化为 YYYY-MM-DD；非法日期返回空字符串 */
export function formatDate(input: Date | string | number): string {
	const date = new Date(input)
	if (Number.isNaN(date.getTime())) return ""

	const year = date.getFullYear()
	const month = String(date.getMonth() + 1).padStart(2, "0")
	const day = String(date.getDate()).padStart(2, "0")
	return `${year}-${month}-${day}`
}

/** 格式化为 YYYY-MM-DD HH:mm:ss；非法日期返回空字符串 */
export function formatDateTime(input: Date | string | number): string {
	const date = new Date(input)
	if (Number.isNaN(date.getTime())) return ""

	const hours = String(date.getHours()).padStart(2, "0")
	const minutes = String(date.getMinutes()).padStart(2, "0")
	const seconds = String(date.getSeconds()).padStart(2, "0")
	return `${formatDate(date)} ${hours}:${minutes}:${seconds}`
}
