import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";
import {
  releaseBrowserBaseUrl,
  releaseBrowserWebServers,
} from "./playwright.release-servers";

const baseURL = releaseBrowserBaseUrl(
  process.env.PLAYWRIGHT_BASE_URL ?? `https://${process.env.REPLIT_DEV_DOMAIN}`,
);
const useNixWebkitLauncher =
  process.platform === "linux"
  && existsSync("/nix/store")
  && !process.env.PLAYWRIGHT_WEBKIT_EXECUTABLE_PATH;
if (useNixWebkitLauncher) {
  // Playwright's host validator maps libraries to Debian package names. The
  // Nix launcher below supplies the same SONAMEs from revision-pinned outputs,
  // and the browser's real dynamic loader remains the authoritative check.
  process.env.PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS = "1";
}
const webkitExecutablePath = process.env.PLAYWRIGHT_WEBKIT_EXECUTABLE_PATH
  ?? (useNixWebkitLauncher
    ? fileURLToPath(new URL("./e2e/run-playwright-webkit-nix.sh", import.meta.url))
    : undefined);

/**
 * WebKit is a bounded release signal, not a second copy of the full suite.
 * The spec owns unique accounts and today's disposable sync row; it does not
 * inherit the main suite's global setup or full browser test inventory.
 */
export default defineConfig({
  webServer: releaseBrowserWebServers(),
  testDir: "./e2e",
  testMatch: "release-webkit-smoke.spec.ts",
  timeout: 75_000,
  globalTimeout: 6 * 60_000,
  retries: 0,
  workers: 1,
  outputDir: "test-results/webkit",
  reporter: [
    ["list"],
    ["./e2e/release-browser-evidence-reporter.ts"],
  ],
  use: {
    baseURL,
    headless: true,
    launchOptions: {
      executablePath: webkitExecutablePath,
    },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },
  projects: [
    {
      name: "webkit",
      use: { ...devices["Desktop Safari"] },
    },
  ],
});