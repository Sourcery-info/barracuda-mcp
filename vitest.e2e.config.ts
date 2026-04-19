import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/e2e/**/*.e2e.test.ts"],
    setupFiles: ["test/e2e/setup-env.ts"],
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
