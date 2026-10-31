import { defineConfig, devices } from "@playwright/test";
import { resolveChromiumExecutable } from "./e2e/chromium";
import { webkitLaunchOptions } from "./e2e/webkit-runtime";
import { releaseBrowserBaseUrl, releaseBrowserWebServers } from "./playwright.release-servers";

const baseURL = releaseBrowserBaseUrl(
  process.env.PLAYWRIGHT_BASE_URL ?? `https://${process.env.REPLIT_DEV_DOMAIN}`,
);
const webkitOptions = webkitLaunchOptions();

export default defineConfig({
  webServer: releaseBrowserWebServers(),
  testDir: "./e2e",
  testMatch: "freezer-surplus.spec.ts",
  timeout: 180_000,
  retries: 0,
  workers: 1,
  reporter: "list",
  use: {
    baseURL,
    headless: true,
    // Controlled rejection/lost-ack fixtures must intercept page requests,
    // rather than letting a previously registered worker own their transport.
    serviceWorkers: "block",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: { executablePath: resolveChromiumExecutable() },
      },
    },
    {
      name: "webkit",
      use: {
        ...devices["Desktop Safari"],
        ...(webkitOptions ? { launchOptions: webkitOptions } : {}),
      },
    },
  ],
});