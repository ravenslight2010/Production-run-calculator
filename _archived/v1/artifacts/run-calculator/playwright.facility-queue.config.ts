import { defineConfig } from "@playwright/test";
import compatibility from "./playwright.compatibility.config";

// Same isolated API-backed reconnect regression across both engines and all
// supported viewport classes. This is emulation, not physical-device evidence.
export default defineConfig({
  ...compatibility,
  testMatch: ["home-deferred-panels.spec.ts"],
  grep: /independent facility edit progresses/,
  globalTimeout: 15 * 60_000,
  outputDir: "test-results/facility-queue",
  reporter: [["list"]],
  projects: compatibility.projects!.map((project) => ({
    ...project,
    testMatch: ["home-deferred-panels.spec.ts"],
    grepInvert: undefined,
  })),
});
