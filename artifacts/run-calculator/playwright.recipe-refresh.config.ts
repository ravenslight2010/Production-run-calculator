import { defineConfig, devices } from "@playwright/test";
import { resolveChromiumExecutable } from "./e2e/chromium";
import { requireDedicatedTestDatabase } from "./e2e/isolation";

const baseURL =
  process.env.PLAYWRIGHT_BASE_URL ??
  (process.env.REPLIT_DEV_DOMAIN
    ? `https://${process.env.REPLIT_DEV_DOMAIN}`
    : "http://127.0.0.1:5173");

// The recipe-refresh suite edits shared master data and clears live-day rows.
// Its command supplies the approved test-mode flags, but those flags are not
// enough on their own: the database name must explicitly identify a disposable
// target so a developer cannot accidentally point this suite at a shared DB.
requireDedicatedTestDatabase("recipe-refresh Playwright setup");

export default defineConfig({
  testDir: "./e2e",
  testMatch: "recipe-refresh-start-freeze.spec.ts",
  timeout: 90_000,
  globalTimeout: 360_000,
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
