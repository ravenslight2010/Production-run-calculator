import { defineConfig, devices } from "@playwright/test";
import { resolveChromiumExecutable } from "./e2e/chromium";

const baseURL =
  process.env.PLAYWRIGHT_BASE_URL ?? `https://${process.env.REPLIT_DEV_DOMAIN}`;

/**
 * Isolated manager journey: unlike the main config this does not inherit the
 * destructive global setup that clears the live day. The spec owns its unique
 * account and today's disposable sync-row cleanup.
 */
export default defineConfig({
  testDir: "./e2e",
  testMatch: "dough-correction-resume.spec.ts",
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
  projects: [
    {
      name: "responsive-manager-chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 390, height: 844 },
      },
    },
  ],
});