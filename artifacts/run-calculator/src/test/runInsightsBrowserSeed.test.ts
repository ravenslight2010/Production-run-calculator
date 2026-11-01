// @vitest-environment jsdom
import { runInNewContext } from "node:vm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  seedRunInsightsBrowserState,
  type RunInsightsBrowserSeed,
} from "./runInsightsBrowserSeed";

const scenario: RunInsightsBrowserSeed = {
  brand: "Synthetic Insights Brand",
  flavor: "Synthetic Insights Flavor",
  runId: "synthetic-insights-run",
};

class FixtureDate extends Date {
  constructor() {
    super("2026-11-01T16:00:00.000Z");
  }
}

// Exercise the serialized callback, not the importing module's closure.
// These are owned in-memory stores, not an app/browser/database startup.
function seedDocument(
  input = scenario,
  documentWindow: unknown = window,
): void {
  const seed = runInNewContext(`(${seedRunInsightsBrowserState.toString()})`, {
    window: documentWindow,
    localStorage,
    sessionStorage,
    Date: FixtureDate,
  }) as typeof seedRunInsightsBrowserState;
  seed(input);
}

function savedDay(): Record<string, unknown> {
  return JSON.parse(localStorage.getItem("run-calc-day")!) as Record<string, unknown>;
}

beforeEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  sessionStorage.clear();
});

describe("Run Insights browser seed ownership", () => {
  it("serializes independently and initializes the intended synthetic run", () => {
    seedDocument();
    expect(savedDay()).toMatchObject({
      runs: [{ id: scenario.runId, brand: scenario.brand, flavor: scenario.flavor, seeded: false }],
      date: "2026-11-01",
      resetAt: 0,
      currentIndex: 0,
      substitutions: [],
      substitutionLog: [],
      stagedItems: {},
      prepPhase: {
        prepStartedAt: null,
        prepBatchesDough: 0,
        prepBatchesSauce: 0,
        prepCarriedOver: false,
      },
    });
    expect(localStorage.getItem(`run-calc-run-${scenario.runId}`)).toBe("{}");
    expect(localStorage.getItem("run-calc-purge-orphaned-profiles-v1")).toBe("1");
  });

  it("preserves acknowledged day and run bytes when the document reloads", () => {
    seedDocument();
    const canonicalDay = JSON.stringify({ ...savedDay(), resetAt: 1234567 });
    const canonicalRun = JSON.stringify({ cycleSpeed: 9, casesNeeded: 200 });
    localStorage.setItem("run-calc-day", canonicalDay);
    localStorage.setItem(`run-calc-run-${scenario.runId}`, canonicalRun);

    seedDocument();

    expect(localStorage.getItem("run-calc-day")).toBe(canonicalDay);
    expect(localStorage.getItem(`run-calc-run-${scenario.runId}`)).toBe(canonicalRun);
  });

  it("does not seed a child frame", () => {
    seedDocument(scenario, { top: window });
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });

  it("can initialize a fresh independent session for the same scenario", () => {
    seedDocument();
    localStorage.clear();
    sessionStorage.clear();
    seedDocument();
    expect(savedDay().runs).toEqual([
      { id: scenario.runId, brand: scenario.brand, flavor: scenario.flavor, seeded: false },
    ]);
  });

  it("keeps distinct explicitly selected synthetic scenarios separate", () => {
    seedDocument();
    const other = { ...scenario, runId: "another-synthetic-insights-run" };
    seedDocument(other);
    expect(savedDay().runs).toEqual([
      { id: other.runId, brand: other.brand, flavor: other.flavor, seeded: false },
    ]);
    expect(localStorage.getItem(`run-calc-run-${other.runId}`)).toBe("{}");
  });

  it("does not mark a failed storage initialization as successful", () => {
    const write = vi.spyOn(Storage.prototype, "setItem").mockImplementationOnce(() => {
      throw new Error("synthetic fixture storage unavailable");
    });
    expect(() => seedDocument()).toThrow("synthetic fixture storage unavailable");
    write.mockRestore();
    seedDocument();
    expect(savedDay().runs).toEqual([
      { id: scenario.runId, brand: scenario.brand, flavor: scenario.flavor, seeded: false },
    ]);
  });
});
