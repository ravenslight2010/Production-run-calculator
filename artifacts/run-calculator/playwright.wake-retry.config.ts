import { defineConfig, devices } from "@playwright/test";
import { resolveChromiumExecutable } from "./e2e/chromium";
import {
  releaseBrowserBaseUrl,
  releaseBrowserWebServers,
} from "./playwright.release-servers";
import { validateBrowserSpecSyntax } from "./e2e/validate-browser-spec-syntax";

const baseURL = releaseBrowserBaseUrl(
  process.env.PLAYWRIGHT_BASE_URL ?? `https://${process.env.REPLIT_DEV_DOMAIN}`,
);

validateBrowserSpecSyntax(
  new URL("./e2e/screen-off-wake.spec.ts", import.meta.url),
);

/**
 * Focused two-session wake-retry lane. It intentionally reuses the release
 * suite's disposable-database setup and local API/web servers, while grep
 * keeps this command bounded to the single high-risk recovery journey.
 */
export default defineConfig({
  webServer: releaseBrowserWebServers(),
  testDir: "./e2e",
  testMatch: "screen-off-wake.spec.ts",
  grep: /(?:two live sessions converge through visible retry after an offline wake|cancels a wake recovery without replaying a pre-wake write)/,
  globalSetup: "./e2e/global-setup.ts",
  timeout: 60_000,
  globalTimeout: 180_000,
  retries: 0,
  workers: 1,
  outputDir: "test-results/wake-retry",
  reporter: [
    ["list"],
    ["html", { outputFolder: "playwright-report/wake-retry", open: "never" }],
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
  projects: [{
    name: "wake-retry-desktop-phone",
    use: { ...devices["Desktop Chrome"] },
  }],
});