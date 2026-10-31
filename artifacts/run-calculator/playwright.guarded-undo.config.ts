import { defineConfig, devices } from "@playwright/test";
import { resolveChromiumExecutable } from "./e2e/chromium";
import { webkitLaunchOptions } from "./e2e/webkit-runtime";
import { releaseBrowserBaseUrl, releaseBrowserWebServers } from "./playwright.release-servers";

const viewports = [
  { name: "desktop", viewport: { width: 1440, height: 1000 }, touch: false },
  { name: "phone", viewport: { width: 390, height: 844 }, touch: true },
  { name: "tablet-portrait", viewport: { width: 820, height: 1180 }, touch: true },
  { name: "tablet-landscape", viewport: { width: 1180, height: 820 }, touch: true },
] as const;

export default defineConfig({
  webServer: releaseBrowserWebServers(),
  testDir: "./e2e",
  testMatch: "guarded-undo.spec.ts",
  timeout: 240_000,
  globalTimeout: 35 * 60_000,
  retries: 0,
  workers: 1,
  fullyParallel: false,
  outputDir: "generated-artifacts/guarded-undo-browser/playwright-output",
  reporter: [["list"]],
  use: {
    baseURL: releaseBrowserBaseUrl(
      process.env.PLAYWRIGHT_BASE_URL ?? `https://${process.env.REPLIT_DEV_DOMAIN}`,
    ),
    headless: true,
    timezoneId: "UTC",
    serviceWorkers: "block",
    trace: "off",
    screenshot: "off",
    video: "off",
    actionTimeout: 25_000,
    navigationTimeout: 30_000,
  },
  projects: [
    ...viewports.map(({ name, viewport, touch }) => ({
      name: `${name}-chromium`,
      use: {
        ...devices["Desktop Chrome"],
        viewport,
        isMobile: touch,
        hasTouch: touch,
        launchOptions: { executablePath: resolveChromiumExecutable() },
      },
    })),
    ...viewports.map(({ name, viewport, touch }) => ({
      name: `${name}-webkit`,
      use: {
        ...devices["Desktop Safari"],
        viewport,
        isMobile: touch,
        hasTouch: touch,
        launchOptions: webkitLaunchOptions(),
      },
    })),
  ],
});
