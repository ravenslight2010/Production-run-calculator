import { defineConfig } from "@playwright/test";
import { resolveChromiumExecutable } from "./e2e/chromium";
import { webkitLaunchOptions } from "./e2e/webkit-runtime";

const apiPort = process.env.RELEASE_BROWSER_API_PORT ?? "18083";
const webPort = process.env.RELEASE_BROWSER_WEB_PORT ?? "18084";
const apiUrl = `http://127.0.0.1:${apiPort}`;
const viewports = [
  ["desktop", 1440, 900], ["phone", 390, 844],
  ["tablet-portrait", 768, 1024], ["tablet-landscape", 1024, 768],
] as const;

export default defineConfig({
  testDir: "./e2e",
  testMatch: "packaging-recovery.spec.ts",
  timeout: 240_000,
  retries: 0,
  workers: 1,
  outputDir: "test-results/packaging-recovery",
  reporter: "list",
  webServer: [
    {
      command: `cd ../api-server && NODE_ENV=development PORT=${apiPort} DATABASE_POOL_MAX=24 DISABLE_BACKGROUND_AUXILIARY_SCHEDULERS=1 pnpm run dev:without-schema-push`,
      url: `${apiUrl}/api/readyz`, reuseExistingServer: false, timeout: 300_000,
    },
    {
      command: `VITE_API_PROXY_TARGET=${apiUrl} PORT=${webPort} pnpm run dev`,
      url: `http://127.0.0.1:${webPort}`, reuseExistingServer: false, timeout: 300_000,
    },
  ],
  use: {
    baseURL: `http://127.0.0.1:${webPort}`, headless: true,
    trace: "off", screenshot: "off", video: "off",
  },
  projects: (["chromium", "webkit"] as const).flatMap((browserName) =>
    viewports.map(([name, width, height]) => ({
      name: `${browserName}-${name}`,
      use: {
        browserName, viewport: { width, height },
        launchOptions: browserName === "chromium"
          ? { executablePath: resolveChromiumExecutable() }
          : webkitLaunchOptions(),
      },
    })),
  ),
});
