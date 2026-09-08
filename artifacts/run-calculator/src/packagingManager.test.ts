import { describe, expect, it, vi } from "vitest";
import { createPackagingManager } from "./packagingManager";
import { DEFAULT_VALUES, type DayState, type FormValues, type RunMeta } from "./types";

function makeManager(valuesByRun: Record<string, FormValues>) {
  const currentRunIdRef = { current: "current" };
  const autoSuppressUntilRef = { current: 0 };
  const dayStateRef = {
    current: { runs: [], currentIndex: 0 } satisfies DayState,
  };
  const saveRunValues = vi.fn((runId: string, values: FormValues) => {
    valuesByRun[runId] = values;
  });
  const recordAutomaticProgress = vi.fn(() => ({ accepted: true }));
  const dependencies = {
    currentRunIdRef,
    autoSuppressUntilRef,
    dayStateRef,
    autoSuppressMs: 60_000,
    loadRunValues: (runId: string) => valuesByRun[runId] ?? DEFAULT_VALUES,
    saveRunValues,
    markRunValuesUpdated: vi.fn(),
    markLocalEdit: vi.fn(),
    schedulePush: vi.fn(),
    queueManualCorrection: vi.fn(),
    recordManualProgress: vi.fn(),
    recordAutomaticProgress,
  };
  return {
    manager: createPackagingManager(dependencies),
    dependencies,
    saveRunValues,
  };
}

function run(id: string, endedAt: number): RunMeta {
  return { id, brand: "Brand", flavor: id, startedAt: endedAt - 30 * 60_000, endedAt };
}

describe("packaging manager", () => {
  it("selects the latest eligible draining run after filtering completed runs", () => {
    const now = 1_000_000;
    const older = run("older", now - 4 * 60_000);
    const newerComplete = run("newer-complete", now - 2 * 60_000);
    const newestEligible = run("newest-eligible", now - 60_000);
    const values = {
      older: { ...DEFAULT_VALUES, freezerTime: 10, casesNeeded: 500, casesPerSkid: 100, skidsCompleted: 1 },
      "newer-complete": { ...DEFAULT_VALUES, freezerTime: 10, casesNeeded: 100, casesPerSkid: 100, skidsCompleted: 1 },
      "newest-eligible": { ...DEFAULT_VALUES, freezerTime: 10, casesNeeded: 500, casesPerSkid: 100, skidsCompleted: 2 },
    };
    const { manager } = makeManager(values);

    expect(manager.selectDrainingRun(
      [older, newerComplete, newestEligible],
      "current",
      now,
    )?.run.id).toBe("newest-eligible");
  });

  it("caps automatic drain advancement at the run target", () => {
    const values = {
      prior: {
        ...DEFAULT_VALUES,
        casesNeeded: 250,
        casesPerSkid: 100,
        skidsCompleted: 2,
        casesOnCurrentSkid: 45,
      },
    };
    const { manager, saveRunValues } = makeManager(values);
    const entry = { run: run("prior", 900_000), values: values.prior };

    manager.advanceDrainingRun(entry, 20);

    expect(saveRunValues).toHaveBeenCalledWith(
      "prior",
      expect.objectContaining({ skidsCompleted: 2, casesOnCurrentSkid: 50 }),
    );
  });

  it("does not persist an automatic write rejected by the progress register", () => {
    const values = { prior: { ...DEFAULT_VALUES, casesPerSkid: 100 } };
    const { manager, dependencies, saveRunValues } = makeManager(values);
    dependencies.recordAutomaticProgress.mockReturnValueOnce(null);

    manager.updateDrainingRun("prior", { casesOnCurrentSkid: 1 }, "auto");

    expect(saveRunValues).not.toHaveBeenCalled();
    expect(dependencies.schedulePush).not.toHaveBeenCalled();
  });

  it("records manual correction ownership and shares the suppression deadline", () => {
    vi.spyOn(Date, "now").mockReturnValue(500);
    const values = { current: { ...DEFAULT_VALUES, casesPerSkid: 100 } };
    const { manager, dependencies } = makeManager(values);

    manager.persistManualProgress("current", 1, 24, 2_000);

    expect(dependencies.recordManualProgress).toHaveBeenCalledWith({
      runId: "current",
      skidsCompleted: 1,
      casesOnCurrentSkid: 24,
      manualOverrideUntil: 2_000,
      now: 500,
    });
    expect(dependencies.queueManualCorrection).toHaveBeenCalledWith("current", {
      skidsCompleted: 1,
      casesOnCurrentSkid: 24,
    });
    expect(dependencies.autoSuppressUntilRef.current).toBe(2_000);
  });
});