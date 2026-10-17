import { defineConfig, devices } from "@playwright/test";
import { resolveChromiumExecutable } from "./e2e/chromium";
import { webkitLaunchOptions } from "./e2e/webkit-runtime";
import {
  releaseBrowserBaseUrl,
  releaseBrowserWebServers,
} from "./playwright.release-servers";

const baseURL = releaseBrowserBaseUrl(
  process.env.PLAYWRIGHT_BASE_URL ??
    (process.env.REPLIT_DEV_DOMAIN
      ? `https://${process.env.REPLIT_DEV_DOMAIN}`
      : "http://127.0.0.1:5173"),
);

/**
 * One isolated, non-destructive Run startup journey. It does not inherit the
 * full browser suite's shared-day reset.
 */
export default defineConfig({
  webServer: releaseBrowserWebServers(),
  testDir: "./e2e",
  testMatch: "run-startup-slow-network.spec.ts",
  timeout: 90_000,
  retries: 0,
  workers: 1,
  outputDir: "test-results/run-startup",
  reporter: [
    ["list"],
    ["html", { outputFolder: "playwright-report/run-startup", open: "never" }],
  ],
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
      name: "desktop-chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "desktop-webkit",
      use: {
        ...devices["Desktop Safari"],
        launchOptions: webkitLaunchOptions(),
      },
    },
    {
      name: "phone-portrait-chromium-emulation",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      },
    },
    {
      name: "phone-landscape-chromium-emulation",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 844, height: 390 },
        isMobile: true,
        hasTouch: true,
      },
    },
    {
      name: "tablet-portrait-chromium-emulation",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 820, height: 1180 },
        isMobile: true,
        hasTouch: true,
      },
    },
    {
      name: "tablet-landscape-chromium-emulation",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1180, height: 820 },
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
  metadata: {
    browserEvidence:
      "Phone and tablet results are Chromium viewport emulation only; no physical Android or iOS devices were tested.",
  },
});
