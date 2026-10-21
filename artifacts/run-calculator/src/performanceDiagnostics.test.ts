import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearPerformanceDiagnostics,
  DIAGNOSTIC_INGESTION_TRANSPORTS,
  fetchDiagnosticIngestion,
  fetchWithDiagnostics,
  getMemoryDiagnostics,
  getPerformanceDiagnostics,
  installApiRequestInstrumentation,
  markExpectedAuthLifecycleCancellation,
  PERFORMANCE_BUDGETS,
  recordBrowserLoadTimings,
  recordDeferredStartup,
  recordMemorySample,
  recordPerformance,
} from "./performanceDiagnostics";

describe("calculator performance diagnostics", () => {
  afterEach(() => {
    clearPerformanceDiagnostics();
    vi.restoreAllMocks();
  });

  it("records only bounded, privacy-safe timing fields", () => {
    for (let i = 0; i < 50; i += 1) {
      recordPerformance(`tab:${i}`, i, "navigation");
    }
    const diagnostics = getPerformanceDiagnostics();
    expect(diagnostics).toHaveLength(40);
    expect(diagnostics[0]?.name).toBe("tab:10");
    expect(diagnostics[39]).toEqual({ name: "tab:49", durationMs: 49, kind: "navigation" });
    expect(Object.keys(diagnostics[0] ?? {}).sort()).toEqual(["durationMs", "kind", "name"]);
  });

  it("warns when a measured operation exceeds its documented budget", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    recordPerformance("initial-load", PERFORMANCE_BUDGETS.initialLoadMs + 1, "load");
    recordPerformance("tab:warehouse", PERFORMANCE_BUDGETS.tabTransitionMs + 1, "navigation");
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn.mock.calls[0]?.[1]).toMatchObject({ name: "initial-load", budgetMs: 1500 });
    expect(warn.mock.calls[1]?.[1]).toMatchObject({ name: "tab:warehouse", budgetMs: 250 });
  });

  it("records browser navigation milestones without retaining page data", () => {
    vi.spyOn(performance, "getEntriesByType").mockReturnValue([
      {
        startTime: 0,
        domContentLoadedEventEnd: 125,
        loadEventEnd: 240,
      } as PerformanceNavigationTiming,
    ]);

    recordBrowserLoadTimings();

    expect(getPerformanceDiagnostics()).toEqual([
      {
        name: "browser:navigation-to-dom-content-loaded",
        durationMs: 125,
        kind: "load",
      },
      {
        name: "browser:navigation-to-load",
        durationMs: 240,
        kind: "load",
      },
    ]);
  });

  it("applies calculation and storage budgets", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    recordPerformance("live-calculation", PERFORMANCE_BUDGETS.calculationMs + 1, "calculation");
    recordPerformance("run-values-storage-scan", PERFORMANCE_BUDGETS.storageScanMs + 1, "storage");
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it("ignores invalid durations instead of polluting diagnostics", () => {
    recordPerformance("bad", Number.NaN, "load");
    recordPerformance("negative", -1, "navigation");
    expect(getPerformanceDiagnostics()).toEqual([]);
  });

  it("distinguishes intentionally deferred startup work from failed requests", () => {
    recordDeferredStartup("cycle-count-schedules");
    expect(getPerformanceDiagnostics()).toEqual([
      {
        name: "startup-deferred:cycle-count-schedules",
        durationMs: 0,
        kind: "deferred",
      },
    ]);
  });

  it("records API status without retaining query strings or payloads", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));

    await fetchWithDiagnostics("/api/inventory/items?customer=private-data", {
      method: "POST",
      body: JSON.stringify({ customer: "private-data" }),
    });

    expect(getPerformanceDiagnostics()).toEqual([
      expect.objectContaining({ name: "api:inventory:200", kind: "api" }),
    ]);
    expect(JSON.stringify(getPerformanceDiagnostics())).not.toContain("private-data");
  });

  it("records a sanitized network failure category and rethrows the original error", async () => {
    const failure = new TypeError("network failure");
    vi.stubGlobal("fetch", vi.fn(async () => { throw failure; }));

    await expect(fetchWithDiagnostics("/api/items?secret=private-data")).rejects.toBe(failure);

    expect(getPerformanceDiagnostics()).toEqual([
      expect.objectContaining({ name: "api-request-failure:other:transport_failure", kind: "api" }),
    ]);
    expect(JSON.stringify(getPerformanceDiagnostics())).not.toContain("private-data");
  });

  it("separates HTTP 500 from transport errors and keeps only safe request metadata", async () => {
    const listener = vi.fn();
    window.addEventListener("app:api-failure", listener);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("private response body", {
      status: 500,
      headers: { "x-correlation-id": "018f3a8b-1b2c-4d3e-8f90-123456789abc" },
    })));

    await fetchWithDiagnostics("/api/sync/private-record?customer=private-data");

    const detail = listener.mock.calls[0]?.[0] && (listener.mock.calls[0][0] as CustomEvent).detail;
    expect(detail).toMatchObject({
      operationCategory: "sync",
      requestRoute: "sync_other",
      requestOutcome: "http_server_error",
      httpStatus: 500,
      correlationId: "018f3a8b-1b2c-4d3e-8f90-123456789abc",
    });
    expect(detail).toHaveProperty("observedAt");
    expect(JSON.stringify(detail)).not.toMatch(/private-record|private-data|response body/);
    window.removeEventListener("app:api-failure", listener);
  });

  it("captures an allowlisted sync route and server reason code without response content", async () => {
    const listener = vi.fn();
    window.addEventListener("app:api-failure", listener);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      error: "private message",
      reasonCode: "SYNC_PAYLOAD_TOO_LARGE",
      privateField: "private-data",
    }), {
      status: 400,
      headers: { "content-type": "application/json" },
    })));

    await fetchWithDiagnostics("/api/sync/today?today=private-date", { method: "PUT" });

    const detail = (listener.mock.calls[0]?.[0] as CustomEvent).detail;
    expect(detail).toMatchObject({
      operationCategory: "sync",
      requestRoute: "sync_today_write",
      requestOutcome: "http_client_error",
      httpStatus: 400,
      reasonCode: "SYNC_PAYLOAD_TOO_LARGE",
    });
    expect(JSON.stringify(detail)).not.toMatch(/private message|private-data|private-date/);
    window.removeEventListener("app:api-failure", listener);
  });

  it("reduces unrecognized sync validation responses to a fixed reason label", async () => {
    const listener = vi.fn();
    window.addEventListener("app:api-failure", listener);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      reasonCode: "private-user-data",
    }), {
      status: 400,
      headers: { "content-type": "application/json" },
    })));

    await fetchWithDiagnostics("/api/sync/today", { method: "PUT" });

    const detail = (listener.mock.calls[0]?.[0] as CustomEvent).detail;
    expect(detail.requestRoute).toBe("sync_today_write");
    expect(detail.reasonCode).toBe("SYNC_VALIDATION_FAILED");
    expect(JSON.stringify(detail)).not.toContain("private-user-data");
    window.removeEventListener("app:api-failure", listener);
  });

  it("instruments unwrapped same-origin API fetches without changing the response", async () => {
    const previousWindowFetch = window.fetch;
    const previousGlobalFetch = globalThis.fetch;
    const nativeStub = vi.fn(async () => new Response("{}", { status: 401 }));
    window.fetch = nativeStub as unknown as typeof fetch;
    globalThis.fetch = window.fetch;
    const uninstall = installApiRequestInstrumentation();
    const listener = vi.fn();
    window.addEventListener("app:api-failure", listener);
    try {
      const response = await window.fetch("/api/inventory/items/private-row?private=query");
      expect(response.status).toBe(401);
      expect(nativeStub).toHaveBeenCalledOnce();
      expect((listener.mock.calls[0]?.[0] as CustomEvent).detail).toMatchObject({
        operationCategory: "inventory",
        requestOutcome: "authentication_rejected",
        httpStatus: 401,
      });
      expect(JSON.stringify((listener.mock.calls[0]?.[0] as CustomEvent).detail))
        .not.toMatch(/private-row|private=query/);
    } finally {
      uninstall();
      window.removeEventListener("app:api-failure", listener);
      window.fetch = previousWindowFetch;
      globalThis.fetch = previousGlobalFetch;
    }
  });

  it("does not invent a server reference for a request that failed before a response", async () => {
    const listener = vi.fn();
    window.addEventListener("app:api-failure", listener);
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));

    await expect(fetchWithDiagnostics("/api/inventory/items/secret-id?token=secret")).rejects.toThrow();

    const detail = (listener.mock.calls[0]?.[0] as CustomEvent).detail;
    expect(detail).toMatchObject({
      operationCategory: "inventory",
      requestOutcome: "transport_failure",
      connectivity: "online",
    });
    expect(detail).not.toHaveProperty("correlationId");
    expect(JSON.stringify(detail)).not.toMatch(/secret-id|token|secret/);
    window.removeEventListener("app:api-failure", listener);
  });

  it("distinguishes explicit cancellation from timeout", async () => {
    const listener = vi.fn();
    const controller = new AbortController();
    window.addEventListener("app:api-failure", listener);
    vi.stubGlobal("fetch", ((_url: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init?.signal?.reason));
      })) as unknown as typeof fetch);

    const request = fetchWithDiagnostics("/api/sync/today", { signal: controller.signal });
    controller.abort();
    await expect(request).rejects.toMatchObject({ name: "AbortError" });
    expect((listener.mock.calls[0]?.[0] as CustomEvent).detail).toMatchObject({
      operationCategory: "sync",
      requestOutcome: "cancelled",
    });
    window.removeEventListener("app:api-failure", listener);
  });

  it("labels only explicitly marked auth lifecycle aborts and keeps them bounded", async () => {
    const listener = vi.fn();
    const controller = new AbortController();
    window.addEventListener("app:api-failure", listener);
    vi.stubGlobal("fetch", ((_url: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init?.signal?.reason), { once: true });
      })) as unknown as typeof fetch);

    const request = fetchWithDiagnostics("/api/me?private=query", { signal: controller.signal });
    markExpectedAuthLifecycleCancellation(controller.signal);
    controller.abort(new DOMException("private abort text", "AbortError"));
    await expect(request).rejects.toMatchObject({ name: "AbortError" });

    const detail = (listener.mock.calls[0]?.[0] as CustomEvent).detail;
    expect(detail).toMatchObject({
      operationCategory: "authentication",
      requestRoute: "authentication",
      requestOutcome: "cancelled",
      cancellationClassification: "expected_auth_lifecycle",
    });
    expect(JSON.stringify(detail)).not.toMatch(/private|query/);
    window.removeEventListener("app:api-failure", listener);
  });

  it("classifies an auth-probe deadline as timeout and keeps an HTTP 401 as authentication rejection", async () => {
    const listener = vi.fn();
    window.addEventListener("app:api-failure", listener);
    vi.stubGlobal("fetch", vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      if (init?.signal?.aborted) throw init.signal.reason;
      return new Response("{}", { status: 401 });
    }));

    const timeoutController = new AbortController();
    timeoutController.abort(new DOMException("private timeout text", "TimeoutError"));
    await expect(
      fetchWithDiagnostics("/api/me", { signal: timeoutController.signal }),
    ).rejects.toMatchObject({ name: "TimeoutError" });
    await fetchWithDiagnostics("/api/me");

    expect((listener.mock.calls[0]?.[0] as CustomEvent).detail).toMatchObject({
      operationCategory: "authentication",
      requestOutcome: "timeout",
    });
    expect((listener.mock.calls[1]?.[0] as CustomEvent).detail).toMatchObject({
      operationCategory: "authentication",
      requestOutcome: "authentication_rejected",
      httpStatus: 401,
    });
    expect(JSON.stringify(listener.mock.calls)).not.toContain("private timeout text");
    window.removeEventListener("app:api-failure", listener);
  });

  it("bounds an unsignalled read and records hidden/resumed involvement without server timing claims", async () => {
    vi.useFakeTimers();
    const listener = vi.fn();
    const oldVisibility = Object.getOwnPropertyDescriptor(document, "visibilityState");
    let resolveFetch: ((response: Response) => void) | undefined;
    window.addEventListener("app:api-failure", listener);
    vi.stubGlobal("fetch", ((_url: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((resolve, reject) => {
        resolveFetch = resolve;
        init?.signal?.addEventListener("abort", () => reject(init?.signal?.reason));
      })) as unknown as typeof fetch);
    const request = fetchWithDiagnostics("/api/inventory/items");
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    document.dispatchEvent(new Event("visibilitychange"));
    resolveFetch?.(new Response("{}", { status: 500 }));
    expect((await request).status).toBe(500);
    expect((listener.mock.calls[0]?.[0] as CustomEvent).detail).toMatchObject({
      operationCategory: "inventory",
      backgroundObserved: true,
    });

    vi.stubGlobal("fetch", ((_url: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init?.signal?.reason));
      })) as unknown as typeof fetch);
    const timeoutRequest = fetchWithDiagnostics("/api/inventory/items");
    const timeoutRejection = expect(timeoutRequest).rejects.toMatchObject({ name: "TimeoutError" });
    await vi.advanceTimersByTimeAsync(30_000);
    await timeoutRejection;
    expect((listener.mock.calls[1]?.[0] as CustomEvent).detail).toMatchObject({
      operationCategory: "inventory",
      requestOutcome: "timeout",
      elapsedMs: 30_000,
    });
    window.removeEventListener("app:api-failure", listener);
    if (oldVisibility) Object.defineProperty(document, "visibilityState", oldVisibility);
    else delete (document as Document & { visibilityState?: DocumentVisibilityState }).visibilityState;
    vi.useRealTimers();
  });

  it.each([
    ["TimeoutError", "timeout"],
    ["AbortError", "cancelled"],
  ] as const)("classifies %s separately without retaining reasons", async (name, outcome) => {
    const failure = new DOMException("private cancellation reason", name);
    vi.stubGlobal("fetch", vi.fn(async () => { throw failure; }));
    await expect(fetchWithDiagnostics("/api/items?private=query")).rejects.toBe(failure);
    expect(getPerformanceDiagnostics()).toEqual([
      expect.objectContaining({ name: `api-request-failure:other:${outcome}`, kind: "api" }),
    ]);
    expect(JSON.stringify(getPerformanceDiagnostics())).not.toContain("private");
  });

  it("declares a delivery-failure instrumentation policy for every known diagnostic transport", () => {
    expect(Object.values(DIAGNOSTIC_INGESTION_TRANSPORTS)).toEqual([
      {
        path: "/api/field-checks/observations",
        instrumentDeliveryFailures: false,
      },
      {
        path: "/api/field-checks/hardware-confirmations",
        instrumentDeliveryFailures: false,
      },
      {
        path: "/api/incidents",
        instrumentDeliveryFailures: false,
      },
    ]);
  });

  it.each(Object.entries(DIAGNOSTIC_INGESTION_TRANSPORTS))(
    "does not recursively observe diagnostic delivery failures for %s",
    async (transportName) => {
      const failure = new TypeError("network failure");
      vi.stubGlobal("fetch", vi.fn(async () => { throw failure; }));

      await expect(
        fetchDiagnosticIngestion(transportName as keyof typeof DIAGNOSTIC_INGESTION_TRANSPORTS),
      ).rejects.toBe(failure);

      expect(getPerformanceDiagnostics()).toEqual([]);
    },
  );

  it("rejects omitted or unregistered diagnostic transport policies at the type boundary", () => {
    // @ts-expect-error Diagnostic ingestion always requires a registered transport name.
    const missingPolicy = () => fetchDiagnosticIngestion();
    // @ts-expect-error Unknown diagnostic transports must be added to the reviewed registry first.
    const unknownPolicy = () => fetchDiagnosticIngestion("new-diagnostic-endpoint");

    expect([missingPolicy, unknownPolicy]).toHaveLength(2);
  });

  it("records bounded heap samples only when the browser exposes heap metrics", () => {
    Object.defineProperty(performance, "memory", {
      configurable: true,
      value: { usedJSHeapSize: 1_024, totalJSHeapSize: 2_048 },
    });
    for (let index = 0; index < 45; index += 1) recordMemorySample(`sample:${index}`);

    expect(getMemoryDiagnostics()).toHaveLength(40);
    expect(getMemoryDiagnostics()[0]).toEqual({
      name: "sample:5",
      usedHeapBytes: 1_024,
      totalHeapBytes: 2_048,
    });
  });
});