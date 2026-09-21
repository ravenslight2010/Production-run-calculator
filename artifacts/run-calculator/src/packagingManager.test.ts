import { describe, expect, it, vi } from "vitest";
import { createPackagingManager, createPackagingControlAdapter, runUnlockedManualSectionAction } from "./packagingManager";
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
  it("blocks every packaging adapter mutation while a peer lock is live", () => {
    const applyProgress = vi.fn();
    const reportCorrection = vi.fn();
    const vibrate = vi.fn();
    let locked = true;
    const adapter = createPackagingControlAdapter({
      skidsCompleted: 1, casesOnCurrentSkid: 2, casesPerSkid: 10,
      applyProgress, reportCorrection, vibrate, isLocked: () => locked,
    });
    adapter.apply(2, 3); adapter.setTotal(30); adapter.decrementSkids(); adapter.incrementSkids(); adapter.decrementCases(); adapter.incrementCases(); adapter.completeSkid();
    expect(applyProgress).not.toHaveBeenCalled();
    expect(reportCorrection).not.toHaveBeenCalled();
    expect(vibrate).not.toHaveBeenCalled();
    locked = false;
    adapter.completeSkid();
    expect(applyProgress).toHaveBeenCalledWith(2, 0);
  });
  it("runs guarded manual actions only after the peer lock releases", () => {
    let locked = true;
    const action = vi.fn();
    expect(runUnlockedManualSectionAction(() => locked, action)).toBe(false);
    expect(action).not.toHaveBeenCalled();
    locked = false;
    expect(runUnlockedManualSectionAction(() => locked, action)).toBe(true);
    expect(action).toHaveBeenCalledTimes(1);
  });
  it("guards the Floor Skid Done action before vibrate, persistence, and both form writes", () => {
    let locked = true;
    const vibrate = vi.fn();
    const persist = vi.fn();
    const setValue = vi.fn();
    const runFloorSkidDone = () => runUnlockedManualSectionAction(
      () => locked,
      () => {
        vibrate(15);
        persist("floor-run", 3, 0);
        setValue("skidsCompleted", 3, { shouldDirty: true });
        setValue("casesOnCurrentSkid", 0, { shouldDirty: true });
      },
    );
    expect(runFloorSkidDone()).toBe(false);
    expect(vibrate).not.toHaveBeenCalled();
    expect(persist).not.toHaveBeenCalled();
    expect(setValue).not.toHaveBeenCalled();
    locked = false;
    expect(runFloorSkidDone()).toBe(true);
    expect(vibrate).toHaveBeenCalledWith(15);
    expect(persist).toHaveBeenCalledWith("floor-run", 3, 0);
    expect(setValue).toHaveBeenCalledTimes(2);
  });
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

    manager.advanceDrainingRun(entry.run.id, entry.values, 20);

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

  it("persists a draining run by ID without applying it to a newly selected form", () => {
    const values = {
      prior: { ...DEFAULT_VALUES, casesPerSkid: 100 },
    };
    const { manager, dependencies } = makeManager(values);

    expect(manager.persistAutomaticProgress("prior", 2, 14)).toBe(false);
    expect(dependencies.recordAutomaticProgress).toHaveBeenCalledWith({
      runId: "prior",
      skidsCompleted: 2,
      casesOnCurrentSkid: 14,
    });

    dependencies.currentRunIdRef.current = "prior";
    expect(manager.persistAutomaticProgress("prior", 2, 15)).toBe(true);
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
    }, {
      skidsCompleted: 0,
      casesOnCurrentSkid: 0,
    });
    expect(dependencies.autoSuppressUntilRef.current).toBe(2_000);
  });
});