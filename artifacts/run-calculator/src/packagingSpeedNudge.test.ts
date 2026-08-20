import { describe, expect, it } from "vitest";
import {
  acceptPackagingSpeedNudge,
  canDetectPackagingSpeedNudge,
  createPackagingSpeedNudgeTracking,
  dismissPackagingSpeedNudge,
  evaluatePackagingSpeedNudge,
  recordPackagingSpeedCorrection,
} from "./packagingSpeedNudge";

const BASE = {
  elapsedOutputMin: 10,
  configuredPpm: 120,
  pizzasPerCase: 12,
  speedAdjustment: 1.25,
  isCrust: false,
};

describe("packaging speed nudge", () => {
  it("uses repeated downward current-skid corrections even when auto-track is still ahead", () => {
    // Configured output is 100 cases. Auto-track is still showing 110 cases,
    // but two small corrections prove the physical line is at 96 cases.
    const nudge = evaluatePackagingSpeedNudge({
      ...BASE,
      displayedCases: 110,
      corrections: [{ deltaCases: -2 }, { deltaCases: -2 }],
    });

    expect(nudge).toEqual({
      direction: "slower",
      isCrust: false,
      value: 1.2,
    });
  });

  it("uses repeated upward corrections below the 10% drift threshold", () => {
    const nudge = evaluatePackagingSpeedNudge({
      ...BASE,
      displayedCases: 100,
      corrections: [{ deltaCases: 2 }, { deltaCases: 2 }],
    });

    expect(nudge).toEqual({
      direction: "faster",
      isCrust: false,
      value: 1.3,
    });
  });

  it("accepts a skid-sized correction as sufficient drift evidence", () => {
    // A single full skid is already well beyond the 10% threshold, so it does
    // not need a second tap before showing the slower recommendation.
    const nudge = evaluatePackagingSpeedNudge({
      ...BASE,
      displayedCases: 160,
      corrections: [{ deltaCases: -60 }],
    });

    expect(nudge).toMatchObject({
      direction: "slower",
      isCrust: false,
      value: 0.5,
    });
  });

  it("does not nudge for a lone correction below the 10% drift threshold", () => {
    const nudge = evaluatePackagingSpeedNudge({
      ...BASE,
      displayedCases: 100,
      corrections: [{ deltaCases: -2 }],
    });

    expect(nudge).toBeNull();
  });

  it("does not carry mixed correction directions into a speed recommendation", () => {
    const nudge = evaluatePackagingSpeedNudge({
      ...BASE,
      displayedCases: 100,
      corrections: [{ deltaCases: -20 }, { deltaCases: 20 }],
    });

    expect(nudge).toBeNull();
  });

  it("recommends the correction-adjusted dough speed adjustment", () => {
    const nudge = evaluatePackagingSpeedNudge({
      ...BASE,
      displayedCases: 100,
      corrections: [{ deltaCases: 10 }, { deltaCases: 10 }],
    });

    expect(nudge).toEqual({
      direction: "faster",
      isCrust: false,
      value: 1.5,
    });
  });

  it("recommends direct correction-adjusted ppm for crust runs", () => {
    const nudge = evaluatePackagingSpeedNudge({
      ...BASE,
      isCrust: true,
      displayedCases: 100,
      corrections: [{ deltaCases: 10 }, { deltaCases: 10 }],
    });

    expect(nudge).toEqual({
      direction: "faster",
      isCrust: true,
      value: 144,
    });
  });

  it("resets a correction episode on direction changes and preserves accept/dismiss lifecycle behavior", () => {
    let tracking = createPackagingSpeedNudgeTracking("run-a");
    tracking = recordPackagingSpeedCorrection(tracking, -5);
    tracking = recordPackagingSpeedCorrection(tracking, -5);
    tracking = recordPackagingSpeedCorrection(tracking, 5);

    expect(tracking.corrections).toEqual([{ deltaCases: 5 }]);

    tracking = acceptPackagingSpeedNudge(tracking, 1_000);
    expect(tracking.corrections).toEqual([]);
    expect(canDetectPackagingSpeedNudge(tracking, 30_999)).toBe(false);
    expect(canDetectPackagingSpeedNudge(tracking, 31_000)).toBe(true);

    tracking = dismissPackagingSpeedNudge(tracking);
    expect(canDetectPackagingSpeedNudge(tracking, 100_000)).toBe(false);
    expect(createPackagingSpeedNudgeTracking("run-b")).toEqual({
      runId: "run-b",
      corrections: [],
      dismissed: false,
      lastAcceptedAt: 0,
    });
  });
});