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
        `PORT=${process.env.RELEASE_BROWSER_API_PORT ?? "18083"} DATABASE_POOL_MAX=24 DISABLE_BACKGROUND_AUXILIARY_SCHEDULERS=1 ` +
        "pnpm --filter @workspace/api-server run dev:without-schema-push",
      url: `${RELEASE_BROWSER_API_URL}/api/readyz`,
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command:
        `VITE_API_PROXY_TARGET=${RELEASE_BROWSER_API_URL} ` +
        "pnpm --filter @workspace/run-calculator run build && " +
        `VITE_API_PROXY_TARGET=${RELEASE_BROWSER_API_URL} ` +
        `pnpm --filter @workspace/run-calculator run serve --port ${process.env.RELEASE_BROWSER_WEB_PORT ?? "18084"}`,
      url: RELEASE_BROWSER_BASE_URL,
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ];
}