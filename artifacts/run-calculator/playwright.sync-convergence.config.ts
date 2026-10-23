import { defineConfig, devices } from "@playwright/test";
import { execFileSync } from "node:child_process";
import {
  releaseBrowserBaseUrl,
  releaseBrowserWebServers,
} from "./playwright.release-servers";
import { webkitLaunchOptions } from "./e2e/webkit-runtime";

const baseURL = releaseBrowserBaseUrl(
  process.env.PLAYWRIGHT_BASE_URL ?? `https://${process.env.REPLIT_DEV_DOMAIN}`,
);
const realMobileBrowserWsEndpoint =
  process.env.PLAYWRIGHT_REAL_MOBILE_WS_ENDPOINT;
const frontlineMatrix = process.env.FRONTLINE_BROWSER_MATRIX === "1";
const frontlineWebkitOptions = frontlineMatrix ? webkitLaunchOptions() : undefined;
const chromiumExecutablePath =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ??
  process.env.CHROMIUM_PATH ??
  execFileSync("which", ["chromium"], { encoding: "utf8" }).trim();

export default defineConfig({
  webServer: releaseBrowserWebServers(),
  testDir: "./e2e",
  testMatch: "sync-convergence.spec.ts",
  timeout: frontlineMatrix ? 150_000 : 60_000,
  grep: frontlineMatrix ? /frontline supply recovers across runs/ : undefined,
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
    ...(frontlineMatrix ? [
      { name: "desktop-webkit", use: { ...devices["Desktop Safari"], launchOptions: frontlineWebkitOptions ?? {} } },
      { name: "phone-webkit", use: { ...devices["iPhone 13"], launchOptions: frontlineWebkitOptions ?? {} } },
    ] : []),
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