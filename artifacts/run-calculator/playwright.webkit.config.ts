import { defineConfig, devices } from "@playwright/test";

const baseURL =
  process.env.PLAYWRIGHT_BASE_URL ?? `https://${process.env.REPLIT_DEV_DOMAIN}`;

/**
 * WebKit is a bounded release signal, not a second copy of the full suite.
 * The spec owns unique accounts and today's disposable sync row; it does not
 * inherit the main suite's global setup or full browser test inventory.
 */
export default defineConfig({
  testDir: "./e2e",
  testMatch: "release-webkit-smoke.spec.ts",
  timeout: 75_000,
  globalTimeout: 6 * 60_000,
  retries: 0,
  workers: 1,
  outputDir: "test-results/webkit",
  reporter: [
    ["list"],
    ["./e2e/release-browser-evidence-reporter.ts"],
  ],
  use: {
    baseURL,
    headless: true,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },
  projects: [
    {
      name: "webkit",
      use: { ...devices["Desktop Safari"] },
    },
  ],
});