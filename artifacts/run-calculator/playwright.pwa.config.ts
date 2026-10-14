import { defineConfig, devices } from "@playwright/test";
import { resolveChromiumExecutable } from "./e2e/chromium";
import { webkitLaunchOptions } from "./e2e/webkit-runtime";

const webkitOptions = webkitLaunchOptions();
const appShellInstallSmoke = /serves app shell and declared install assets/;
const chromiumLaunchOptions = {
  executablePath: resolveChromiumExecutable(),
};

/**
 * The PWA handoff test serves its own two-version static site. Keep it out of
 * the main browser suite because that suite's global setup intentionally
 * touches the development database to prepare live-run scenarios.
 */
export default defineConfig({
  testDir: "./e2e",
  testMatch: "pwa-handoff.spec.ts",
  timeout: 120_000,
  retries: 0,
  workers: 1,
  reporter: "list",
  use: {
    headless: true,
    trace: "on-first-retry",
    video: "off",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: chromiumLaunchOptions,
      },
    },
    {
      name: "webkit",
      use: {
        ...devices["Desktop Safari"],
        ...(webkitOptions ? { launchOptions: webkitOptions } : {}),
      },
    },
    {
      name: "phone-chromium",
      grep: appShellInstallSmoke,
      use: {
        ...devices["iPhone 13"],
        browserName: "chromium",
        launchOptions: chromiumLaunchOptions,
      },
    },
    {
      name: "tablet-portrait-chromium",
      grep: appShellInstallSmoke,
      use: {
        ...devices["iPad (gen 7)"],
        browserName: "chromium",
        launchOptions: chromiumLaunchOptions,
      },
    },
    {
      name: "tablet-landscape-chromium",
      grep: appShellInstallSmoke,
      use: {
        ...devices["iPad (gen 7) landscape"],
        browserName: "chromium",
        launchOptions: chromiumLaunchOptions,
      },
    },
    {
      name: "phone-webkit",
      grep: appShellInstallSmoke,
      use: {
        ...devices["iPhone 13"],
        ...(webkitOptions ? { launchOptions: webkitOptions } : {}),
      },
    },
    {
      name: "tablet-portrait-webkit",
      grep: appShellInstallSmoke,
      use: {
        ...devices["iPad (gen 7)"],
        ...(webkitOptions ? { launchOptions: webkitOptions } : {}),
      },
    },
    {
      name: "tablet-landscape-webkit",
      grep: appShellInstallSmoke,
      use: {
        ...devices["iPad (gen 7) landscape"],
        ...(webkitOptions ? { launchOptions: webkitOptions } : {}),
      },
    },
  ],
});