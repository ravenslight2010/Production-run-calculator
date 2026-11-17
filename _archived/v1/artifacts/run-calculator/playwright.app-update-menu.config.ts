import { defineConfig, devices } from "@playwright/test";
import { resolveChromiumExecutable } from "./e2e/chromium";
import { webkitLaunchOptions } from "./e2e/webkit-runtime";
import {
  releaseBrowserBaseUrl,
  releaseBrowserWebServers,
} from "./playwright.release-servers";

const baseURL = releaseBrowserBaseUrl(
  process.env.PLAYWRIGHT_BASE_URL ?? `https://${process.env.REPLIT_DEV_DOMAIN}`,
);
const chromiumLaunchOptions = {
  executablePath: resolveChromiumExecutable(),
};
const webkitOptions = webkitLaunchOptions();

const viewports = [
  { name: "desktop", viewport: { width: 1280, height: 900 } },
  { name: "phone", device: devices["iPhone 13"] },
  { name: "tablet-portrait", device: devices["iPad (gen 7)"] },
  { name: "tablet-landscape", device: devices["iPad (gen 7) landscape"] },
] as const;

export default defineConfig({
  webServer: releaseBrowserWebServers(),
  testDir: "./e2e",
  testMatch: "app-update-menu.spec.ts",
  timeout: 120_000,
  globalTimeout: 12 * 60_000,
  retries: 0,
  workers: 1,
  reporter: "list",
  outputDir: "test-results/app-update-menu",
  use: {
    baseURL,
    headless: true,
    serviceWorkers: "block",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },
  projects: viewports.flatMap(({ name, viewport, device }) => {
    const deviceOptions = device ?? {};
    return [
      {
        name: `${name}-chromium`,
        use: {
          ...deviceOptions,
          browserName: "chromium" as const,
          ...(viewport ? { viewport } : {}),
          launchOptions: chromiumLaunchOptions,
        },
      },
      {
        name: `${name}-webkit`,
        use: {
          ...deviceOptions,
          browserName: "webkit" as const,
          ...(viewport ? { viewport } : {}),
          ...(webkitOptions ? { launchOptions: webkitOptions } : {}),
        },
      },
    ];
  }),
});
