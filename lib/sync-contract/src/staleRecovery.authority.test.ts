import { describe, expect, it } from "vitest";
import { rebaseStaleSyncIntent } from "./staleBaseRecovery";

function fixture() {
  return {
    completeness: "complete",
    dayState: { date: "2030-01-01", runs: [{ id: "r", startedAt: 100, metaUpdatedAt: 100 }] },
    runValues: { r: { casesNeeded: 240, traysOnLine: 4 } },
    runValuesUpdatedAt: { r: 100 },
    packagingProgress: { r: { casesOnCurrentSkid: 12, skidsCompleted: 1, correctionGeneration: 0, updatedAt: 100 } },
  };
}

describe("command-owned stale recovery", () => {
  it("recovers ordinary setup while adopting peer lifecycle, totals and baselines", () => {
    const base = fixture(), local = fixture(), canonical = fixture();
    local.runValues.r.casesNeeded = 250;
    canonical.runValues.r.traysOnLine = 8;
    Object.assign(canonical.dayState.runs[0], { pausedAt: 300, metaUpdatedAt: 300 });
    canonical.packagingProgress.r.casesOnCurrentSkid = 24;
    canonical.packagingProgress.r.correctionGeneration = 4;
    Object.assign(canonical, { doughTimerControls: { r: { paused: true, pausedAt: 300, updatedAt: 300 } } });
    const originals = JSON.stringify({ base, local, canonical });
    const result = rebaseStaleSyncIntent(base, local, canonical, { enforceOperationalAuthority: true });
    expect(result.reviewRequiredChanges).toBe(0);
    expect(result.payload.runValues).toMatchObject({ r: { casesNeeded: 250, traysOnLine: 8 } });
    expect(result.payload.dayState).toMatchObject({ runs: [{ pausedAt: 300, metaUpdatedAt: 300 }] });
    expect(result.payload.packagingProgress).toEqual(canonical.packagingProgress);
    expect(JSON.stringify({ base, local, canonical })).toBe(originals);
  });

  it("classifies legacy counter and lifecycle changes for review without replaying them", () => {
    const base = fixture(), local = fixture(), canonical = fixture();
    local.runValues.r.traysOnLine = 1;
    Object.assign(local.dayState.runs[0], { endedAt: 500 });
    canonical.runValues.r.traysOnLine = 8;
    const result = rebaseStaleSyncIntent(base, local, canonical, { enforceOperationalAuthority: true });
    expect(result.reviewRequiredChanges).toBeGreaterThan(0);
    expect(result.payload.runValues).toMatchObject({ r: { traysOnLine: 8 } });
    expect((result.payload.dayState as { runs: object[] }).runs[0]).not.toHaveProperty("endedAt");
  });

  it("does not mistake absent legacy numeric defaults for a correction", () => {
    const base = fixture(), local = fixture(), canonical = fixture();
    Object.assign(local.runValues.r, { sauceBarrelsMade: 0 });
    Object.assign(canonical.runValues.r, { sauceBarrelsMade: 7 });
    const result = rebaseStaleSyncIntent(base, local, canonical, { enforceOperationalAuthority: true });
    expect(result.reviewRequiredChanges).toBe(0);
    expect(result.payload.runValues).toMatchObject({ r: { sauceBarrelsMade: 7 } });
  });

  it("retains current timer controls instead of reapplying a saved hold", () => {
    const base = fixture(), local = fixture(), canonical = fixture();
    Object.assign(local, { doughTimerControls: { r: { paused: true, updatedAt: 200 } } });
    const result = rebaseStaleSyncIntent(base, local, canonical, { enforceOperationalAuthority: true });
    expect(result.reviewRequiredChanges).toBeGreaterThan(0);
    expect(result.payload).not.toHaveProperty("doughTimerControls");
  });
});
