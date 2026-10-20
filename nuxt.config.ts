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
  // 开发期允许任意来源拉取 /_nuxt 模块。
  // Vite 默认只放行 localhost 来源，用 file:// 或沙箱 iframe（内嵌预览面板）打开时
  // 请求带的是 Origin: null，会被 CORS 拦掉，模块加载不全 → 应用初始化报错、白屏。
  vite: {
    server: {
      cors: { origin: true },
    },
  },
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
      ],
      // 兜底：在 file:// 或沙箱 iframe（内嵌预览）里读 localStorage 会抛 SecurityError，
      // 而 @vue/devtools-kit 在模块加载阶段就会读它，会直接打断应用初始化（NUXT_E1005）。
      // 正常浏览器读得到，脚本什么都不做；读不到就补一个内存版实现。
      script: [
        {
          innerHTML: `(function(){var ok=!0;try{void window.localStorage}catch(e){ok=!1}if(ok)return;var mk=function(){var d={};return{getItem:function(k){return Object.prototype.hasOwnProperty.call(d,k)?d[k]:null},setItem:function(k,v){d[String(k)]=String(v)},removeItem:function(k){delete d[k]},clear:function(){d={}},key:function(i){return Object.keys(d)[i]||null},get length(){return Object.keys(d).length}}};try{Object.defineProperty(window,"localStorage",{configurable:!0,value:mk()})}catch(e){}try{Object.defineProperty(window,"sessionStorage",{configurable:!0,value:mk()})}catch(e){}})();`,
        },
      ]
    }
  },
})
