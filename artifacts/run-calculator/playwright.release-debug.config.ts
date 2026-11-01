import { defineConfig, devices } from "@playwright/test";
import { resolveChromiumExecutable } from "./e2e/chromium";
import { validateBrowserSpecSyntaxDirectory } from "./e2e/validate-browser-spec-syntax";
import { BLOCKED_REAL_SOURCE_WORKBOOK_CASE_PATTERN } from "../../scripts/src/full-browser-case-contract.mjs";
import {
  releaseBrowserBaseUrl,
  releaseBrowserWebServers,
} from "./playwright.release-servers";

const baseURL = releaseBrowserBaseUrl(
  process.env.PLAYWRIGHT_BASE_URL ?? `https://${process.env.REPLIT_DEV_DOMAIN}`,
);

// Keep focused debugging on the same release-suite boundary. This config
// intentionally omits the release-duration reporter, so it can never retain
// or replace revision-bound full-suite evidence.
validateBrowserSpecSyntaxDirectory(
  new URL("./e2e/", import.meta.url),
  ["release-webkit-smoke.spec.ts"],
);

export default defineConfig({
  webServer: releaseBrowserWebServers(),
  testDir: "./e2e",
  // Match the browser-file boundary, not the default suite's narrower lanes.
  // Node/Vitest helpers in e2e must not execute even during --list.
  testMatch: "**/*.spec.ts",
  globalSetup: "./e2e/global-setup.ts",
  timeout: 60_000,
  retries: 0,
  workers: 1,
  outputDir: "test-results/release-debug",
  reporter: [
    ["list"],
    [
      "html",
      { outputFolder: "playwright-report/release-debug", open: "never" },
    ],
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
  testIgnore: ["calendar.spec.ts", "release-webkit-smoke.spec.ts"],
  grepInvert: new RegExp(
    `${BLOCKED_REAL_SOURCE_WORKBOOK_CASE_PATTERN.source}|` +
    /@real-mobile-browser (?:physical Android Chrome|queued Target Cases edit survives an Android Chrome process restart)/.source,
  ),
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});