import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    /** Real OpenAleph HTTP calls live under `test/e2e/` — use `npm run test:e2e`. */
    exclude: ["test/e2e/**"],
  },
});
