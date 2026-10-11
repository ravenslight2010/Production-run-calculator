import type { PlaywrightTestConfig } from "@playwright/test";

const RELEASE_BROWSER_API_URL = `http://127.0.0.1:${process.env.RELEASE_BROWSER_API_PORT ?? "18083"}`;
export const RELEASE_BROWSER_BASE_URL = `http://127.0.0.1:${process.env.RELEASE_BROWSER_WEB_PORT ?? "18084"}`;

export function releaseBrowserBaseUrl(fallback: string): string {
  return process.env.RELEASE_BROWSER_LOCAL_SERVERS === "1"
    ? RELEASE_BROWSER_BASE_URL
    : fallback;
}

export function releaseBrowserWebServers():
  | PlaywrightTestConfig["webServer"]
  | undefined {
  if (process.env.RELEASE_BROWSER_LOCAL_SERVERS !== "1") return undefined;
  return [
    {
      command:
        `cd ../api-server && export NODE_ENV=development PORT=${process.env.RELEASE_BROWSER_API_PORT ?? "18083"} ` +
        "DATABASE_POOL_MAX=24 DISABLE_BACKGROUND_AUXILIARY_SCHEDULERS=1 && " +
        "pnpm run build && exec node --enable-source-maps ./dist/index.mjs",
      url: `${RELEASE_BROWSER_API_URL}/api/readyz`,
      reuseExistingServer: false,
      timeout: 300_000,
    },
    {
      command:
        `VITE_API_PROXY_TARGET=${RELEASE_BROWSER_API_URL} pnpm run build && ` +
        `VITE_API_PROXY_TARGET=${RELEASE_BROWSER_API_URL} exec ./node_modules/.bin/vite ` +
        `preview --config vite.config.ts --host 0.0.0.0 --port ${process.env.RELEASE_BROWSER_WEB_PORT ?? "18084"}`,
      url: RELEASE_BROWSER_BASE_URL,
      reuseExistingServer: false,
      timeout: 300_000,
    },
  ];
}