/**
 * 应用初始化插件（示例）。
 *
 * 文件名中的 "01." 前缀用于控制插件执行顺序，数字越小越先执行。
 * 这里通过 provide 注入一个全局只读版本号，演示插件注入用法：
 *   const { $appVersion } = useNuxtApp()
 */
export default defineNuxtPlugin(() => {
	return {
		provide: {
			appVersion: "0.0.1",
		},
	}
})
