import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.CALENDAR_E2E_PORT ?? 4177);
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./e2e",
  testMatch: "calendar.spec.ts",
  timeout: 30_000,
  globalTimeout: 90_000,
  retries: 0,
  workers: 1,
  reporter: "list",
  outputDir: "test-results/calendar",
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
  webServer: {
    command: `PORT=${port} pnpm exec vite --config e2e/vite-calendar.config.ts`,
    url: `${baseURL}/e2e/calendar-fixture.html`,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
  projects: [
    {
      name: "desktop-chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1280, height: 900 },
      },
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