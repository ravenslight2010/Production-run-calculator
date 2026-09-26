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

/**
 * Bounded browser-engine and responsive compatibility lane.
 *
 * The Chromium projects reuse the isolated cross-device lifecycle journey.
 * The WebKit projects reuse the isolated WebKit release smoke. Both specs own
 * their disposable-day setup and user cleanup; this config adds no destructive
 * global setup and runs every project serially.
 *
 * These are responsive browser emulations. They do not represent physical
 * Android Chrome or iOS Safari/PWA evidence; those checks stay in the
 * environment-dependent device lanes.
 */
export default defineConfig({
  webServer: releaseBrowserWebServers(),
  testDir: "./e2e",
  testMatch: ["cross-device-smoke.spec.ts", "release-webkit-smoke.spec.ts"],
  timeout: 75_000,
  globalTimeout: 15 * 60_000,
  retries: 0,
  workers: 1,
  fullyParallel: false,
  outputDir: "test-results/compatibility",
  reporter: [
    ["list"],
    ["html", { outputFolder: "playwright-report/compatibility", open: "never" }],
  ],
  use: {
    baseURL,
    headless: true,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
    launchOptions: {
      executablePath: resolveChromiumExecutable(),
    },
  },
  projects: [
    {
      name: "desktop-chromium",
      testMatch: "cross-device-smoke.spec.ts",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "phone-chromium",
      testMatch: "cross-device-smoke.spec.ts",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 390, height: 844 },
      },
    },
    {
      name: "tablet-portrait-chromium",
      testMatch: "cross-device-smoke.spec.ts",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 768, height: 1024 },
      },
    },
    {
      name: "tablet-landscape-chromium",
      testMatch: "cross-device-smoke.spec.ts",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1024, height: 768 },
      },
    },
    {
      name: "phone-webkit",
      testMatch: "release-webkit-smoke.spec.ts",
      // The dedicated WebKit command owns the full sync-recovery contract.
      // Keep this bounded compatibility lane focused on the shared lifecycle
      // and report journey at a phone-sized WebKit viewport.
      grepInvert: /recovers a failed sync pull/,
      use: {
        ...devices["Desktop Safari"],
        viewport: { width: 390, height: 844 },
        launchOptions: webkitLaunchOptions(),
      },
    },
    {
      name: "tablet-webkit",
      testMatch: "release-webkit-smoke.spec.ts",
      grepInvert: /recovers a failed sync pull/,
      use: {
        ...devices["Desktop Safari"],
        viewport: { width: 810, height: 1080 },
        launchOptions: webkitLaunchOptions(),
      },
    },
  ],
});