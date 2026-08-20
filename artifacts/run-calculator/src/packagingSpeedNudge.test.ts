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
  casesPerSkid: 60,
  speedAdjustment: 1.25,
  isCrust: false,
};

describe("packaging speed nudge", () => {
  it("uses repeated downward current-skid corrections even when auto-track is still ahead", () => {
    // Configured output is 100 cases. Auto-track is still showing 110 cases,
    // but two small corrections prove the physical line is at 96 cases.
    const evaluation = evaluatePackagingSpeedNudge({
      ...BASE,
      displayedCases: 110,
      corrections: [{ deltaCases: -2 }, { deltaCases: -2 }],
    });

    expect(evaluation).toEqual({
      nudge: {
        direction: "slower",
        isCrust: false,
        value: 1.2,
      },
      reason: null,
    });
  });

  it("shows a recommendation after exactly 30 seconds of output and two same-direction corrections", () => {
    const evaluation = evaluatePackagingSpeedNudge({
      ...BASE,
      elapsedOutputMin: 0.5,
      displayedCases: 5,
      corrections: [{ deltaCases: 1 }, { deltaCases: 1 }],
    });

    expect(evaluation.nudge).toMatchObject({
      direction: "faster",
      isCrust: false,
    });
    expect(evaluation.reason).toBeNull();
  });

  it("explains that a correction before 30 seconds of post-freezer output is waiting", () => {
    const evaluation = evaluatePackagingSpeedNudge({
      ...BASE,
      elapsedOutputMin: 29 / 60,
      displayedCases: 5,
      corrections: [{ deltaCases: 4 }],
    });

    expect(evaluation).toEqual({
      nudge: null,
      reason: {
        kind: "output-time",
        elapsedOutputSec: 29,
        requiredOutputSec: 30,
      },
    });
  });

  it("uses the rounded 5%-of-skid threshold for a one-correction shortcut", () => {
    // 5% of 61 is 3.05, so the single-correction shortcut needs four cases.
    const justEnough = evaluatePackagingSpeedNudge({
      ...BASE,
      casesPerSkid: 61,
      displayedCases: 100,
      corrections: [{ deltaCases: -4 }],
    });
    const oneShort = evaluatePackagingSpeedNudge({
      ...BASE,
      casesPerSkid: 61,
      displayedCases: 100,
      corrections: [{ deltaCases: -3 }],
    });

    expect(justEnough.nudge).toEqual({
      direction: "slower",
      isCrust: false,
      value: 1.2,
    });
    expect(oneShort).toEqual({
      nudge: null,
      reason: {
        kind: "correction-size",
        direction: "slower",
        correctionCases: 3,
        correctionCasesNeeded: 4,
      },
    });
  });

  it("keeps the two-correction route when Cases per Skid is missing", () => {
    const first = evaluatePackagingSpeedNudge({
      ...BASE,
      casesPerSkid: 0,
      displayedCases: 100,
      corrections: [{ deltaCases: 2 }],
    });
    const repeated = evaluatePackagingSpeedNudge({
      ...BASE,
      casesPerSkid: 0,
      displayedCases: 100,
      corrections: [{ deltaCases: 2 }, { deltaCases: 2 }],
    });

    expect(first).toEqual({
      nudge: null,
      reason: {
        kind: "missing-skid-size",
        direction: "faster",
        correctionCount: 1,
      },
    });
    expect(repeated.nudge).toEqual({
      direction: "faster",
      isCrust: false,
      value: 1.3,
    });
  });

  it("recommends direct correction-adjusted ppm for crust runs", () => {
    const evaluation = evaluatePackagingSpeedNudge({
      ...BASE,
      isCrust: true,
      displayedCases: 100,
      corrections: [{ deltaCases: 10 }, { deltaCases: 10 }],
    });

    expect(evaluation).toEqual({
      nudge: {
        direction: "faster",
        isCrust: true,
        value: 144,
      },
      reason: null,
    });
  });

  it("records corrections when Array.prototype.at is unavailable, as on older iOS Safari", () => {
    const originalAt = Object.getOwnPropertyDescriptor(Array.prototype, "at");
    let tracking = createPackagingSpeedNudgeTracking("run-a");
    Object.defineProperty(Array.prototype, "at", {
      configurable: true,
      value: undefined,
    });

    try {
      tracking = recordPackagingSpeedCorrection(tracking, -2);
      tracking = recordPackagingSpeedCorrection(tracking, -2);
    } finally {
      if (originalAt) Object.defineProperty(Array.prototype, "at", originalAt);
      else delete (Array.prototype as Array<unknown> & { at?: unknown }).at;
    }

    expect(tracking.corrections).toEqual([{ deltaCases: -2 }, { deltaCases: -2 }]);
    expect(
      evaluatePackagingSpeedNudge({
        ...BASE,
        displayedCases: 100,
        corrections: tracking.corrections,
      }).nudge,
    ).toMatchObject({ direction: "slower" });
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