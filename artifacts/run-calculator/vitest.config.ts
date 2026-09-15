import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
    },
  },
  test: {
    environment: "jsdom",
    globals: false,
    include: ["src/**/*.test.{ts,tsx}"],
    // Keep file-level parallelism enabled so the full suite stays within the
    // validation budget, while bounding fork startup to avoid competing with
    // the other validation workflows.
    fileParallelism: true,
    maxWorkers: 4,
    hookTimeout: 60000,
    testTimeout: 30000,
  },
});
