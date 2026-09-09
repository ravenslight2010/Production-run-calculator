import type { PlaywrightTestConfig } from "@playwright/test";

export const RELEASE_BROWSER_BASE_URL = "http://127.0.0.1:18084";
const RELEASE_BROWSER_API_URL = "http://127.0.0.1:18083";

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
        "PORT=18083 pnpm --filter @workspace/api-server run dev:without-schema-push",
      url: `${RELEASE_BROWSER_API_URL}/api/readyz`,
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command:
        `VITE_API_PROXY_TARGET=${RELEASE_BROWSER_API_URL} ` +
        "pnpm --filter @workspace/run-calculator run dev --port 18084",
      url: RELEASE_BROWSER_BASE_URL,
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ];
}