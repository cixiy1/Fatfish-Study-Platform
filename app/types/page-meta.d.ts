declare module "#app" {
	interface PageMeta {
		/** true = 必须登录；false = 显式公开，优先级高于全局默认策略 */
		auth?: boolean
		/** true = 仅游客可见（已登录访问会被弹回站内），登录/注册页用 */
		guestOnly?: boolean
	}
}

declare module "vue-router" {
	interface RouteMeta {
		auth?: boolean
		guestOnly?: boolean
	}
}

export {}
