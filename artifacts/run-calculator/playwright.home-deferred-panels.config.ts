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
  testMatch: "home-deferred-panels.spec.ts",
  timeout: 75_000,
  globalTimeout: 15 * 60_000,
  retries: 0,
  workers: 1,
  outputDir: "test-results/home-deferred-panels",
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
    ...[
      { name: "desktop-chromium", viewport: { width: 1440, height: 900 } },
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
    ...[
      { name: "desktop-webkit", viewport: { width: 1440, height: 900 } },
      { name: "phone-webkit", viewport: { width: 390, height: 844 } },
      { name: "tablet-portrait-webkit", viewport: { width: 768, height: 1024 } },
      { name: "tablet-landscape-webkit", viewport: { width: 1024, height: 768 } },
    ].map(({ name, viewport }) => ({
      name,
      use: {
        ...devices["Desktop Safari"],
        viewport,
        launchOptions: webkitLaunchOptions(),
      },
    })),
  ],
});
