import { defineConfig, devices } from "@playwright/test";

const baseURL =
  process.env.PLAYWRIGHT_BASE_URL ?? `https://${process.env.REPLIT_DEV_DOMAIN}`;

/**
 * Isolated, non-destructive performance journey. Do not inherit the main
 * config: its global setup deletes today's shared day-state row.
 */
export default defineConfig({
  testDir: "./e2e",
  testMatch: "management-performance.spec.ts",
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
      grepInvert: /@mobile-slow-network/,
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});