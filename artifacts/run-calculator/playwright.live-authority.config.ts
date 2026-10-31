import { defineConfig } from "@playwright/test";
import { resolveChromiumExecutable } from "./e2e/chromium";
import { webkitLaunchOptions } from "./e2e/webkit-runtime";
import {
  releaseBrowserBaseUrl,
  releaseBrowserWebServers,
} from "./playwright.release-servers";

// The local disposable server must never claim a publish identity. The
// imported server helper inherits this config process environment.
process.env.BUILD_IDENTITY_MODE = "development";

const viewports = [
  ["desktop", 1440, 1000],
  ["phone", 390, 844],
  ["tablet-portrait", 768, 1024],
  ["tablet-landscape", 1024, 768],
] as const;

export default defineConfig({
  webServer: releaseBrowserWebServers(),
  testDir: "./e2e",
  testMatch: "live-authority.spec.ts",
  timeout: 120_000,
  expect: { timeout: 20_000 },
  globalTimeout: 25 * 60_000,
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: [["list"]],
  outputDir: "test-results/live-authority",
  use: {
    baseURL: releaseBrowserBaseUrl("http://127.0.0.1:18084"),
    timezoneId: "America/Chicago",
    serviceWorkers: "allow",
    trace: "off",
    video: "off",
    screenshot: "off",
  },
  projects: [
    ...(["chromium", "webkit"] as const).flatMap((browserName) =>
      viewports.map(([size, width, height]) => ({
        name: `${browserName}-${size}`,
        use: {
          browserName,
          viewport: { width, height },
          launchOptions: browserName === "chromium"
            ? { executablePath: resolveChromiumExecutable() }
            : webkitLaunchOptions(),
        },
      })),
    ),
  ],
});
