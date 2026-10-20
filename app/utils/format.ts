/**
 * 日期格式化工具。
 *
 * app/utils/ 下的具名导出函数会被自动导入，全局可用，无需手动 import。
 *
 * 注意时区：数据库里 created_at 由 `datetime('now')` 生成，是 UTC 且不带时区后缀。
 * `new Date("2026-10-19 21:38:08")` 会按本地时间解析，显示会比真实时间早 8 小时，
 * 所以这种格式先补上 Z 再解析。
 */
function parseTime(input: Date | string | number): Date {
	if (input instanceof Date) return input
	if (typeof input === "string") {
		const trimmed = input.trim()
		if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(trimmed)) {
			return new Date(`${trimmed.replace(" ", "T")}Z`)
		}
		return new Date(trimmed)
	}
	return new Date(input)
}

/** 格式化为 YYYY-MM-DD；非法日期返回空字符串 */
export function formatDate(input: Date | string | number): string {
	const date = parseTime(input)
	if (Number.isNaN(date.getTime())) return ""

	const year = date.getFullYear()
	const month = String(date.getMonth() + 1).padStart(2, "0")
	const day = String(date.getDate()).padStart(2, "0")
	return `${year}-${month}-${day}`
}

/** 格式化为 YYYY-MM-DD HH:mm（本地时间）；非法日期返回空字符串 */
export function formatDateTime(input: Date | string | number): string {
	const date = parseTime(input)
	if (Number.isNaN(date.getTime())) return ""

	const hours = String(date.getHours()).padStart(2, "0")
	const minutes = String(date.getMinutes()).padStart(2, "0")
	return `${formatDate(date)} ${hours}:${minutes}`
}
