import { defineConfig } from "@playwright/test";
import { resolveChromiumExecutable } from "./e2e/chromium";
import { webkitLaunchOptions } from "./e2e/webkit-runtime";
import { requireIsolatedTestDatabase } from "./e2e/isolation";
import { validateBrowserSpecSyntax } from "./e2e/validate-browser-spec-syntax";

// Narrow regression harness; the ordinary suite retains its full preflight.
// Never start these servers against the workspace or production database.
requireIsolatedTestDatabase("line transit focused browser harness");
validateBrowserSpecSyntax(new URL("./e2e/die-tunnel-defaults.spec.ts", import.meta.url));

const apiPort = process.env.RELEASE_BROWSER_API_PORT ?? "18083";
const webPort = process.env.RELEASE_BROWSER_WEB_PORT ?? "18084";
const apiUrl = `http://127.0.0.1:${apiPort}`;
const webUrl = `http://127.0.0.1:${webPort}`;

export default defineConfig({
  testDir: "./e2e",
  testMatch: ["die-tunnel-defaults.spec.ts"],
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: "line",
  use: { baseURL: webUrl },
  // The journey asserts all four viewport sizes within each engine. Do not
  // repeat the same critical lifecycle once for every viewport.
  projects: [
    {
      name: "chromium-desktop",
      use: {
        browserName: "chromium",
        viewport: { width: 1440, height: 960 },
        launchOptions: { executablePath: resolveChromiumExecutable() },
      },
    },
    {
      name: "webkit-desktop",
      use: {
        browserName: "webkit",
        viewport: { width: 1440, height: 960 },
        launchOptions: webkitLaunchOptions(),
      },
    },
  ],
  webServer: [
    {
      command:
        `cd ../api-server && NODE_ENV=development PORT=${apiPort} DATABASE_POOL_MAX=24 ` +
        "DISABLE_BACKGROUND_AUXILIARY_SCHEDULERS=1 node build.mjs && " +
        `NODE_ENV=development PORT=${apiPort} DATABASE_POOL_MAX=24 ` +
        "DISABLE_BACKGROUND_AUXILIARY_SCHEDULERS=1 node --enable-source-maps ./dist/index.mjs",
      url: `${apiUrl}/api/readyz`,
      reuseExistingServer: false,
      timeout: 300_000,
    },
    {
      command:
        `VITE_API_PROXY_TARGET=${apiUrl} ./node_modules/.bin/vite ` +
        `--config vite.config.ts --host 0.0.0.0 --port ${webPort}`,
      url: webUrl,
      reuseExistingServer: false,
      timeout: 300_000,
    },
  ],
});
