import { defineConfig, devices } from "@playwright/test";
import { resolveChromiumExecutable } from "./e2e/chromium";
import { webkitLaunchOptions } from "./e2e/webkit-runtime";
import {
  releaseBrowserBaseUrl,
  releaseBrowserWebServers,
} from "./playwright.release-servers";

const viewports = [
  { name: "desktop", viewport: { width: 1280, height: 800 } },
  { name: "phone", viewport: { width: 390, height: 844 } },
  { name: "tablet-portrait", viewport: { width: 768, height: 1024 } },
  { name: "tablet-landscape", viewport: { width: 1024, height: 768 } },
] as const;

export default defineConfig({
  webServer: releaseBrowserWebServers(),
  testDir: "./e2e",
  testMatch: "line-map-responsive.spec.ts",
  timeout: 75_000,
  globalTimeout: 15 * 60_000,
  retries: 0,
  workers: 1,
  outputDir: "test-results/line-map",
  reporter: [["list"]],
  use: {
    baseURL: releaseBrowserBaseUrl(
      process.env.PLAYWRIGHT_BASE_URL ?? `https://${process.env.REPLIT_DEV_DOMAIN}`,
    ),
    headless: true,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },
  projects: [
    ...viewports.map(({ name, viewport }) => ({
      name: `${name}-chromium`,
      use: {
        ...devices["Desktop Chrome"],
        viewport,
        launchOptions: { executablePath: resolveChromiumExecutable() },
      },
    })),
    ...viewports.map(({ name, viewport }) => ({
      name: `${name}-webkit`,
      use: {
        ...devices["Desktop Safari"],
        viewport,
        launchOptions: webkitLaunchOptions(),
      },
    })),
  ],
});
