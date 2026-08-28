import { defineConfig, devices } from "@playwright/test";
import { resolveChromiumExecutable } from "./e2e/chromium";

const baseURL =
  process.env.PLAYWRIGHT_BASE_URL ?? `https://${process.env.REPLIT_DEV_DOMAIN}`;

export default defineConfig({
  testDir: "./e2e",
  testMatch: "freezer-surplus.spec.ts",
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