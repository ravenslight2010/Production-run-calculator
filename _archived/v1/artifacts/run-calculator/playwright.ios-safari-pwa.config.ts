import { defineConfig } from "@playwright/test";

const baseURL =
  process.env.PLAYWRIGHT_BASE_URL ?? `https://${process.env.REPLIT_DEV_DOMAIN}`;
const iosSafariPwaWsEndpoint =
  process.env.PLAYWRIGHT_REAL_IOS_SAFARI_WS_ENDPOINT?.trim();

if (!iosSafariPwaWsEndpoint) {
  throw new Error(
    "PLAYWRIGHT_REAL_IOS_SAFARI_WS_ENDPOINT must be configured for the physical iOS Safari/PWA lane.",
  );
}

/**
 * This lane is intentionally separate from responsive Chromium/WebKit and the
 * PWA service-worker handoff fixture. The endpoint must be supplied by a
 * service connected to a physical iPhone/iPad Safari tab or installed PWA.
 *
 * It proves physical web/PWA runtime identity only. It does not test a native
 * iOS application.
 */
export default defineConfig({
  testDir: "./e2e",
  testMatch: "ios-safari-pwa-device.spec.ts",
  timeout: 60_000,
  retries: 0,
  workers: 1,
  outputDir: "test-results/ios-safari-pwa",
  reporter: [
    ["list"],
    ["html", { outputFolder: "playwright-report/ios-safari-pwa", open: "never" }],
  ],
  use: {
    baseURL,
    headless: true,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
    connectOptions: {
      wsEndpoint: iosSafariPwaWsEndpoint,
    },
  },
  projects: [
    {
      name: "real-ios-safari-pwa",
    },
  ],
});