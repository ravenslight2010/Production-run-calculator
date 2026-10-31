import { defineConfig, devices } from "@playwright/test";
import { resolveChromiumExecutable } from "./e2e/chromium";
import { webkitLaunchOptions } from "./e2e/webkit-runtime";
import {
  releaseBrowserBaseUrl,
  releaseBrowserWebServers,
} from "./playwright.release-servers";

const viewportProjects = [
  { name: "desktop", viewport: { width: 1440, height: 900 } },
  { name: "phone", viewport: { width: 390, height: 844 } },
  { name: "tablet-portrait", viewport: { width: 768, height: 1024 } },
  { name: "tablet-landscape", viewport: { width: 1024, height: 768 } },
];

export default defineConfig({
  webServer: releaseBrowserWebServers(),
  testDir: "./e2e",
  testMatch: "import-gold-approvals-authenticated.spec.ts",
  timeout: 210_000,
  globalTimeout: 45 * 60_000,
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  outputDir: "generated-artifacts/import-gold-approvals-interrupted",
  use: {
    baseURL: releaseBrowserBaseUrl(
      process.env.PLAYWRIGHT_BASE_URL ?? `https://${process.env.REPLIT_DEV_DOMAIN}`,
    ),
    headless: true,
    serviceWorkers: "block",
    trace: "off",
    screenshot: "only-on-failure",
    video: "off",
  },
  projects: [
    ...viewportProjects.map(({ name, viewport }) => ({
      name: `${name}-chromium`,
      use: {
        ...devices["Desktop Chrome"],
        viewport,
        launchOptions: { executablePath: resolveChromiumExecutable() },
      },
    })),
    ...viewportProjects.map(({ name, viewport }) => ({
      name: `${name}-webkit`,
      use: {
        ...devices["Desktop Safari"],
        viewport,
        launchOptions: webkitLaunchOptions(),
      },
    })),
  ],
});
