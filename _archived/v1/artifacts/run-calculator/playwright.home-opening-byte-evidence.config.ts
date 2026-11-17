import { defineConfig, devices } from "@playwright/test";
import { releaseBrowserWebServers } from "./playwright.release-servers";
import { resolveChromiumExecutable } from "./e2e/chromium";

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `https://${process.env.REPLIT_DEV_DOMAIN}`;

export default defineConfig({
  webServer: releaseBrowserWebServers(),
  testDir: "./e2e",
  testMatch: "management-performance.spec.ts",
  grep: /@mobile-slow-network/,
  timeout: 60_000,
  retries: 0,
  workers: 1,
  reporter: "list",
  use: {
    baseURL,
    headless: true,
    serviceWorkers: "block",
    trace: "off",
    screenshot: "off",
    video: "off",
    launchOptions: {
      executablePath: resolveChromiumExecutable(),
    },
  },
  projects: [
    {
      name: "desktop-chromium-slow-network",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "phone-chromium-slow-network",
      use: { ...devices["Pixel 5"] },
    },
  ],
});
