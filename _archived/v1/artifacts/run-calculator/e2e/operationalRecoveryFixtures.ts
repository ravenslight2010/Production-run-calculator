import type { BrowserContext, Page } from "@playwright/test";

export type ManualFetchGateResult = {
  request: {
    path: string;
    method: string;
    id: string;
    runId: string;
    section: string;
  };
  response?: {
    status: number;
    ok: boolean;
    path: string;
    json?: unknown;
    jsonReadError?: string;
  };
  transportError?: {
    name: string;
    message: string;
  };
};

/** Delay the real transport, including requests owned by an application worker. */
export async function installManualFetchGate(page: Page): Promise<void> {
  await page.evaluate(() => {
    const target = window as Window & { __continuationManualGate?: any };
    if (target.__continuationManualGate) throw new Error("Manual fetch gate already installed");
    const original = window.fetch.bind(window);
    let release!: () => void;
    const released = new Promise<void>((resolve) => { release = resolve; });
    const gate: any = { original, release, released, request: undefined, result: undefined };
    target.__continuationManualGate = gate;
    window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const inputRequest = input instanceof Request ? input : undefined;
      const url = new URL(inputRequest?.url ?? String(input), window.location.href);
      const method = init?.method ?? inputRequest?.method ?? "GET";
      if (!gate.request && url.pathname === "/api/sync/manual-section" && method === "POST") {
        // Inspect a clone without consuming Request inputs or changing the
        // argument shape seen by the application's installed fetch wrappers.
        const request = new Request(input instanceof Request ? input.clone() : input, init);
        const body = JSON.parse(await request.clone().text());
        gate.request = {
          path: url.pathname,
          method: request.method,
          body,
        };
        await released;
        const identity = {
          path: url.pathname,
          method: request.method,
          id: String(body?.id ?? ""),
          runId: String(body?.runId ?? ""),
          section: String(body?.section ?? ""),
        };
        try {
          const response = await original(input, init);
          let json: unknown;
          let jsonReadError: string | undefined;
          try {
            json = await response.clone().json();
          } catch (error) {
            jsonReadError = error instanceof Error ? error.name : "ResponseBodyParseError";
          }
          gate.result = {
            request: identity,
            response: {
              status: response.status,
              ok: response.ok,
              path: response.url ? new URL(response.url).pathname : url.pathname,
              json,
              ...(jsonReadError ? { jsonReadError } : {}),
            },
          };
          return response;
        } catch (error) {
          gate.result = {
            request: identity,
            transportError: {
              name: error instanceof Error ? error.name : "UnknownTransportError",
              message: "The original fetch rejected before a Response was available.",
            },
          };
          throw error;
        }
      }
      return original(input, init);
    }) as typeof window.fetch;
  });
}

export async function capturedManualRequest(page: Page): Promise<{
  path: string;
  method: string;
  body: {
    id: string;
    runId: string;
    section: string;
    values: Record<string, number>;
    baseValues: Record<string, number>;
  };
}> {
  await page.waitForFunction(
    () => Boolean((window as Window & { __continuationManualGate?: any }).__continuationManualGate?.request),
    undefined,
    { timeout: 10_000 },
  );
  return await page.evaluate(() =>
    (window as Window & { __continuationManualGate: any }).__continuationManualGate.request,
  );
}

export async function releaseManualFetchGate(page: Page): Promise<void> {
  await page.evaluate(() => {
    const target = window as Window & { __continuationManualGate?: any };
    const gate = target.__continuationManualGate;
    if (!gate) return;
    window.fetch = gate.original;
    gate.release();
  });
}

/** Release and inspect the genuine fetch result without depending on Playwright's
 * response-to-request body association (which can differ through a service worker).
 */
export async function releaseAndCaptureManualFetchGate(page: Page): Promise<ManualFetchGateResult> {
  await releaseManualFetchGate(page);
  await page.waitForFunction(
    () => Boolean((window as Window & { __continuationManualGate?: any }).__continuationManualGate?.result),
    undefined,
    { timeout: 10_000 },
  );
  const result = await page.evaluate(() =>
    (window as Window & { __continuationManualGate: any }).__continuationManualGate.result,
  ) as ManualFetchGateResult;
  await page.evaluate(() => {
    delete (window as Window & { __continuationManualGate?: any }).__continuationManualGate;
  });
  return result;
}

export async function reconnectAtSessionBoundary(
  fixture: { context: BrowserContext; page: Page },
): Promise<void> {
  await fixture.context.setOffline(false);
  // Reconnect can already have revalidated the session. Otherwise activate the
  // visible retry control atomically, without injecting an identity or reloading.
  await fixture.page.evaluate(() => {
    const retry = document.querySelector<HTMLButtonElement>('[data-testid="auth-startup-retry"]');
    if (retry && retry.getClientRects().length > 0 && !retry.disabled) retry.click();
  });
  await fixture.page.getByTestId("tab-run").waitFor({ state: "visible", timeout: 20_000 });
}
