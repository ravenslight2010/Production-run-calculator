import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // The evaluation-manifest case hashes every retained workbook (and the
    // evaluator sources) before comparing against the checked-in snapshot, so
    // it needs longer than Vitest's five-second per-test default once the
    // release check runs it under CPU contention. This bound lives here, not in
    // src/, because lib/corpus-harness/src is itself hashed into
    // snapshots/evaluation-manifest.json — editing a test there changes the
    // evaluator hash and breaks that snapshot.
    testTimeout: 30_000,
  },
});
