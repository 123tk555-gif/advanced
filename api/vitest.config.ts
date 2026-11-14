import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "api",
    globalSetup: ["./test/global-setup.ts"],
  },
});
