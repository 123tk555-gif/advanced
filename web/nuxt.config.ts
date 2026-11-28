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
      // リアルタイム更新の WebSocket の URL(NUXT_PUBLIC_WS_URL)。空なら API の場所の /ws(手元の開発用)
      wsUrl: "",
      // Google マップの API キー(NUXT_PUBLIC_GOOGLE_MAPS_API_KEY)。空なら仮の地図で動く。
      // 画面に埋め込まれて誰でも見られるので、Google Cloud でリファラーと API の種類を必ず制限する
      googleMapsApiKey: "",
      // 地図のスタイルの ID(NUXT_PUBLIC_GOOGLE_MAPS_MAP_ID)。空なら Google の試用 ID を使う
      googleMapsMapId: "",
      // ログインの仕組み。Cognito のユーザープール ID とアプリのクライアント ID があれば本番のログイン
      // (NUXT_PUBLIC_COGNITO_USER_POOL_ID・NUXT_PUBLIC_COGNITO_CLIENT_ID。どちらも画面に埋め込まれて構わない値)
      cognitoUserPoolId: "",
      cognitoClientId: "",
      // Cognito が無いときの仕組み(NUXT_PUBLIC_AUTH_MODE)。"fake" なら試験用のメールとパスワードのログイン、
      // 空なら開発用(利用者 ID と表示名だけ)
      authMode: "",
    },
  },
  typescript: {
    strict: true,
  },
});
