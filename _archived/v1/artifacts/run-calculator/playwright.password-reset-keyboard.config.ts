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

export default defineConfig({
  webServer: releaseBrowserWebServers(),
  testDir: "./e2e",
  testMatch: "manager-attention.spec.ts",
  grep: /manager can approve and decline password resets by keyboard and retain useful focus/,
  timeout: 150_000,
  globalTimeout: 30 * 60_000,
  retries: 0,
  workers: 1,
  fullyParallel: false,
  outputDir: "test-results/password-reset-keyboard",
  reporter: [["list"]],
  use: {
    baseURL,
    headless: true,
    serviceWorkers: "block",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },
  projects: [
    ...[
      { name: "desktop-chromium", viewport: { width: 1440, height: 1000 } },
      { name: "phone-chromium", viewport: { width: 390, height: 844 } },
      { name: "tablet-portrait-chromium", viewport: { width: 768, height: 1024 } },
      { name: "tablet-landscape-chromium", viewport: { width: 1024, height: 768 } },
    ].map(({ name, viewport }) => ({
      name,
      use: {
        ...devices["Desktop Chrome"],
        viewport,
        launchOptions: { executablePath: resolveChromiumExecutable() },
      },
    })),
    {
      name: "desktop-webkit",
      use: {
        ...devices["Desktop Safari"],
        launchOptions: webkitLaunchOptions(),
      },
    },
  ],
});
