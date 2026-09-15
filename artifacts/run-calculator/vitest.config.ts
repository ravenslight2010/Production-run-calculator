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
    // Worker threads avoid the child-process startup overhead of the default
    // fork pool without changing Vitest's per-file environment isolation.
    pool: "threads",
    isolate: true,
    // Keep file-level parallelism enabled and use the validated four-worker
    // ceiling. The budget wrapper rejects runners with fewer than four
    // available workers; the two-worker suite is outside the 150-second
    // validation budget.
    fileParallelism: true,
    maxWorkers: 4,
    hookTimeout: 60000,
    testTimeout: 30000,
  },
});
