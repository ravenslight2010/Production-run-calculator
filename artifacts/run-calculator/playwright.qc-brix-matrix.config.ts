import { defineConfig, devices } from "@playwright/test";
import { resolveChromiumExecutable } from "./e2e/chromium";
import { webkitLaunchOptions } from "./e2e/webkit-runtime";

const apiPort = process.env.RELEASE_BROWSER_API_PORT ?? "18083";
const webPort = process.env.RELEASE_BROWSER_WEB_PORT ?? "18084";
const apiUrl = `http://127.0.0.1:${apiPort}`;
const webUrl = `http://127.0.0.1:${webPort}`;
const webkitOptions = webkitLaunchOptions();

const viewports = [
  { name: "desktop", viewport: { width: 1440, height: 900 } },
  { name: "phone", viewport: { width: 390, height: 844 } },
  { name: "tablet-portrait", viewport: { width: 768, height: 1024 } },
  { name: "tablet-landscape", viewport: { width: 1024, height: 768 } },
] as const;

const projects = (["chromium", "webkit"] as const).flatMap((browserName) =>
  viewports.map(({ name, viewport }) => ({
    name: `${browserName}-${name}`,
    use: {
      browserName,
      viewport,
      ...(browserName === "chromium"
        ? { launchOptions: { executablePath: resolveChromiumExecutable() } }
        : webkitOptions
          ? { launchOptions: webkitOptions }
          : {}),
      ...(browserName === "chromium"
        ? { ...devices["Desktop Chrome"], viewport }
        : { ...devices["Desktop Safari"], viewport }),
    },
  })),
);

export default defineConfig({
  testDir: "./e2e",
  testMatch: "qc-brix-authenticated.spec.ts",
  timeout: 240_000,
  retries: 0,
  workers: 1,
  outputDir: "test-results/qc-brix-matrix",
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
  },
  projects,
});
