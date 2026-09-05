import { describe, expect, it } from "vitest";
import { DEFAULT_VALUES, type FormValues, type RunMeta } from "./types";
import { isolatePendingRunPackagingProgress } from "./runProgressIsolation";

const CONTAMINATED_VALUES: FormValues = {
  ...DEFAULT_VALUES,
  casesNeeded: 144,
  casesPerSkid: 72,
  skidsCompleted: 2,
  casesOnCurrentSkid: 41,
  traysOnLine: 18,
  batchesReady: 3,
  sauceBarrelsMade: 2,
  sauceBarrelAnchorNetSec: 240,
  sauceBarrelCorrectionGeneration: 4,
  app1BatchesMade: 3,
  app1BatchAnchorNetSec: 180,
  app1BatchCorrectionGeneration: 2,
};

describe("isolatePendingRunPackagingProgress", () => {
  it("removes another run's Packaging completion from an unstarted run", () => {
    const pendingRun: RunMeta = { id: "pending", brand: "B", flavor: "F" };

    const result = isolatePendingRunPackagingProgress(pendingRun, CONTAMINATED_VALUES);

    expect(result.skidsCompleted).toBe(0);
    expect(result.casesOnCurrentSkid).toBe(0);
    expect(result.casesNeeded).toBe(144);
    expect(result.traysOnLine).toBe(18);
    expect(result.batchesReady).toBe(3);
    expect(result.sauceBarrelsMade).toBe(0);
    expect(result.sauceBarrelAnchorNetSec).toBe(0);
    expect(result.sauceBarrelCorrectionGeneration).toBe(0);
    expect(result.app1BatchesMade).toBe(0);
    expect(result.app1BatchAnchorNetSec).toBe(0);
    expect(result.app1BatchCorrectionGeneration).toBe(0);
  });

  it("preserves progress for the run that actually started", () => {
    const startedRun: RunMeta = {
      id: "started",
      brand: "A",
      flavor: "F",
      startedAt: 1_000,
    };

    expect(isolatePendingRunPackagingProgress(startedRun, CONTAMINATED_VALUES))
      .toBe(CONTAMINATED_VALUES);
  });

  it("keeps an already-clean pending value object stable", () => {
    const pendingRun: RunMeta = { id: "pending", brand: "", flavor: "" };
    const clean = {
      ...CONTAMINATED_VALUES,
      skidsCompleted: 0,
      casesOnCurrentSkid: 0,
      sauceBarrelsMade: 0,
      sauceBarrelAnchorNetSec: 0,
      sauceBarrelCorrectionGeneration: 0,
      app1BatchesMade: 0,
      app1BatchAnchorNetSec: 0,
      app1BatchCorrectionGeneration: 0,
    };

    expect(isolatePendingRunPackagingProgress(pendingRun, clean)).toBe(clean);
  });
});