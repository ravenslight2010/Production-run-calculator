import { defineConfig, devices } from "@playwright/test";
import { releaseBrowserBaseUrl, releaseBrowserWebServers } from "./playwright.release-servers";
import { webkitLaunchOptions } from "./e2e/webkit-runtime";

const webkit = webkitLaunchOptions();
const remainingOnly = process.env.BREAK_VERIFICATION_REMAINING_ONLY === "1";
const fullJourney = /touch break planning/;
const keyboard = /break planning enlarged-text keyboard controls/;

export default defineConfig({
  webServer: releaseBrowserWebServers(),
  testDir: "./e2e",
  testMatch: "accessibility-smoke.spec.ts",
  timeout: 120_000,
  retries: 0,
  workers: 1,
  globalTimeout: 15 * 60_000,
  reporter: "list",
  use: {
    baseURL: releaseBrowserBaseUrl(`https://${process.env.REPLIT_DEV_DOMAIN}`),
    headless: true,
    launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH },
  },
  projects: [
    { name: "desktop-chromium", grep: /touch break planning|break planning enlarged-text keyboard controls|manager break plans|authorized supervisors/, use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 900 } } },
    { name: "android-touch", grep: /touch break planning|break planning enlarged-text keyboard controls/, use: { ...devices["Pixel 7"] } },
    { name: "short-phone-chromium", grep: /touch break planning|break planning enlarged-text keyboard controls/, use: { ...devices["Pixel 7"], viewport: { width: 844, height: 390 } } },
    { name: "tablet-portrait-chromium", grep: /touch break planning|break planning enlarged-text keyboard controls/, use: { ...devices["Pixel 7"], viewport: { width: 768, height: 1024 } } },
    { name: "tablet-landscape-chromium", grep: /touch break planning|break planning enlarged-text keyboard controls/, use: { ...devices["Pixel 7"], viewport: { width: 1024, height: 768 } } },
    { name: "desktop-webkit", grep: /touch break planning|break planning enlarged-text keyboard controls/, use: { ...devices["Desktop Safari"], viewport: { width: 1280, height: 900 }, launchOptions: webkit } },
    { name: "phone-webkit", grep: /touch break planning|break planning enlarged-text keyboard controls/, use: { ...devices["iPhone 13"], launchOptions: webkit } },
    { name: "short-phone-webkit", grep: /touch break planning|break planning enlarged-text keyboard controls/, use: { ...devices["iPhone 13"], viewport: { width: 844, height: 390 }, launchOptions: webkit } },
    { name: "tablet-portrait-webkit", grep: /touch break planning|break planning enlarged-text keyboard controls/, use: { ...devices["iPad (gen 7)"], viewport: { width: 768, height: 1024 }, launchOptions: webkit } },
    { name: "tablet-landscape-webkit", grep: /touch break planning|break planning enlarged-text keyboard controls/, use: { ...devices["iPad (gen 7)"], viewport: { width: 1024, height: 768 }, launchOptions: webkit } },
  ].filter(project => !remainingOnly || !["desktop-chromium", "short-phone-chromium", "tablet-portrait-chromium"].includes(project.name))
    .map(project => !remainingOnly ? project : {
      ...project,
      grep: ["tablet-portrait-webkit", "tablet-landscape-webkit"].includes(project.name)
        ? new RegExp(`${fullJourney.source}|${keyboard.source}`) : keyboard,
    }),
});
