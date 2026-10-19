export default defineNuxtRouteMiddleware((to) => {
	// 全局中间件必须是有效模块并导出函数；空文件会让 #build/middleware 生成失败，所有路由直接 500
	// TODO: 接入登录态后在此校验，例如：
	// const { loggedIn } = useUserSession()
	// if (!loggedIn.value && to.path !== '/login') return navigateTo('/login')
	void to
})
