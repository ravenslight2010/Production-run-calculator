import { defineConfig, devices } from "@playwright/test";
import { resolveChromiumExecutable } from "./e2e/chromium";
import { webkitLaunchOptions } from "./e2e/webkit-runtime";
import { requireDedicatedTestDatabase } from "./e2e/isolation";
import {
  releaseBrowserBaseUrl,
  releaseBrowserWebServers,
} from "./playwright.release-servers";

const baseURL = releaseBrowserBaseUrl(
  process.env.PLAYWRIGHT_BASE_URL
  ?? (process.env.REPLIT_DEV_DOMAIN
    ? `https://${process.env.REPLIT_DEV_DOMAIN}`
    : "http://127.0.0.1:5173"),
);
const chromiumLaunch = { executablePath: resolveChromiumExecutable() };
const webkitLaunch = webkitLaunchOptions();

// The isolated runner owns a disposable PostgreSQL database and local API.
requireDedicatedTestDatabase("Schedule dialog-layering Playwright setup");

export default defineConfig({
  webServer: releaseBrowserWebServers(),
  testDir: "./e2e",
  testMatch: "schedule-dialog-layering.spec.ts",
  timeout: 120_000,
  globalTimeout: 18 * 60_000,
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  outputDir: "test-results/schedule-dialog-layering",
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
      name: "desktop-chromium",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: chromiumLaunch,
      },
    },
    {
      name: "phone-chromium",
      use: {
        ...devices["Pixel 5"],
        launchOptions: chromiumLaunch,
      },
    },
    {
      name: "tablet-portrait-chromium",
      use: {
        ...devices["iPad (gen 7)"],
        browserName: "chromium",
        launchOptions: chromiumLaunch,
      },
    },
    {
      name: "tablet-landscape-chromium",
      use: {
        ...devices["iPad (gen 7) landscape"],
        browserName: "chromium",
        launchOptions: chromiumLaunch,
      },
    },
    {
      name: "desktop-webkit",
      use: {
        ...devices["Desktop Safari"],
        ...(webkitLaunch ? { launchOptions: webkitLaunch } : {}),
      },
    },
    {
      name: "phone-webkit",
      use: {
        ...devices["iPhone 13"],
        ...(webkitLaunch ? { launchOptions: webkitLaunch } : {}),
      },
    },
    {
      name: "tablet-portrait-webkit",
      use: {
        ...devices["iPad (gen 7)"],
        ...(webkitLaunch ? { launchOptions: webkitLaunch } : {}),
      },
    },
    {
      name: "tablet-landscape-webkit",
      use: {
        ...devices["iPad (gen 7) landscape"],
        ...(webkitLaunch ? { launchOptions: webkitLaunch } : {}),
      },
    },
  ],
});
