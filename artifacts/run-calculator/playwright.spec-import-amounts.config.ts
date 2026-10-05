import { defineConfig, devices } from "@playwright/test";
import { resolveChromiumExecutable } from "./e2e/chromium";
import { webkitLaunchOptions } from "./e2e/webkit-runtime";
import {
  releaseBrowserBaseUrl,
  releaseBrowserWebServers,
} from "./playwright.release-servers";

const baseURL = releaseBrowserBaseUrl(
  process.env.PLAYWRIGHT_BASE_URL ?? `https://${process.env.REPLIT_DEV_DOMAIN}`,
);

/**
 * Focused responsive browser coverage for spec-import amount advisories.
 * Each browser project runs the same review journey at tablet portrait and
 * landscape sizes without inheriting the full suite's live-day setup.
 */
export default defineConfig({
  webServer: releaseBrowserWebServers(),
  testDir: "./e2e",
  testMatch: "spec-import-unit-provenance.spec.ts",
  timeout: 90_000,
  globalTimeout: 12 * 60_000,
  retries: 0,
  workers: 1,
  outputDir: "test-results/spec-import-amounts",
  reporter: [["list"]],
  use: {
    baseURL,
    headless: true,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },
  projects: [
    {
      name: "tablet-chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 768, height: 1024 },
        launchOptions: { executablePath: resolveChromiumExecutable() },
      },
    },
    {
      name: "tablet-webkit",
      use: {
        ...devices["Desktop Safari"],
        viewport: { width: 768, height: 1024 },
        launchOptions: webkitLaunchOptions(),
      },
    },
  ],
});
