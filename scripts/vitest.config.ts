import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const reporters = process.env.TEST_RESULTS_VITEST_COUNTS_DIR
  ? [
      "default",
      fileURLToPath(
        new URL("./src/vitest-count-reporter.mjs", import.meta.url),
      ),
    ]
  : undefined;

export default defineConfig({
  test: {
    reporters,
  },
});
