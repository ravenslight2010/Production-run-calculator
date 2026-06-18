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
    // Cold-start transforms + the mobile-module transpile in fillMissing.test.ts
    // can be slow, and validation runs alongside several dev workflows. Run test
    // files one at a time (avoids concurrent fork-worker startup starvation) and
    // give hooks/tests generous timeouts so the suite is reliable under load.
    fileParallelism: false,
    hookTimeout: 60000,
    testTimeout: 30000,
  },
});
