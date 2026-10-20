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
const chromiumLaunchOptions = { executablePath: resolveChromiumExecutable() };

/**
 * Exercise the same confirmed flavor-merge and follow-up-suggestion journey in
 * both engines across desktop, phone, and tablet orientations.
 */
export default defineConfig({
  webServer: releaseBrowserWebServers(),
  testDir: "./e2e",
  testMatch: ["merge-alias-retarget.spec.ts"],
  timeout: 120_000,
  globalTimeout: 30 * 60_000,
  retries: 0,
  workers: 1,
  fullyParallel: false,
  outputDir: "test-results/merge-alias-compatibility",
  reporter: [["list"]],
  use: {
    baseURL,
    headless: true,
    trace: "off",
    screenshot: "off",
    video: "off",
  },
  projects: [
    {
      name: "desktop-chromium",
      use: { ...devices["Desktop Chrome"], launchOptions: chromiumLaunchOptions },
    },
    {
      name: "phone-chromium",
      use: {
        ...devices["Pixel 7"],
        launchOptions: chromiumLaunchOptions,
      },
    },
    {
      name: "tablet-portrait-chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 768, height: 1024 },
        launchOptions: chromiumLaunchOptions,
      },
    },
    {
      name: "tablet-landscape-chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1024, height: 768 },
        launchOptions: chromiumLaunchOptions,
      },
    },
    {
      name: "desktop-webkit",
      use: { ...devices["Desktop Safari"], launchOptions: webkitLaunchOptions() },
    },
    {
      name: "phone-webkit",
      use: { ...devices["iPhone 13"], launchOptions: webkitLaunchOptions() },
    },
    {
      name: "tablet-portrait-webkit",
      use: {
        ...devices["Desktop Safari"],
        viewport: { width: 768, height: 1024 },
        launchOptions: webkitLaunchOptions(),
      },
    },
    {
      name: "tablet-landscape-webkit",
      use: {
        ...devices["Desktop Safari"],
        viewport: { width: 1024, height: 768 },
        launchOptions: webkitLaunchOptions(),
      },
    },
  ],
});
