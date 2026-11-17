import { defineConfig } from "@playwright/test";
import qcConfig from "./playwright.qc-workflows.config";

export default defineConfig({
  ...qcConfig,
  testMatch: "qc-date-code-authenticated.spec.ts",
  timeout: 180_000,
  outputDir: "test-results/qc-date-code",
  use: { ...qcConfig.use, trace: "off", video: "off" },
});
