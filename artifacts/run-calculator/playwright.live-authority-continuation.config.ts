import { defineConfig } from "@playwright/test";
import { resolveChromiumExecutable } from "./e2e/chromium";
import { webkitLaunchOptions } from "./e2e/webkit-runtime";
import {
  releaseBrowserBaseUrl,
  releaseBrowserWebServers,
} from "./playwright.release-servers";
import { selectLiveAuthorityContinuationCase } from "./e2e/liveAuthorityContinuationPlan";

process.env.BUILD_IDENTITY_MODE = "development";

const viewports = [
  ["desktop", 1440, 1000],
  ["phone", 390, 844],
  ["tablet-portrait", 768, 1024],
  ["tablet-landscape", 1024, 768],
] as const;

const { name: remainingCase, plan: casePlan } =
  selectLiveAuthorityContinuationCase(process.env.LIVE_AUTHORITY_CASE);

const allProjects = (["chromium", "webkit"] as const).flatMap((browserName) =>
  viewports.map(([size, width, height]) => ({
    name: `${browserName}-${size}`,
    use: {
      browserName,
      viewport: { width, height },
      launchOptions: browserName === "chromium"
        ? { executablePath: resolveChromiumExecutable() }
        : webkitLaunchOptions(),
    },
  })),
);
const selectedProjects = allProjects.filter((project) => project.name === casePlan.project);
const evidenceId = process.env.LIVE_AUTHORITY_EVIDENCE_ID
  ?? new Date().toISOString().replace(/[^a-zA-Z0-9_-]/g, "_");
if (!/^[a-zA-Z0-9_-]{1,100}$/.test(evidenceId)) {
  throw new Error("LIVE_AUTHORITY_EVIDENCE_ID must be a bounded safe filename component.");
}
// Workers must inherit the runner's ID instead of generating new output paths.
process.env.LIVE_AUTHORITY_EVIDENCE_ID = evidenceId;

export default defineConfig({
  webServer: releaseBrowserWebServers(),
  testDir: "./e2e",
  testMatch: "live-authority-continuation.spec.ts",
  timeout: 120_000,
  expect: { timeout: 8_000 },
  globalTimeout: 25 * 60_000,
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: [["list"]],
  outputDir: `test-results/live-authority-remaining-${remainingCase}-${evidenceId}`,
  use: {
    baseURL: releaseBrowserBaseUrl("http://127.0.0.1:18084"),
    timezoneId: "America/Chicago",
    actionTimeout: 8_000,
    navigationTimeout: 12_000,
    serviceWorkers: "allow",
    trace: "off",
    video: "off",
    screenshot: "off",
  },
  projects: selectedProjects,
});
