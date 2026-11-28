import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

/**
 * メールアドレスとパスワードのログイン(会員登録・確認コード・パスワードの再設定・退会)の E2E。
 * Cognito の代わりに、画面の試験用のログイン(NUXT_PUBLIC_AUTH_MODE=fake)を使う。
 * ふつうの E2E とぶつからないよう、別のポート・テーブル・作業フォルダで起動する。
 */
const API_PORT = 8789;
const WEB_PORT = 3002;
const WEB = `http://localhost:${WEB_PORT}`;

const [api, web] = base.webServer as [Record<string, unknown>, Record<string, unknown>];

export default defineConfig({
  ...base,
  testDir: "./tests-auth",
  use: { ...base.use, baseURL: WEB },
  webServer: [
    {
      ...api,
      url: `http://127.0.0.1:${API_PORT}/me`,
      env: { PORT: String(API_PORT), TABLE_NAME: "tritri-e2e-auth", WEB_ORIGIN: WEB },
    },
    {
      ...web,
      command: `corepack pnpm --filter @tritri/web exec nuxt dev --port ${WEB_PORT}`,
      url: WEB,
      env: {
        NUXT_PUBLIC_API_BASE: `http://127.0.0.1:${API_PORT}`,
        NUXT_PUBLIC_GOOGLE_MAPS_API_KEY: "",
        NUXT_PUBLIC_AUTH_MODE: "fake",
        NUXT_BUILD_DIR: ".nuxt-e2e-auth",
      },
    },
  ],
});
