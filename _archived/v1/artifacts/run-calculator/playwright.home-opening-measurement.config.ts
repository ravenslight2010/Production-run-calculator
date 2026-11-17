import { defineConfig, devices } from "@playwright/test";
import { resolveChromiumExecutable } from "./e2e/chromium";
import { webkitLaunchOptions } from "./e2e/webkit-runtime";

const apiPort = process.env.RELEASE_BROWSER_API_PORT ?? "18083";
const webPort = process.env.RELEASE_BROWSER_WEB_PORT ?? "18084";
const databaseUrl = process.env.DATABASE_URL ?? "";
let disposableLocalDatabase = false;
try {
  const parsed = new URL(databaseUrl);
  const database = decodeURIComponent(parsed.pathname.replace(/^\/+/, ""));
  disposableLocalDatabase =
    ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname) &&
    /(?:^|[-_])(e2e|test|tests|tmp|temporary)(?:[-_]|$)/i.test(database);
} catch {
  // The guard below fails closed without showing the database URL.
}

if (
  process.env.REPLIT_DEPLOYMENT === "1" ||
  /^(production|prod)$/i.test(process.env.NODE_ENV ?? "") ||
  /^(production|prod)$/i.test(process.env.APP_ENV ?? "") ||
  !disposableLocalDatabase
) {
  throw new Error(
    "Home opening measurement requires the isolated runner's disposable local database.",
  );
}

const apiUrl = `http://127.0.0.1:${apiPort}`;
const webUrl = `http://127.0.0.1:${webPort}`;
const chromiumProjects = [
  { name: "desktop-chromium", viewport: { width: 1280, height: 800 } },
  {
    name: "phone-chromium",
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  },
  {
    name: "tablet-portrait-chromium",
    viewport: { width: 768, height: 1024 },
    isMobile: true,
    hasTouch: true,
  },
  {
    name: "tablet-landscape-chromium",
    viewport: { width: 1024, height: 768 },
    isMobile: true,
    hasTouch: true,
  },
] as const;
const webkitProjects = [
  { name: "desktop-webkit", viewport: { width: 1280, height: 800 } },
  {
    name: "phone-webkit",
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  },
  {
    name: "tablet-portrait-webkit",
    viewport: { width: 768, height: 1024 },
    isMobile: true,
    hasTouch: true,
  },
  {
    name: "tablet-landscape-webkit",
    viewport: { width: 1024, height: 768 },
    isMobile: true,
    hasTouch: true,
  },
] as const;

export default defineConfig({
  // These servers consume the already-prepared publish build. The API is
  // started in development mode only to use the isolated test database.
  webServer: [
    {
      command:
        `cd ../api-server && NODE_ENV=development PORT=${apiPort} ` +
        "DATABASE_POOL_MAX=24 DISABLE_BACKGROUND_AUXILIARY_SCHEDULERS=1 " +
        "pnpm run start",
      url: `${apiUrl}/api/readyz`,
      reuseExistingServer: false,
      timeout: 300_000,
    },
    {
      command:
        `VITE_API_PROXY_TARGET=${apiUrl} PORT=${webPort} ` +
        "pnpm run serve -- --strictPort",
      url: webUrl,
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
  testDir: "./e2e",
  testMatch: ["home-opening-measurement.spec.ts", "home-deferred-panels.spec.ts"],
  timeout: 15 * 60_000,
  globalTimeout: 35 * 60_000,
  retries: 0,
  workers: 1,
  outputDir: "test-results/home-opening-measurement",
  reporter: [["list"]],
  use: {
    baseURL: webUrl,
    headless: true,
    trace: "off",
    screenshot: "off",
    video: "off",
  },
  projects: [
    ...chromiumProjects.map(({ name, viewport, ...mobile }) => ({
      name,
      use: {
        ...devices["Desktop Chrome"],
        viewport,
        ...mobile,
        launchOptions: { executablePath: resolveChromiumExecutable() },
      },
    })),
    ...webkitProjects.map(({ name, viewport, ...mobile }) => ({
      name,
      use: {
        ...devices["Desktop Safari"],
        viewport,
        ...mobile,
        launchOptions: webkitLaunchOptions(),
      },
    })),
  ],
  metadata: {
    buildMode: "production output prepared by publish:ready; not published or deployed",
    timingProjects: ["desktop-chromium", "phone-chromium"],
    smokeProjects: [
      "desktop-chromium",
      "phone-chromium",
      "tablet-portrait-chromium",
      "tablet-landscape-chromium",
      "desktop-webkit",
      "phone-webkit",
      "tablet-portrait-webkit",
      "tablet-landscape-webkit",
    ],
    physicalAndroidChrome: "not applicable",
    physicalIosSafariPwa: "not applicable",
  },
});
