import { defineConfig, devices } from "@playwright/test";
import { resolveChromiumExecutable } from "./e2e/chromium";
import { webkitLaunchOptions } from "./e2e/webkit-runtime";
import { releaseBrowserBaseUrl, releaseBrowserWebServers } from "./playwright.release-servers";

const viewports = [
  ["desktop", { width: 1440, height: 900 }],
  ["phone-portrait", { width: 390, height: 844 }],
  ["phone-landscape", { width: 844, height: 390 }],
  ["tablet-portrait", { width: 820, height: 1180 }],
  ["tablet-landscape", { width: 1180, height: 820 }],
] as const;

export default defineConfig({
  webServer: releaseBrowserWebServers(),
  testDir: "./e2e",
  testMatch: "field-check-diagnostics.spec.ts",
  timeout: 60_000,
  retries: 0,
  workers: 1,
  outputDir: "test-results/field-checks",
  reporter: [["list"]],
  use: {
    baseURL: releaseBrowserBaseUrl(process.env.PLAYWRIGHT_BASE_URL!),
    headless: true, screenshot: "only-on-failure", video: "off", trace: "off",
    // This suite verifies the manager diagnostics UI, not PWA interception.
    // Let the test's bounded API fixture routes control evidence deterministically.
    serviceWorkers: "block",
  },
  projects: (["chromium", "webkit"] as const).flatMap((browserName) =>
    viewports.map(([label, viewport]) => ({
      name: `${label}-${browserName}`,
      use: {
        ...(browserName === "chromium" ? devices["Desktop Chrome"] : devices["Desktop Safari"]),
        viewport, isMobile: label !== "desktop", hasTouch: label !== "desktop",
        launchOptions: browserName === "chromium"
          ? { executablePath: resolveChromiumExecutable() } : webkitLaunchOptions(),
      },
    }))),
});
