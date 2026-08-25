import { defineConfig, devices } from "@playwright/test";
import { execFileSync } from "node:child_process";

const baseURL =
  process.env.PLAYWRIGHT_BASE_URL ?? `https://${process.env.REPLIT_DEV_DOMAIN}`;
const realMobileBrowserWsEndpoint =
  process.env.PLAYWRIGHT_REAL_MOBILE_WS_ENDPOINT;
const chromiumExecutablePath =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ??
  process.env.CHROMIUM_PATH ??
  execFileSync("which", ["chromium"], { encoding: "utf8" }).trim();

export default defineConfig({
  testDir: "./e2e",
  testMatch: "sync-convergence.spec.ts",
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
      executablePath: chromiumExecutablePath,
    },
  },
  projects: [
    { name: "desktop-chromium", use: { ...devices["Desktop Chrome"] } },
    {
      name: "phone-chromium",
      use: { ...devices["Pixel 5"], viewport: { width: 390, height: 844 } },
    },
    ...(realMobileBrowserWsEndpoint
      ? [
          {
            name: "real-mobile-chromium",
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