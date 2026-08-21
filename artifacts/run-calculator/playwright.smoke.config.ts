import { defineConfig, devices } from "@playwright/test";

const baseURL =
  process.env.PLAYWRIGHT_BASE_URL ?? `https://${process.env.REPLIT_DEV_DOMAIN}`;

/**
 * The smoke matrix is isolated from the main destructive suite. Its spec
 * creates a unique account and clears only today's disposable live-day row
 * before each project run.
 */
export default defineConfig({
  testDir: "./e2e",
  testMatch: "cross-device-smoke.spec.ts",
  timeout: 60_000,
  retries: 0,
  workers: 1,
  reporter: "list",
  use: {
    baseURL,
    headless: true,
    trace: "on-first-retry",
    video: "off",
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    },
  },
  projects: [
    {
      name: "desktop-chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "phone-chromium",
      use: {
        ...devices["Pixel 5"],
        viewport: { width: 390, height: 844 },
      },
    },
  ],
});