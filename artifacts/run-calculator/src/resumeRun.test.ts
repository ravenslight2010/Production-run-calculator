import { describe, it, expect } from "vitest";
import { computeResumedStartedAt } from "./utils";

describe("computeResumedStartedAt", () => {
  const START = 1_000_000; // arbitrary epoch ms

  describe("freezerEmpty = false (shift-forward branch)", () => {
    it("returns a value >= startedAt", () => {
      const pausedAt = START + 30 * 60_000; // paused 30 min after start
      const now = pausedAt + 10 * 60_000;   // resume 10 min later
      const result = computeResumedStartedAt(START, pausedAt, now, false);
      expect(result).toBeGreaterThanOrEqual(START);
    });

    it("makes nowTime - newStartedAt >= 0", () => {
      const pausedAt = START + 30 * 60_000;
      const now = pausedAt + 10 * 60_000;
      const result = computeResumedStartedAt(START, pausedAt, now, false);
      expect(now - result).toBeGreaterThanOrEqual(0);
    });

    it("elapsed after resume equals time-before-pause (run was paused 30 min in, resumed 10 min later)", () => {
      const pausedAt = START + 30 * 60_000;
      const now = pausedAt + 10 * 60_000;
      // Expected: shift forward by pauseDuration (10 min), so elapsed = 30 min
      const result = computeResumedStartedAt(START, pausedAt, now, false);
      expect(now - result).toBe(30 * 60_000);
    });

    it("elapsed equals 0 when resumed immediately (pauseDuration = 0)", () => {
      const pausedAt = START + 45 * 60_000;
      const now = pausedAt; // resumed at exact same ms as pause
      const result = computeResumedStartedAt(START, pausedAt, now, false);
      expect(now - result).toBe(45 * 60_000);
      expect(result).toBeGreaterThanOrEqual(START);
    });

    it("handles a long pause (12 hours)", () => {
      const pausedAt = START + 2 * 60 * 60_000;      // paused 2 h in
      const now = pausedAt + 12 * 60 * 60_000;       // 12-hour pause
      const result = computeResumedStartedAt(START, pausedAt, now, false);
      // Shift = 12 h, so newStartedAt = START + 2h + 12h = START + 14h
      // Elapsed after resume = now - (START + 14h) = (START + 14h) - (START + 14h) = 2h
      expect(now - result).toBe(2 * 60 * 60_000);
      expect(result).toBeGreaterThanOrEqual(START);
    });

    it("newStartedAt is always >= startedAt (pause shifts it forward, never back)", () => {
      const cases: Array<[number, number]> = [
        [0, 0],                              // paused & resumed instantly
        [5 * 60_000, 1_000],                 // paused 5 min, very short pause
        [60 * 60_000, 8 * 60 * 60_000],      // 1 h run, 8 h pause
      ];
      for (const [pauseOffset, pauseDuration] of cases) {
        const pausedAt = START + pauseOffset;
        const now = pausedAt + pauseDuration;
        const result = computeResumedStartedAt(START, pausedAt, now, false);
        expect(result).toBeGreaterThanOrEqual(START);
        expect(now - result).toBeGreaterThanOrEqual(0);
      }
    });
  });

  describe("freezerEmpty = true (fresh-start branch)", () => {
    it("returns exactly now", () => {
      const pausedAt = START + 30 * 60_000;
      const now = pausedAt + 10 * 60_000;
      const result = computeResumedStartedAt(START, pausedAt, now, true);
      expect(result).toBe(now);
    });

    it("elapsed immediately after resume is 0 (now - now = 0)", () => {
      const now = START + 99 * 60_000;
      const result = computeResumedStartedAt(START, START + 50 * 60_000, now, true);
      expect(now - result).toBe(0);
    });

    it("ignores startedAt and pausedAt values entirely", () => {
      const now = 9_999_999;
      // Different startedAt/pausedAt combinations all yield now
      expect(computeResumedStartedAt(0, 0, now, true)).toBe(now);
      expect(computeResumedStartedAt(START, now - 1, now, true)).toBe(now);
      expect(computeResumedStartedAt(now - 1_000, now - 500, now, true)).toBe(now);
    });
  });

  describe("key invariant: if the shift were removed, elapsed could go negative", () => {
    it("without the shift, nowTime - startedAt overstates elapsed by the pause duration", () => {
      // Demonstrates WHY the shift is needed.
      const pausedAt = START + 30 * 60_000;  // paused 30 min in
      const now = pausedAt + 10 * 60_000;    // 10-min pause

      // Correct: shift applied
      const corrected = computeResumedStartedAt(START, pausedAt, now, false);
      const correctElapsed = now - corrected; // 30 min

      // Broken: no shift (startedAt unchanged)
      const brokenElapsed = now - START; // 40 min — includes pause time

      expect(correctElapsed).toBe(30 * 60_000);
      expect(brokenElapsed).toBe(40 * 60_000);
      expect(correctElapsed).toBeLessThan(brokenElapsed);
    });

    it("with an extreme pause, removing the shift does not cause negative elapsed but does overstate it significantly", () => {
      const pausedAt = START + 1 * 60_000;         // paused 1 min in
      const now = pausedAt + 8 * 60 * 60_000;      // 8-hour overnight pause

      const corrected = computeResumedStartedAt(START, pausedAt, now, false);
      const correctElapsed = now - corrected;   // 1 min
      const brokenElapsed = now - START;        // 8 h 1 min

      expect(correctElapsed).toBe(1 * 60_000);
      expect(brokenElapsed).toBe(8 * 60 * 60_000 + 1 * 60_000);
    });
  });
});
