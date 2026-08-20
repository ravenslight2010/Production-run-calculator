import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Integration tests each spin up a throwaway Postgres DB via push-force.
    // Their marker-guarded data-heal assertions can also run longer than
    // Vitest's five-second per-test default. If one is interrupted mid-query,
    // subsequent cleanup races its still-active work and produces false
    // duplicate-marker/deadlock failures. Thirty seconds leaves room for the
    // observed work without turning a real lock problem into a long stall.
    hookTimeout: 120_000,
    testTimeout: 30_000,
  },
});
