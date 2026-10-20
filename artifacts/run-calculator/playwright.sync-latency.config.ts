import { defineConfig, devices } from "@playwright/test";
import { resolveChromiumExecutable } from "./e2e/chromium";
import { webkitLaunchOptions } from "./e2e/webkit-runtime";
import { releaseBrowserBaseUrl, releaseBrowserWebServers } from "./playwright.release-servers";

export default defineConfig({
  webServer: releaseBrowserWebServers(),
  testDir: "./e2e",
  testMatch: "sync-convergence.spec.ts",
  grep: /measures canonical edit and foreground recovery latency/,
  timeout: 120_000,
  globalTimeout: 12 * 60_000,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  outputDir: "test-results/sync-latency",
  use: {
    baseURL: releaseBrowserBaseUrl("http://127.0.0.1:18084"),
    serviceWorkers: "block",
    trace: "off",
    video: "off",
    screenshot: "only-on-failure",
  },
  projects: [
    ...[
      { name: "desktop-chromium", viewport: { width: 1280, height: 800 } },
      { name: "phone-chromium", viewport: { width: 390, height: 844 } },
      { name: "tablet-portrait-chromium", viewport: { width: 768, height: 1024 } },
      { name: "tablet-landscape-chromium", viewport: { width: 1024, height: 768 } },
    ].map(({ name, viewport }) => ({
      name, use: { ...devices["Desktop Chrome"], viewport, launchOptions: { executablePath: resolveChromiumExecutable() } },
    })),
    ...[
      { name: "phone-webkit", viewport: { width: 390, height: 844 } },
      { name: "tablet-webkit", viewport: { width: 810, height: 1080 } },
    ].map(({ name, viewport }) => ({
      name, use: { ...devices["Desktop Safari"], viewport, launchOptions: webkitLaunchOptions() },
    })),
  ],
});
