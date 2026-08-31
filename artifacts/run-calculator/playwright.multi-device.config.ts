import { defineConfig } from "@playwright/test";
import { resolveChromiumExecutable } from "./e2e/chromium";

const baseURL =
  process.env.PLAYWRIGHT_BASE_URL ??
  (process.env.REPLIT_DEV_DOMAIN
    ? `https://${process.env.REPLIT_DEV_DOMAIN}`
    : "http://127.0.0.1:5173");

/**
 * Bounded, serialized two-context convergence lane. The spec creates its own
 * desktop and phone-sized contexts; no global setup is inherited because the
 * spec owns its disposable live-day cleanup.
 */
export default defineConfig({
  testDir: "./e2e",
  testMatch: "multi-device-convergence.spec.ts",
  timeout: 60_000,
  globalTimeout: 180_000,
  retries: 0,
  workers: 1,
  outputDir: "test-results/multi-device",
  reporter: [
    ["list"],
    ["html", { outputFolder: "playwright-report/multi-device", open: "never" }],
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
  projects: [{ name: "multi-device-desktop-phone" }],
});