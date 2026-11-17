import { defineConfig, devices } from "@playwright/test";
import { webkitLaunchOptions } from "./e2e/webkit-runtime";
import {
  releaseBrowserBaseUrl,
  releaseBrowserWebServers,
} from "./playwright.release-servers";

const baseURL = releaseBrowserBaseUrl(
  process.env.PLAYWRIGHT_BASE_URL ?? `https://${process.env.REPLIT_DEV_DOMAIN}`,
);

export default defineConfig({
  webServer: releaseBrowserWebServers(),
  testDir: "./e2e",
  testMatch: "workbook-auto-ai-fallback.spec.ts",
  globalSetup: "./e2e/global-setup.ts",
  timeout: 4 * 60_000,
  globalTimeout: 15 * 60_000,
  retries: 0,
  workers: 1,
  outputDir: "test-results/workbook-webkit",
  reporter: [
    ["list"],
    ["./e2e/release-browser-evidence-reporter.ts"],
  ],
  use: {
    baseURL,
    headless: true,
    serviceWorkers: "block",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
    launchOptions: webkitLaunchOptions(),
  },
  projects: [
    {
      name: "webkit",
      use: { ...devices["Desktop Safari"] },
    },
  ],
});
