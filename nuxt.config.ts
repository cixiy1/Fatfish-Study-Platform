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
  compatibilityDate: '2024-04-03',
  app: {
    head: {
      htmlAttrs: {
        lang: 'zh-CN'
      }
    }
  },
})
