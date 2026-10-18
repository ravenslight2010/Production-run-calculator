import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["load-tests/api-load.test.ts"],
    testTimeout: 180_000,
    hookTimeout: 45_000,
    minWorkers: 1,
    maxWorkers: 1,
  },
});
