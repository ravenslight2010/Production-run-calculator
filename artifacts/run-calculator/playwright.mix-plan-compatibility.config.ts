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
const webkitOptions = webkitLaunchOptions();

export default defineConfig({
  webServer: releaseBrowserWebServers(),
  testDir: "./e2e",
  testMatch: "mix-plan.spec.ts",
  timeout: 90_000,
  globalTimeout: 15 * 60_000,
  retries: 0,
  workers: 1,
  fullyParallel: false,
  outputDir: "test-results/mix-plan-compatibility",
  reporter: "list",
  use: {
    baseURL,
    headless: true,
    trace: "retain-on-failure",
    screenshot: "off",
    video: "off",
  },
  projects: [
    {
      name: "desktop-chromium",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: { executablePath: resolveChromiumExecutable() },
      },
    },
    {
      name: "phone-chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 390, height: 844 },
        launchOptions: { executablePath: resolveChromiumExecutable() },
      },
    },
    {
      name: "tablet-portrait-chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 768, height: 1024 },
        launchOptions: { executablePath: resolveChromiumExecutable() },
      },
    },
    {
      name: "tablet-landscape-chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1024, height: 768 },
        launchOptions: { executablePath: resolveChromiumExecutable() },
      },
    },
    {
      name: "desktop-webkit",
      use: {
        ...devices["Desktop Safari"],
        ...(webkitOptions ? { launchOptions: webkitOptions } : {}),
      },
    },
    {
      name: "phone-webkit",
      use: {
        ...devices["Desktop Safari"],
        viewport: { width: 390, height: 844 },
        ...(webkitOptions ? { launchOptions: webkitOptions } : {}),
      },
    },
    {
      name: "tablet-portrait-webkit",
      use: {
        ...devices["Desktop Safari"],
        viewport: { width: 768, height: 1024 },
        ...(webkitOptions ? { launchOptions: webkitOptions } : {}),
      },
    },
    {
      name: "tablet-landscape-webkit",
      use: {
        ...devices["Desktop Safari"],
        viewport: { width: 1024, height: 768 },
        ...(webkitOptions ? { launchOptions: webkitOptions } : {}),
      },
    },
  ],
});
