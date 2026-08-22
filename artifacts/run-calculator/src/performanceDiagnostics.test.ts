import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearPerformanceDiagnostics,
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
});