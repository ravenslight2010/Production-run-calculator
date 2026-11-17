import { describe, it, expect } from "vitest";
import { fmtElapsed } from "./utils";

describe("fmtElapsed", () => {
  it("returns '0m' for zero milliseconds", () => {
    expect(fmtElapsed(0)).toBe("0m");
  });

  it("returns '0m' for negative input (clock skew / future startedAt)", () => {
    expect(fmtElapsed(-1)).toBe("0m");
    expect(fmtElapsed(-60_000)).toBe("0m");
    expect(fmtElapsed(-Number.MAX_SAFE_INTEGER)).toBe("0m");
  });

  it("formats sub-hour durations as minutes", () => {
    expect(fmtElapsed(90_000)).toBe("1m");
    expect(fmtElapsed(30 * 60 * 1000)).toBe("30m");
    expect(fmtElapsed(59 * 60 * 1000 + 59_000)).toBe("59m");
  });

  it("formats hour-plus durations as 'Xh Ym'", () => {
    expect(fmtElapsed(60 * 60 * 1000)).toBe("1h 0m");
    expect(fmtElapsed(90 * 60 * 1000)).toBe("1h 30m");
    expect(fmtElapsed(2 * 60 * 60 * 1000 + 15 * 60 * 1000)).toBe("2h 15m");
  });

  describe("CompactRunStrip paused-branch expression (clock skew)", () => {
    // Mirrors the expression used in CompactRunStrip:
    //   fmtElapsed(nowTime - startedAt + Math.max(0, nowTime - pausedAt))
    // The Math.max(0, ...) clamp is the fix — without it a future pausedAt
    // (clock skew) produces a negative addend that drags the total down and
    // shows "0m" even when real elapsed time is significant.

    it("preserves elapsed when pausedAt is in the future (clock skew)", () => {
      const startedAt = 0;
      const nowTime = 30 * 60 * 1000; // 30 min after start
      const pausedAt = nowTime + 5 * 60 * 1000; // 5 min in the FUTURE (skew)

      // With the clamp: Math.max(0, nowTime - pausedAt) = 0 → elapsed stays 30m
      const clamped = fmtElapsed(
        nowTime - startedAt + Math.max(0, nowTime - pausedAt)
      );
      expect(clamped).toBe("30m");

      // Without the clamp (the old broken path): addend is -5min → total goes to 25min;
      // with extreme skew it would hit 0m and hide real elapsed entirely.
      const unclamped = fmtElapsed(
        nowTime - startedAt + (nowTime - pausedAt)
      );
      expect(unclamped).toBe("25m"); // confirms the addend was subtracting elapsed
    });

    it("shows '0m' when extreme skew makes the unclamped total negative, proving the fmtElapsed floor", () => {
      const startedAt = 0;
      const nowTime = 5 * 60 * 1000; // 5 min after start
      const pausedAt = nowTime + 60 * 60 * 1000; // 1 hour in the FUTURE (severe skew)

      // Old unclamped expression: 5min + (-60min) = -55min → fmtElapsed clamps to "0m"
      expect(
        fmtElapsed(nowTime - startedAt + (nowTime - pausedAt))
      ).toBe("0m");

      // Fixed clamped expression: 5min + max(0, -60min) = 5min → correctly "5m"
      expect(
        fmtElapsed(nowTime - startedAt + Math.max(0, nowTime - pausedAt))
      ).toBe("5m");
    });

    it("normal case: pausedAt in the past contributes positively as expected", () => {
      const startedAt = 0;
      const nowTime = 40 * 60 * 1000; // 40 min after start
      const pausedAt = 10 * 60 * 1000; // 10 min after start (paused 30 min ago)

      // nowTime - pausedAt = 30min (positive) → total = 40 + 30 = 70min
      const result = fmtElapsed(
        nowTime - startedAt + Math.max(0, nowTime - pausedAt)
      );
      expect(result).toBe("1h 10m");
    });

    it("forward clock drift: addend is capped at run age so elapsed cannot exceed 2× run age", () => {
      const startedAt = 0;
      const nowTime = 30 * 60 * 1000; // 30 min after start
      // Device clock drifted forward — pausedAt was recorded when clock was much
      // earlier, so nowTime - pausedAt is far larger than the run's actual age.
      const pausedAt = 1 * 60 * 1000; // 1 min after start, paused 29 min ago
      const runAge = nowTime - startedAt; // 30 min

      // Without upper bound: 30min + 29min = 59min — plausible here but with
      // extreme drift (pausedAt very far in the past) the addend can massively
      // overstate elapsed time.
      //
      // With the upper-bound cap: addend = min(runAge, 29min) = 29min → 59min
      // In the extreme forward-drift case, cap kicks in:
      const extremePausedAt = -60 * 60 * 1000; // 1 hr before startedAt (severe drift)
      const addendUncapped = nowTime - extremePausedAt; // 90 min — larger than the 30-min run
      const addendCapped = Math.min(runAge, Math.max(0, nowTime - extremePausedAt));

      expect(addendUncapped).toBeGreaterThan(runAge);
      expect(addendCapped).toBe(runAge); // capped at run age

      // Total elapsed with cap: 30min + 30min = 60min (2× run age max)
      const result = fmtElapsed(runAge + addendCapped);
      expect(result).toBe("1h 0m");

      // Without cap the total would be 30min + 90min = 120min — unrealistically
      // large for a run that only started 30 min ago.
      const uncapped = fmtElapsed(runAge + addendUncapped);
      expect(uncapped).toBe("2h 0m");
    });
  });
});
