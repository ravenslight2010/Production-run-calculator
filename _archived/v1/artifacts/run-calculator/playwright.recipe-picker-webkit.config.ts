import { defineConfig, devices } from "@playwright/test";
import { webkitLaunchOptions } from "./e2e/webkit-runtime";
import {
  releaseBrowserBaseUrl,
  releaseBrowserWebServers,
} from "./playwright.release-servers";

const baseURL = releaseBrowserBaseUrl(
  process.env.PLAYWRIGHT_BASE_URL ?? `https://${process.env.REPLIT_DEV_DOMAIN}`,
);

/**
 * Focused Safari-emulated coverage for shared recipe selectors. Each project
 * runs the same isolated setup/live-run journey at a distinct viewport/input
 * profile; none of these projects represents a physical iOS device.
 */
export default defineConfig({
  webServer: releaseBrowserWebServers(),
  testDir: "./e2e",
  testMatch: "recipe-picker-webkit.spec.ts",
  timeout: 120_000,
  globalTimeout: 12 * 60_000,
  retries: 0,
  workers: 1,
  outputDir: "test-results/recipe-picker-webkit",
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
    {
      name: "desktop-safari",
      use: {
        ...devices["Desktop Safari"],
        launchOptions: webkitLaunchOptions(),
      },
    },
    {
      name: "phone-safari",
      use: {
        ...devices["iPhone 13"],
        launchOptions: webkitLaunchOptions(),
      },
    },
    {
      name: "tablet-portrait-safari",
      use: {
        ...devices["iPad (gen 7)"],
        launchOptions: webkitLaunchOptions(),
      },
    },
    {
      name: "tablet-landscape-safari",
      use: {
        ...devices["iPad (gen 7) landscape"],
        launchOptions: webkitLaunchOptions(),
      },
    },
  ],
});
