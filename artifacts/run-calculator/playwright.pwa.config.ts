import { defineConfig, devices } from "@playwright/test";
import { resolveChromiumExecutable } from "./e2e/chromium";

/**
 * The PWA handoff test serves its own two-version static site. Keep it out of
 * the main browser suite because that suite's global setup intentionally
 * touches the development database to prepare live-run scenarios.
 */
export default defineConfig({
  testDir: "./e2e",
  testMatch: "pwa-handoff.spec.ts",
  timeout: 120_000,
  retries: 0,
  workers: 1,
  reporter: "list",
  use: {
    headless: true,
    trace: "on-first-retry",
    video: "off",
    launchOptions: {
      executablePath: resolveChromiumExecutable(),
    },
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});