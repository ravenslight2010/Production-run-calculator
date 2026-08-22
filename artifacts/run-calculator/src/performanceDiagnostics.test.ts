import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearPerformanceDiagnostics,
  fetchWithDiagnostics,
  getPerformanceDiagnostics,
  PERFORMANCE_BUDGETS,
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

  it("ignores invalid durations instead of polluting diagnostics", () => {
    recordPerformance("bad", Number.NaN, "load");
    recordPerformance("negative", -1, "navigation");
    expect(getPerformanceDiagnostics()).toEqual([]);
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
});