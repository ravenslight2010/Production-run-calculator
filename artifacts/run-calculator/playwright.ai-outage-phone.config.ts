import { defineConfig, devices } from "@playwright/test";

const baseURL =
  process.env.PLAYWRIGHT_BASE_URL ?? `https://${process.env.REPLIT_DEV_DOMAIN}`;

/**
 * The maintained mobile surface is the responsive web app. Keep this focused
 * outage check separate from the main destructive config so it can exercise
 * the authenticated manager journey at a phone viewport without resetting
 * shared live-day state.
 */
export default defineConfig({
  testDir: "./e2e",
  testMatch: "ai-outage-reviewability.spec.ts",
  timeout: 60_000,
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
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    },
  },
  projects: [
    {
      name: "ai-outage-phone",
      use: { ...devices["Pixel 5"] },
    },
  ],
});