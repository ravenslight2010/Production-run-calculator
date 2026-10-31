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
const viewports = [
  { name: "desktop", viewport: { width: 1440, height: 900 } },
  { name: "phone", viewport: { width: 390, height: 844 } },
  { name: "tablet-portrait", viewport: { width: 768, height: 1024 } },
  { name: "tablet-landscape", viewport: { width: 1024, height: 768 } },
] as const;

export default defineConfig({
  webServer: releaseBrowserWebServers(),
  testDir: "./e2e",
  testMatch: ["qc-allergen-activity-responsive.spec.ts", "qc-planning-authenticated.spec.ts", "qc-intelligence-authenticated.spec.ts"],
  timeout: 120_000,
  globalTimeout: 15 * 60_000,
  retries: 0,
  workers: 1,
  fullyParallel: false,
  outputDir: "test-results/qc-activity-compatibility",
  reporter: [["list"]],
  use: {
    baseURL,
    headless: true,
    trace: "off",
    screenshot: "off",
    video: "off",
    launchOptions: { executablePath: resolveChromiumExecutable() },
  },
  projects: [
    ...viewports.map(({ name, viewport }) => ({
      name: `${name}-chromium`,
      use: {
        ...devices["Desktop Chrome"],
        viewport,
        locale: "en-GB",
        timezoneId: "Pacific/Kiritimati",
      },
    })),
    ...viewports.map(({ name, viewport }) => ({
      name: `${name}-webkit`,
      use: {
        ...devices["Desktop Safari"],
        viewport,
        locale: "en-GB",
        timezoneId: "Pacific/Kiritimati",
        launchOptions: webkitLaunchOptions(),
      },
    })),
  ],
});
