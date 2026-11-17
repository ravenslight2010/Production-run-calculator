import { describe, expect, it, vi } from "vitest";
import {
  buildActiveRunIds,
  buildPersistedRunValues,
  buildRunSummarySnapshot,
  overlayCurrentRunValues,
} from "./homePerformance";
import { saveRunValues, subscribeRunValuesWrites } from "./storage";
import type { FormValues, RunMeta } from "./types";

const makeValues = (casesNeeded: number): FormValues => ({
  casesNeeded,
  pizzasPerCase: 12,
} as FormValues);

describe("large-day home performance snapshots", () => {
  it("invalidates a cached day snapshot after any run-value write", () => {
    const changed = vi.fn();
    const unsubscribe = subscribeRunValuesWrites(changed);

    saveRunValues("background-run", makeValues(25));

    expect(changed).toHaveBeenCalledTimes(1);
    expect(changed).toHaveBeenCalledWith("background-run");
    unsubscribe();
    localStorage.removeItem("run-calc-run-background-run");
  });

  it("reads persisted values once and overlays the active form without rescanning storage", () => {
    const runs = Array.from({ length: 250 }, (_, index) => ({
      id: `run-${index}`,
      brand: `Brand ${index}`,
      endedAt: index % 3 === 0 ? Date.now() : undefined,
    })) as RunMeta[];
    let reads = 0;
    const startedAt = performance.now();
    const persisted = buildPersistedRunValues(runs, (id) => {
      reads += 1;
      return makeValues(Number(id.slice(4)) + 1);
    });
    const valuesById = overlayCurrentRunValues(persisted, "run-125", makeValues(999));
    const summaries = buildRunSummarySnapshot(runs, valuesById, (values) => ({
      cases: values.casesNeeded,
      pizzas: values.casesNeeded * values.pizzasPerCase,
    }));
    const durationMs = performance.now() - startedAt;

    expect(reads).toBe(250);
    expect(valuesById.get("run-125")?.casesNeeded).toBe(999);
    expect(summaries.get("run-125")).toEqual({ cases: 999, pizzas: 11_988 });
    expect(buildActiveRunIds(runs)).toHaveLength(166);
    // A deliberately generous CI budget: this protects against accidental
    // quadratic scans without creating timing flakes on shared runners.
    expect(durationMs).toBeLessThan(100);
  });
});