import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Integration tests each spin up a throwaway Postgres DB via push-force.
    // Under full-suite parallelism the concurrent setup can take longer than the
    // per-hook default (10 s) — raise it so no beforeAll races the clock.
    hookTimeout: 120_000,
  },
});
