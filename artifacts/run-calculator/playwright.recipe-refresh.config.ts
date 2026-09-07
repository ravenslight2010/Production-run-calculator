import { defineConfig, devices } from "@playwright/test";
import { resolveChromiumExecutable } from "./e2e/chromium";

const baseURL =
  process.env.PLAYWRIGHT_BASE_URL ?? `https://${process.env.REPLIT_DEV_DOMAIN}`;

export default defineConfig({
  testDir: "./e2e",
  testMatch: "recipe-refresh-start-freeze.spec.ts",
  timeout: 90_000,
  globalTimeout: 120_000,
  retries: 0,
  workers: 1,
  reporter: "list",
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
  projects: [{
    name: "recipe-refresh-phone-chromium",
    use: {
      ...devices["Desktop Chrome"],
      viewport: { width: 390, height: 844 },
    },
  }],
});