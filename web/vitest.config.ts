import { defineConfig } from "vitest/config";

/** 画面の部品のうち、純粋な計算(app/utils)の単体テスト */
export default defineConfig({
  test: {
    name: "web",
    include: ["app/**/*.test.ts"],
  },
});
