import { defineConfig, devices } from "@playwright/test";
import { resolveChromiumExecutable } from "./e2e/chromium";
import { webkitLaunchOptions } from "./e2e/webkit-runtime";
import {
  releaseBrowserBaseUrl,
  releaseBrowserWebServers,
} from "./playwright.release-servers";

export default defineConfig({
  webServer: releaseBrowserWebServers(),
  testDir: "./e2e",
  testMatch: "manager-attention.spec.ts",
  grep: /manager-attention badges show full counts at desktop, phone, and tablet widths/,
  timeout: 120_000,
  globalTimeout: 15 * 60_000,
  retries: 0,
  workers: 1,
  fullyParallel: false,
  reporter: "list",
  outputDir: "test-results/manager-attention-counts",
  use: {
    baseURL: releaseBrowserBaseUrl(
      process.env.PLAYWRIGHT_BASE_URL ?? `https://${process.env.REPLIT_DEV_DOMAIN}`,
    ),
    headless: true,
    serviceWorkers: "block",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: { executablePath: resolveChromiumExecutable() },
      },
    },
    {
      name: "webkit",
      use: {
        ...devices["Desktop Safari"],
        launchOptions: webkitLaunchOptions(),
      },
    },
  ],
});
