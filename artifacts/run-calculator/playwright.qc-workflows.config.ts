import { defineConfig, devices } from "@playwright/test";
import { resolveChromiumExecutable } from "./e2e/chromium";

const apiPort = process.env.RELEASE_BROWSER_API_PORT ?? "18083";
const webPort = process.env.RELEASE_BROWSER_WEB_PORT ?? "18084";
const apiUrl = `http://127.0.0.1:${apiPort}`;
const webUrl = `http://127.0.0.1:${webPort}`;

export default defineConfig({
  testDir: "./e2e",
  testMatch: "qc-workflows-authenticated.spec.ts",
  timeout: 120_000,
  retries: 0,
  workers: 1,
  outputDir: "test-results/qc-workflows",
  reporter: [["list"]],
  webServer: [
    {
      command:
        `cd ../api-server && NODE_ENV=development PORT=${apiPort} ` +
        "DATABASE_POOL_MAX=24 DISABLE_BACKGROUND_AUXILIARY_SCHEDULERS=1 " +
        "pnpm run dev:without-schema-push",
      url: `${apiUrl}/api/readyz`,
      reuseExistingServer: false,
      timeout: 300_000,
    },
    {
      command:
        `VITE_API_PROXY_TARGET=${apiUrl} PORT=${webPort} pnpm run dev`,
      url: webUrl,
      reuseExistingServer: false,
      timeout: 300_000,
    },
  ],
  use: {
    baseURL: webUrl,
    headless: true,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
    launchOptions: { executablePath: resolveChromiumExecutable() },
  },
  projects: [{
    name: "chromium",
    use: { ...devices["Desktop Chrome"] },
  }],
});
