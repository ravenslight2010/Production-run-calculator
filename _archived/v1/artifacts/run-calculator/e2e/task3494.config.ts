import { defineConfig, devices } from "@playwright/test";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveChromiumExecutable } from "./chromium";
import { webkitLaunchOptions } from "./webkit-runtime";
import { releaseBrowserBaseUrl } from "../playwright.release-servers";

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const evidenceDir = resolve(appDir, "../../.local/tasks/evidence/complete-audited-import-safety/browser");
const apiPort = process.env.RELEASE_BROWSER_API_PORT ?? "18083";
const webPort = process.env.RELEASE_BROWSER_WEB_PORT ?? "18084";

export default defineConfig({
  testDir: ".",
  testMatch: "task3494-audited-import.spec.ts",
  timeout: 120_000,
  expect: { timeout: 10_000 },
  workers: 1,
  retries: 0,
  outputDir: resolve(evidenceDir, "playwright-output"),
  reporter: [["list"], ["html", { outputFolder: resolve(evidenceDir, "report"), open: "never" }]],
  use: {
    baseURL: releaseBrowserBaseUrl(process.env.PLAYWRIGHT_BASE_URL ?? `https://${process.env.REPLIT_DEV_DOMAIN}`),
    headless: true,
    screenshot: "only-on-failure",
    trace: "off",
    serviceWorkers: "block",
  },
  webServer: process.env.RELEASE_BROWSER_LOCAL_SERVERS === "1" ? [
    {
      command: `cd ../api-server && export BUILD_IDENTITY_MODE=development NODE_ENV=development PORT=${apiPort} DATABASE_POOL_MAX=24 DISABLE_BACKGROUND_AUXILIARY_SCHEDULERS=1 && pnpm run build && exec node --enable-source-maps ./dist/index.mjs`,
      url: `http://127.0.0.1:${apiPort}/api/readyz`,
      cwd: appDir,
      reuseExistingServer: false,
      timeout: 300_000,
    },
    {
      command: `BUILD_IDENTITY_MODE=development VITE_API_PROXY_TARGET=http://127.0.0.1:${apiPort} exec ./node_modules/.bin/vite --config vite.config.ts --host 0.0.0.0 --port ${webPort}`,
      url: `http://127.0.0.1:${webPort}`,
      cwd: appDir,
      reuseExistingServer: false,
      timeout: 300_000,
    },
  ] : undefined,
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"], launchOptions: { executablePath: resolveChromiumExecutable() } } },
    { name: "webkit", use: { ...devices["Desktop Safari"], launchOptions: webkitLaunchOptions() } },
  ],
});
