import { defineConfig, devices } from "@playwright/test";
import { resolveChromiumExecutable } from "./e2e/chromium";

const baseURL =
  process.env.PLAYWRIGHT_BASE_URL ?? `https://${process.env.REPLIT_DEV_DOMAIN}`;

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  timeout: 60_000,
  retries: 0,
  workers: 1,
  outputDir: "test-results/full",
  reporter: [
    ["list"],
    ["html", { outputFolder: "playwright-report/full", open: "never" }],
    ["./e2e/release-duration-reporter.ts"],
  ],
  use: {
    baseURL,
    headless: true,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    // Keep failure screenshots and traces without requiring Playwright's
    // separately-installed ffmpeg package in the release environment.
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
