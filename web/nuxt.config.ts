// Tri-Tri の画面(Nuxt 4 / Vue 3)
// ブラウザだけで動く画面(SPA)として作り、本番は静的ファイルにして S3 + CloudFront で配る。
export default defineNuxtConfig({
  compatibilityDate: "2026-11-01",
  ssr: false,
  // ブラウザ操作テストは別の作業フォルダで動かす(手元の開発用サーバーを止めずにテストできるように)
  ...(process.env.NUXT_BUILD_DIR ? { buildDir: process.env.NUXT_BUILD_DIR } : {}),
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
      // Google マップの API キー(NUXT_PUBLIC_GOOGLE_MAPS_API_KEY)。空なら仮の地図で動く。
      // 画面に埋め込まれて誰でも見られるので、Google Cloud でリファラーと API の種類を必ず制限する
      googleMapsApiKey: "",
      // 地図のスタイルの ID(NUXT_PUBLIC_GOOGLE_MAPS_MAP_ID)。空なら Google の試用 ID を使う
      googleMapsMapId: "",
    },
  },
  typescript: {
    strict: true,
  },
});
