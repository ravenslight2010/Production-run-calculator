import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  advanceCaseDueAtAfterTick,
  dueCaseIntervals,
} from "./autoTrackEngine";

describe("case due interval arithmetic", () => {
  it("advances to the earliest phase-aligned deadline after any elapsed intervals", () => {
    const inputArbitrary = fc.integer({ min: 1, max: 60_000 }).chain((periodMs) =>
      fc.tuple(
        fc.integer({ min: 1, max: 1_000_000_000_000 }),
        fc.integer({ min: 0, max: 10_000 }),
        fc.integer({ min: 0, max: periodMs - 1 }),
      ).map(([scheduledDueAtMs, elapsedIntervals, remainderMs]) => ({
        scheduledDueAtMs,
        periodMs,
        nowMs: scheduledDueAtMs + elapsedIntervals * periodMs + remainderMs,
        elapsedIntervals,
      })),
    );

    fc.assert(
      fc.property(inputArbitrary, ({
        scheduledDueAtMs,
        periodMs,
        nowMs,
        elapsedIntervals,
      }) => {
        const intervals = dueCaseIntervals(scheduledDueAtMs, nowMs, periodMs);
        const nextDueAtMs = advanceCaseDueAtAfterTick(
          scheduledDueAtMs,
          nowMs,
          periodMs,
        );

        expect(intervals).toBe(elapsedIntervals + 1);
        expect(nextDueAtMs).toBeGreaterThan(nowMs);
        expect((nextDueAtMs - scheduledDueAtMs) % periodMs).toBe(0);
        expect(nextDueAtMs - periodMs).toBeLessThanOrEqual(nowMs);
      }),
      { numRuns: 500 },
    );
  });

  it("does not advance before the scheduled deadline", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1_000_000, max: 1_000_000_000_000 }),
        fc.integer({ min: 1, max: 60_000 }),
        fc.integer({ min: 1, max: 999_999 }),
        (scheduledDueAtMs, periodMs, leadMs) => {
          const nowMs = scheduledDueAtMs - leadMs;
          expect(dueCaseIntervals(scheduledDueAtMs, nowMs, periodMs)).toBe(0);
          expect(
            advanceCaseDueAtAfterTick(scheduledDueAtMs, nowMs, periodMs),
          ).toBe(scheduledDueAtMs);
        },
      ),
      { numRuns: 500 },
    );
  });

  it("uses a one-period fallback only when the scheduled deadline is invalid", () => {
    expect(advanceCaseDueAtAfterTick(Number.NaN, 10_000, 2_000)).toBe(12_000);
    expect(advanceCaseDueAtAfterTick(1_000, 10_000, 0)).toBe(1_000);
    expect(dueCaseIntervals(0, 10_000, 2_000)).toBe(0);
  });
});
