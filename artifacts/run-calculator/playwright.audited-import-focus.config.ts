import { defineConfig, devices } from "@playwright/test";
import { resolveChromiumExecutable } from "./e2e/chromium";
import {
  releaseBrowserBaseUrl,
  releaseBrowserWebServers,
} from "./playwright.release-servers";

const baseURL = releaseBrowserBaseUrl(
  process.env.PLAYWRIGHT_BASE_URL ?? `https://${process.env.REPLIT_DEV_DOMAIN}`,
);

export default defineConfig({
  webServer: releaseBrowserWebServers("source"),
  testDir: "./e2e",
  testMatch: "task3494-audited-import.spec.ts",
  timeout: 180_000,
  globalTimeout: 12 * 60_000,
  retries: 0,
  workers: 1,
  outputDir: "test-results/audited-import-focus",
  reporter: "list",
  use: {
    baseURL,
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
  ],
});
