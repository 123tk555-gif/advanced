import { defineConfig, devices } from "@playwright/test";

/**
 * ブラウザでの操作テスト。開発用 API と画面を、テスト専用のポートとテーブルで起動する
 * (普段の開発用データ・開発サーバーとぶつからないように)。
 * 先に docker compose up -d dynamodb が必要。
 * 手元では、インストール済みの Chrome を使う(PW_CHANNEL=chrome)。CI では Playwright の Chromium を使う。
 */
const API_PORT = 8788;
const WEB_PORT = 3001;
const WEB = `http://localhost:${WEB_PORT}`;

export default defineConfig({
  testDir: "./tests",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: WEB,
    locale: "ja-JP",
    timezoneId: "Asia/Tokyo",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        ...(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {}),
      },
    },
  ],
  webServer: [
    {
      command: "corepack pnpm --filter @tritri/api exec tsx src/dev-server.ts",
      // ログインなしで /me を呼ぶと 401 が返る。それを「起動した」の合図にする
      url: `http://127.0.0.1:${API_PORT}/me`,
      cwd: "..",
      env: {
        PORT: String(API_PORT),
        TABLE_NAME: "tritri-e2e",
        WEB_ORIGIN: WEB,
      },
      timeout: 60_000,
      reuseExistingServer: false,
    },
    {
      command: `corepack pnpm --filter @tritri/web exec nuxt dev --port ${WEB_PORT}`,
      url: WEB,
      cwd: "..",
      env: {
        NUXT_PUBLIC_API_BASE: `http://127.0.0.1:${API_PORT}`,
        // web/.env に Google マップのキーがあっても、テストでは仮の地図を使う(料金の枠を使わない・結果が毎回同じ)
        NUXT_PUBLIC_GOOGLE_MAPS_API_KEY: "",
        // 手元で動いている開発用サーバー(.nuxt を使う)とぶつからないよう、別の作業フォルダを使う
        NUXT_BUILD_DIR: ".nuxt-e2e",
      },
      timeout: 180_000,
      reuseExistingServer: false,
    },
  ],
});
