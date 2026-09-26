import { beforeEach, describe, expect, it } from "vitest";
import {
  getEqualPackagingProgress,
  loadPackagingProgress,
  overlayPackagingProgress,
  overlayPackagingProgressForRun,
  reconcilePackagingProgress,
  recordAutomaticPackagingProgress,
  recordManualPackagingProgress,
} from "./packagingProgress";
import { DEFAULT_VALUES } from "./types";

describe("packaging progress register", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("keeps a newer downward manual correction over a later old-generation auto write", () => {
    const correction = {
      skidsCompleted: 1,
      casesOnCurrentSkid: 24,
      correctionGeneration: 2,
      updatedAt: 200,
      manualOverrideUntil: 60_200,
    };
    const staleAuto = {
      skidsCompleted: 1,
      casesOnCurrentSkid: 36,
      correctionGeneration: 1,
      updatedAt: 10_000,
      manualOverrideUntil: 0,
    };

    const result = reconcilePackagingProgress(
      { run1: correction },
      { run1: staleAuto },
    );

    expect(result.merged.run1).toEqual(correction);
    expect(result.rejectedRemoteIds.has("run1")).toBe(true);
  });

  it("accepts same-generation automatic advancement after adoption", () => {
    const result = reconcilePackagingProgress(
      {
        run1: {
          skidsCompleted: 1,
          casesOnCurrentSkid: 24,
          correctionGeneration: 2,
          updatedAt: 200,
          manualOverrideUntil: 250,
        },
      },
      {
        run1: {
          skidsCompleted: 1,
          casesOnCurrentSkid: 25,
          correctionGeneration: 2,
          updatedAt: 300,
          manualOverrideUntil: 250,
        },
      },
    );

    expect(result.merged.run1.casesOnCurrentSkid).toBe(25);
    expect(result.acceptedRemoteIds.has("run1")).toBe(true);
  });

  it("identifies equal-version echoes without treating stale or newer candidates as equal", () => {
    const durable = {
      skidsCompleted: 1,
      casesOnCurrentSkid: 26,
      correctionGeneration: 3,
      updatedAt: 400,
      manualOverrideUntil: 900,
    };
    const equalVersion = {
      ...durable,
      casesOnCurrentSkid: 28,
    };

    const merged = reconcilePackagingProgress({ run1: durable }, { run1: equalVersion });
    expect(merged.acceptedRemoteIds.has("run1")).toBe(false);
    expect(getEqualPackagingProgress({ run1: durable }, { run1: equalVersion }, "run1"))
      .toEqual(durable);
    expect(getEqualPackagingProgress(
      { run1: durable },
      { run1: { ...durable, updatedAt: 399 } },
      "run1",
    )).toBeUndefined();
    expect(getEqualPackagingProgress(
      { run1: durable },
      { run1: { ...durable, updatedAt: 401 } },
      "run1",
    )).toBeUndefined();
  });

  it("preserves established metadata when a legacy payload omits it", () => {
    const local = {
      run1: {
        skidsCompleted: 1,
        casesOnCurrentSkid: 24,
        correctionGeneration: 2,
        updatedAt: 200,
        manualOverrideUntil: 60_200,
      },
    };

    expect(reconcilePackagingProgress(local, undefined).merged).toEqual(local);
  });

  it("keeps reload hydration isolated when two runs have independent progress", () => {
    recordManualPackagingProgress({
      runId: "prior-run",
      skidsCompleted: 3,
      casesOnCurrentSkid: 8,
      manualOverrideUntil: 1_100,
      now: 100,
    });
    recordManualPackagingProgress({
      runId: "selected-run",
      skidsCompleted: 1,
      casesOnCurrentSkid: 4,
      manualOverrideUntil: 2_100,
      now: 1_100,
    });

    const persisted = loadPackagingProgress();
    const priorValues = overlayPackagingProgressForRun("prior-run", {
      ...DEFAULT_VALUES,
      casesNeeded: 500,
      skidsCompleted: 0,
      casesOnCurrentSkid: 0,
    }, persisted);
    const selectedValues = overlayPackagingProgressForRun("selected-run", {
      ...DEFAULT_VALUES,
      casesNeeded: 300,
      skidsCompleted: 9,
      casesOnCurrentSkid: 9,
    }, persisted);

    expect(priorValues).toMatchObject({
      casesNeeded: 500,
      skidsCompleted: 3,
      casesOnCurrentSkid: 8,
    });
    expect(selectedValues).toMatchObject({
      casesNeeded: 300,
      skidsCompleted: 1,
      casesOnCurrentSkid: 4,
    });
  });

  it("reconciles each remote run without replacing another run's progress", () => {
    const local = {
      "prior-run": {
        skidsCompleted: 3,
        casesOnCurrentSkid: 8,
        correctionGeneration: 1,
        updatedAt: 100,
        manualOverrideUntil: 0,
      },
      "selected-run": {
        skidsCompleted: 1,
        casesOnCurrentSkid: 4,
        correctionGeneration: 2,
        updatedAt: 200,
        manualOverrideUntil: 0,
      },
    };
    const remote = {
      "prior-run": {
        skidsCompleted: 4,
        casesOnCurrentSkid: 2,
        correctionGeneration: 1,
        updatedAt: 50,
        manualOverrideUntil: 0,
      },
      "selected-run": {
        skidsCompleted: 1,
        casesOnCurrentSkid: 5,
        correctionGeneration: 2,
        updatedAt: 300,
        manualOverrideUntil: 0,
      },
    };

    const result = reconcilePackagingProgress(local, remote);

    expect(result.merged["prior-run"]).toEqual(local["prior-run"]);
    expect(result.merged["selected-run"]).toEqual(remote["selected-run"]);
    expect(result.rejectedRemoteIds.has("prior-run")).toBe(true);
    expect(result.acceptedRemoteIds.has("selected-run")).toBe(true);
  });

  it("shares the manual deadline and resumes auto from the adopted generation", () => {
    const manual = recordManualPackagingProgress({
      runId: "run1",
      skidsCompleted: 1,
      casesOnCurrentSkid: 24,
      manualOverrideUntil: 1_100,
      now: 100,
    });

    expect(recordAutomaticPackagingProgress({
      runId: "run1",
      skidsCompleted: 1,
      casesOnCurrentSkid: 25,
      now: 1_000,
    })).toBeNull();

    const resumed = recordAutomaticPackagingProgress({
      runId: "run1",
      skidsCompleted: 1,
      casesOnCurrentSkid: 25,
      now: 1_101,
    });

    expect(resumed).toMatchObject({
      skidsCompleted: 1,
      casesOnCurrentSkid: 25,
      correctionGeneration: manual.correctionGeneration,
      manualOverrideUntil: 1_100,
    });
    expect(loadPackagingProgress().run1).toEqual(resumed);
  });

  it("overlays the winning pair without touching unrelated run settings", () => {
    const values = {
      ...DEFAULT_VALUES,
      casesNeeded: 500,
      casesPerSkid: 48,
      speedAdjustment: 1.25,
      skidsCompleted: 1,
      casesOnCurrentSkid: 36,
    };

    const overlaid = overlayPackagingProgress(values, {
      skidsCompleted: 1,
      casesOnCurrentSkid: 24,
      correctionGeneration: 2,
      updatedAt: 200,
      manualOverrideUntil: 60_200,
    });

    expect(overlaid).toMatchObject({
      casesNeeded: 500,
      casesPerSkid: 48,
      speedAdjustment: 1.25,
      skidsCompleted: 1,
      casesOnCurrentSkid: 24,
    });
  });
});