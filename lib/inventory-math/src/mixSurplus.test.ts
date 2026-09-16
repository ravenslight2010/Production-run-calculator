import { describe, it, expect } from "vitest";
import {
  buildMixSurplusRecording,
  type MixSurplusPlanGroup,
} from "./index";

// Structural stand-ins for buildMixPlan output (MixPlanGroup / MixPlanEntry are
// structurally assignable to these — mixId, name, totalLbs, remainingLbs, and
// run.brand/flavor are all that the recording math needs).
function planGroup(over: {
  runs?: Array<{ brand: string; flavor: string; mixes: Array<{ mixId: string; name: string; totalLbs: number; remainingLbs: number }> }>;
  prepMixes?: Array<{ mixId: string; name: string; totalLbs: number; remainingLbs: number }>;
}): MixSurplusPlanGroup {
  return { runs: over.runs ?? [], prepMixes: over.prepMixes ?? [] };
}

describe("buildMixSurplusRecording", () => {
  it("records a lot when actualMade exceeds the fresh remaining need", () => {
    const groups = [
      planGroup({
        runs: [
          {
            brand: "Bobo's",
            flavor: "Veggie",
            mixes: [
              { mixId: "m1", name: "Bobo's Veggie Mix", totalLbs: 117, remainingLbs: 50 },
            ],
          },
        ],
      }),
    ];
    const rows = buildMixSurplusRecording(groups, { m1: 60 });
    expect(rows).toEqual([
      { mixId: "m1", name: "Bobo's Veggie Mix", brand: "Bobo's", flavor: "Veggie", isPrep: false, amountMade: 60, amountRemaining: 10 },
    ]);
  });

  it("produces no row when actualMade is blank (assume needed convention)", () => {
    const groups = [
      planGroup({
        runs: [
          { brand: "Bobo's", flavor: "Veggie", mixes: [{ mixId: "m1", name: "Mix", totalLbs: 117, remainingLbs: 50 }] },
        ],
      }),
    ];
    expect(buildMixSurplusRecording(groups, {})).toEqual([]);
    expect(buildMixSurplusRecording(groups, { m1: 0 })).toEqual([]);
  });

  it("produces no row when actualMade is at or below the remaining need", () => {
    const groups = [
      planGroup({
        runs: [
          { brand: "Bobo's", flavor: "Veggie", mixes: [{ mixId: "m1", name: "Mix", totalLbs: 117, remainingLbs: 50 }] },
        ],
      }),
    ];
    expect(buildMixSurplusRecording(groups, { m1: 50 })).toEqual([]);
    expect(buildMixSurplusRecording(groups, { m1: 40 })).toEqual([]);
  });

  it("includes prep mixes with isPrep true and no brand/flavor", () => {
    const groups = [
      planGroup({
        prepMixes: [
          { mixId: "pm1", name: "Cheese Blend Prep", totalLbs: 80, remainingLbs: 30 },
        ],
      }),
    ];
    const rows = buildMixSurplusRecording(groups, { pm1: 45 });
    expect(rows).toEqual([
      { mixId: "pm1", name: "Cheese Blend Prep", brand: "", flavor: "", isPrep: true, amountMade: 45, amountRemaining: 15 },
    ]);
  });

  it("rounds surplus to 2 decimals", () => {
    const groups = [
      planGroup({
        runs: [
          { brand: "B", flavor: "F", mixes: [{ mixId: "m1", name: "Mix", totalLbs: 100, remainingLbs: 33.333 }] },
        ],
      }),
    ];
    const rows = buildMixSurplusRecording(groups, { m1: 40 });
    expect(rows[0]!.amountRemaining).toBe(6.67);
    expect(rows[0]!.amountMade).toBe(40);
  });
});
