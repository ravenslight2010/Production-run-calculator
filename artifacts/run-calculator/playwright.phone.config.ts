import { defineConfig, devices } from "@playwright/test";

const baseURL =
  process.env.PLAYWRIGHT_BASE_URL ?? `https://${process.env.REPLIT_DEV_DOMAIN}`;
const realMobileBrowserWsEndpoint =
  process.env.PLAYWRIGHT_REAL_MOBILE_WS_ENDPOINT;

/**
 * Phone layout checks must never reuse the main Playwright configuration:
 * that suite's global setup clears today's live-day row to prepare specific
 * run-state scenarios. These checks only inspect the public sign-in flow and
 * isolated, newly-created test accounts, so they need no shared-data reset.
 */
export default defineConfig({
  testDir: "./e2e",
  testMatch: ["phone-layout.spec.ts", "management-performance.spec.ts"],
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
      name: "chromium",
      testMatch: "phone-layout.spec.ts",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "mobile-slow-network",
      testMatch: "management-performance.spec.ts",
      grep: /@mobile-slow-network/,
      use: { ...devices["Pixel 5"] },
    },
    // A device service supplies a Playwright/CDP endpoint connected to Android
    // Chrome on a physical device. Do not replace this with a Playwright device
    // descriptor: desktop Chromium emulation cannot open a software keyboard.
    ...(realMobileBrowserWsEndpoint
      ? [
          {
            name: "real-mobile-chromium",
            testMatch: "phone-layout.spec.ts",
            use: {
              connectOptions: {
                wsEndpoint: realMobileBrowserWsEndpoint,
              },
            },
          },
        ]
      : []),
  ],
});