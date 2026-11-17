import { defineConfig, devices } from "@playwright/test";
import { resolveChromiumExecutable } from "./e2e/chromium";
import { webkitLaunchOptions } from "./e2e/webkit-runtime";
import { releaseBrowserBaseUrl, releaseBrowserWebServers } from "./playwright.release-servers";

const viewports = [
  { name: "desktop", width: 1440, height: 1000 },
  { name: "phone", width: 390, height: 844 },
  { name: "tablet-portrait", width: 768, height: 1024 },
  { name: "tablet-landscape", width: 1024, height: 768 },
];
const engines = [
  { name: "chromium", use: { ...devices["Desktop Chrome"], launchOptions: { executablePath: resolveChromiumExecutable() } } },
  { name: "webkit", use: { ...devices["Desktop Safari"], launchOptions: webkitLaunchOptions() } },
];

export default defineConfig({
  webServer: releaseBrowserWebServers(),
  testDir: "./e2e",
  timeout: 120_000,
  globalTimeout: 15 * 60_000,
  retries: 0,
  workers: 1,
  reporter: "list",
  outputDir: "test-results/branch-claims",
  use: {
    baseURL: releaseBrowserBaseUrl(`https://${process.env.REPLIT_DEV_DOMAIN}`),
    headless: true,
    serviceWorkers: "block",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },
  projects: engines.flatMap((engine) => [
    ...viewports.map((viewport) => ({
      name: `${viewport.name}-${engine.name}`,
      testMatch: "manager-attention.spec.ts",
      grep: /badges meet small-text contrast|Manager attention using only the keyboard|staff cannot see manager-attention actions/,
      use: { ...engine.use, viewport: { width: viewport.width, height: viewport.height } },
    })),
    {
      name: `counts-and-keyboard-${engine.name}`,
      testMatch: "manager-attention.spec.ts",
      grep: /badges show full counts|review and resolve an incident with Enter and Space/,
      use: engine.use,
    },
    {
      name: `two-client-${engine.name}`,
      testMatch: "sync-convergence.spec.ts",
      grep: /offline device adopts active deletion|wake enforces reset epoch/,
      use: engine.use,
    },
  ]),
});
