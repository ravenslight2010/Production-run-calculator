import { describe, expect, it } from "vitest";
import { computeEffectiveLineSpeed } from "./lineSpeed";
import { getAutoTrackTiming } from "./hooks/useAutoTrack";

describe("computeEffectiveLineSpeed", () => {
  const base = {
    mode: "dough" as const,
    crustsPerCycle: 10,
    cycleSpeed: 8,
    approxLineSpeed: 999,
  };

  it("scales dough PPM below and above the configured speed", () => {
    expect(computeEffectiveLineSpeed({ ...base, speedAdjustment: 0.75 })).toBe(60);
    expect(computeEffectiveLineSpeed({ ...base, speedAdjustment: 1.25 })).toBe(100);
  });

  it("uses approximate speed directly for crusts", () => {
    expect(computeEffectiveLineSpeed({ ...base, mode: "crusts", speedAdjustment: 0.5 })).toBe(999);
    expect(computeEffectiveLineSpeed({ ...base, mode: "crusts", approxLineSpeed: 42.678 })).toBe(42.68);
  });

  it("rounds dough speed once and disables invalid or zero inputs safely", () => {
    expect(computeEffectiveLineSpeed({ ...base, speedAdjustment: 0.333 })).toBe(26.64);
    expect(computeEffectiveLineSpeed({ ...base, crustsPerCycle: 0 })).toBe(0);
    expect(computeEffectiveLineSpeed({ ...base, cycleSpeed: 0 })).toBe(0);
    expect(computeEffectiveLineSpeed({ ...base, speedAdjustment: 0 })).toBe(0);
    expect(computeEffectiveLineSpeed({ ...base, speedAdjustment: undefined })).toBe(80);
    expect(computeEffectiveLineSpeed({ ...base, cycleSpeed: Number.NaN })).toBe(0);
  });
});

describe("getAutoTrackTiming line-speed basis", () => {
  it("scales line-demand timers while measured mixer and hopper timers stay fixed", () => {
    const machine = { spinSec: 30, hopperSec: 20 };
    const slower = getAutoTrackTiming(80, 12, 60, 600, machine);
    const faster = getAutoTrackTiming(120, 12, 60, 600, machine);

    expect(slower.caseMs).toBe(9_000);
    expect(faster.caseMs).toBe(6_000);
    expect(slower.trayMs).toBe(45_000);
    expect(faster.trayMs).toBe(30_000);
    expect(slower.batchConsumptionMs).toBe(112_500);
    expect(faster.batchConsumptionMs).toBe(75_000);
    expect(slower.batchProductionMs).toBe(30_000);
    expect(faster.batchProductionMs).toBe(30_000);
    expect(slower.hopperMs).toBe(20_000);
    expect(faster.hopperMs).toBe(20_000);
  });
});