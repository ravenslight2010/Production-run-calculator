import { resolve } from "node:path";
import { defineConfig } from "@playwright/test";
import qcConfig from "./playwright.qc-workflows.config";

const evidenceDir = resolve(process.cwd(), "../../.local/tasks/evidence/qc-slice-4-import-review");

export default defineConfig({
  ...qcConfig,
  testMatch: [
    "qc-import-review-authenticated.spec.ts",
    "qc-import-review-reload-badge.spec.ts",
  ],
  timeout: 240_000,
  outputDir: resolve(evidenceDir, "playwright-output"),
  use: { ...qcConfig.use, trace: "off", screenshot: "off", video: "off" },
});
