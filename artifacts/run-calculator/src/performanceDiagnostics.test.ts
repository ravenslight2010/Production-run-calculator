import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearPerformanceDiagnostics,
  DIAGNOSTIC_INGESTION_TRANSPORTS,
  fetchDiagnosticIngestion,
  fetchWithDiagnostics,
  getMemoryDiagnostics,
  getPerformanceDiagnostics,
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
      expect.objectContaining({ name: "api:/api/inventory/items:200", kind: "api" }),
    ]);
    expect(JSON.stringify(getPerformanceDiagnostics())).not.toContain("private-data");
  });

  it("records a sanitized network failure category and rethrows the original error", async () => {
    const failure = new TypeError("network failure");
    vi.stubGlobal("fetch", vi.fn(async () => { throw failure; }));

    await expect(fetchWithDiagnostics("/api/items?secret=private-data")).rejects.toBe(failure);

    expect(getPerformanceDiagnostics()).toEqual([
      expect.objectContaining({ name: "api-failure:/api/items:network", kind: "api" }),
    ]);
    expect(JSON.stringify(getPerformanceDiagnostics())).not.toContain("private-data");
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