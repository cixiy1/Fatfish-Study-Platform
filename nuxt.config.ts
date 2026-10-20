// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  modules: [
    '@nuxt/content',
    '@nuxt/a11y',
    '@nuxt/eslint',
    '@nuxt/hints',
    '@nuxt/image',
    '@nuxt/test-utils/module',
    '@nuxt/ui',
  ],
  devtools: { enabled: true },
  css: ["~/assets/css/main.css"],
  // 图标本地化：不再依赖 api.iconify.design，演示现场网络不稳时图标也不会丢
  icon: {
    serverBundle: { collections: ["lucide"] },
    clientBundle: { scan: true, sizeLimitKb: 512 },
  },
  compatibilityDate: '2024-04-03',
  app: {
    head: {
      htmlAttrs: {
        lang: 'zh-CN'
      },
      // 站点图标：public/ 下由同一张插画切出，ICO 内嵌 16/32/48 三档
      link: [
        { rel: 'icon', type: 'image/x-icon', href: '/favicon.ico' },
        { rel: 'icon', type: 'image/png', sizes: '32x32', href: '/favicon-32x32.png' },
        { rel: 'icon', type: 'image/png', sizes: '96x96', href: '/favicon-96x96.png' },
        { rel: 'apple-touch-icon', sizes: '180x180', href: '/apple-touch-icon.png' },
        { rel: 'manifest', href: '/site.webmanifest' },
      ],
      meta: [
        { name: 'theme-color', content: '#0d9488' }
      ]
    }
  },
})
