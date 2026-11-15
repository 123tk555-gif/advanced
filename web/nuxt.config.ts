// Tri-Tri の画面(Nuxt 4 / Vue 3)
// ブラウザだけで動く画面(SPA)として作り、本番は静的ファイルにして S3 + CloudFront で配る。
export default defineNuxtConfig({
  compatibilityDate: "2026-11-01",
  ssr: false,
  devtools: { enabled: false },
  telemetry: false,
  css: ["~/assets/css/main.css"],
  app: {
    head: {
      htmlAttrs: { lang: "ja" },
      title: "Tri-Tri",
      meta: [{ name: "viewport", content: "width=device-width, initial-scale=1" }],
    },
  },
  runtimeConfig: {
    public: {
      // API の場所。手元の開発では開発用 API サーバー。NUXT_PUBLIC_API_BASE で上書きできる
      apiBase: "http://127.0.0.1:8787",
    },
  },
  typescript: {
    strict: true,
  },
});
