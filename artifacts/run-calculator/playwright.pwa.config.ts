import { defineConfig, devices } from "@playwright/test";
import { resolveChromiumExecutable } from "./e2e/chromium";
import { webkitLaunchOptions } from "./e2e/webkit-runtime";

const webkitOptions = webkitLaunchOptions();
const webkitLocalBypass = ["localhost", "127.0.0.1", "::1"];
const webkitNoProxy = [
  ...webkitLocalBypass,
  ...(webkitOptions?.env.NO_PROXY ?? "").split(","),
  ...(webkitOptions?.env.no_proxy ?? "").split(","),
].map((host) => host.trim()).filter(Boolean).filter((host, index, hosts) => (
  hosts.indexOf(host) === index
)).join(",");
const pwaWebkitOptions = webkitOptions
  ? {
      ...webkitOptions,
      // The release runner forces browser traffic through an HTTPS-only proxy.
      // Keep that proxy for public HTTPS checks while sending the local PWA
      // fixture directly to its loopback server.
      env: {
        ...webkitOptions.env,
        NO_PROXY: webkitNoProxy,
        no_proxy: webkitNoProxy,
      },
    }
  : undefined;
const appShellInstallSmoke =
  /keeps update controls reachable|serves app shell and declared install assets|blocks an offline intent after session revocation|keeps an authentication-blocked offline intent private across account switches|keeps a permission-blocked offline intent until explicit retry|keeps offline field-check evidence with its live or sandbox account|rechecks an open run after reconnect|recovers from a temporary session check failure after offline startup|keeps startup retry available after session checks time out|keeps a valid session through normal online run recovery/;
const chromiumLaunchOptions =
  process.env.CI &&
  !process.env.REPLIT_DEV_DOMAIN &&
  !process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?.trim()
    ? undefined
    : { executablePath: resolveChromiumExecutable() };

/**
 * The PWA handoff test serves its own two-version static site. Keep it out of
 * the main browser suite because that suite's global setup intentionally
 * touches the development database to prepare live-run scenarios.
 */
export default defineConfig({
  testDir: "./e2e",
  testMatch: ["pwa-handoff.spec.ts", "webkit-https.spec.ts"],
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
        ...(chromiumLaunchOptions ? { launchOptions: chromiumLaunchOptions } : {}),
      },
    },
    {
      name: "webkit",
      use: {
        ...devices["Desktop Safari"],
        ...(pwaWebkitOptions ? { launchOptions: pwaWebkitOptions } : {}),
      },
    },
    {
      name: "phone-landscape-chromium",
      grep: /keeps update controls reachable/,
      use: {
        ...devices["iPhone 13"],
        viewport: { width: 844, height: 390 },
        browserName: "chromium",
        ...(chromiumLaunchOptions ? { launchOptions: chromiumLaunchOptions } : {}),
      },
    },
    {
      name: "phone-landscape-webkit",
      grep: /keeps update controls reachable/,
      use: {
        ...devices["iPhone 13"],
        viewport: { width: 844, height: 390 },
        ...(pwaWebkitOptions ? { launchOptions: pwaWebkitOptions } : {}),
      },
    },
    {
      name: "phone-chromium",
      grep: appShellInstallSmoke,
      use: {
        ...devices["iPhone 13"],
        browserName: "chromium",
        ...(chromiumLaunchOptions ? { launchOptions: chromiumLaunchOptions } : {}),
      },
    },
    {
      name: "tablet-portrait-chromium",
      grep: appShellInstallSmoke,
      use: {
        ...devices["iPad (gen 7)"],
        browserName: "chromium",
        ...(chromiumLaunchOptions ? { launchOptions: chromiumLaunchOptions } : {}),
      },
    },
    {
      name: "tablet-landscape-chromium",
      grep: appShellInstallSmoke,
      use: {
        ...devices["iPad (gen 7) landscape"],
        browserName: "chromium",
        ...(chromiumLaunchOptions ? { launchOptions: chromiumLaunchOptions } : {}),
      },
    },
    {
      name: "phone-webkit",
      grep: appShellInstallSmoke,
      use: {
        ...devices["iPhone 13"],
        ...(pwaWebkitOptions ? { launchOptions: pwaWebkitOptions } : {}),
      },
    },
    {
      name: "tablet-portrait-webkit",
      grep: appShellInstallSmoke,
      use: {
        ...devices["iPad (gen 7)"],
        ...(pwaWebkitOptions ? { launchOptions: pwaWebkitOptions } : {}),
      },
    },
    {
      name: "tablet-landscape-webkit",
      grep: appShellInstallSmoke,
      use: {
        ...devices["iPad (gen 7) landscape"],
        ...(pwaWebkitOptions ? { launchOptions: pwaWebkitOptions } : {}),
      },
    },
  ],
});
