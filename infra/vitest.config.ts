import { defineConfig } from "vitest/config";

/** 作る AWS の資源の形のテスト(テンプレートを作るだけで、AWS にはつながない) */
export default defineConfig({
  test: {
    name: "infra",
    include: ["test/**/*.test.ts"],
    testTimeout: 300_000,
  },
});
