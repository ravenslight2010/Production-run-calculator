import { beforeEach, describe, expect, it } from "vitest";
import {
  loadPackagingProgress,
  overlayPackagingProgress,
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