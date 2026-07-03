import { describe, expect, it } from "vitest";
import {
  aggregateDowntime,
  detectStall,
  detectStallFromDelta,
  stoppageDurationMs,
  MAX_SINGLE_STOPPAGE_MS,
  STALL_DEFAULT_THRESHOLD_MIN,
  type DayIn,
} from "./index";

const NOW = Date.parse("2026-07-02T18:00:00Z");
const MIN = 60_000;

function day(date: string, runs: DayIn["runs"]): DayIn {
  return { date, runs };
}

describe("stoppageDurationMs", () => {
  it("uses endedAt when present", () => {
    expect(stoppageDurationMs({ startedAt: NOW - 5 * MIN, endedAt: NOW - 2 * MIN }, NOW)).toBe(3 * MIN);
  });

  it("caps an open stoppage at now", () => {
    expect(stoppageDurationMs({ startedAt: NOW - 7 * MIN }, NOW)).toBe(7 * MIN);
  });

  it("clamps a forgot-to-end monster stoppage", () => {
    expect(
      stoppageDurationMs({ startedAt: NOW - 30 * 60 * MIN, endedAt: NOW }, NOW),
    ).toBe(MAX_SINGLE_STOPPAGE_MS);
  });

  it("rejects zero/negative/garbage", () => {
    expect(stoppageDurationMs({ startedAt: 0 }, NOW)).toBe(0);
    expect(stoppageDurationMs({ startedAt: NOW + MIN, endedAt: NOW }, NOW)).toBe(0);
    expect(stoppageDurationMs({ startedAt: NaN }, NOW)).toBe(0);
  });
});

describe("aggregateDowntime", () => {
  it("returns empty shape for no days", () => {
    const out = aggregateDowntime([], { nowMs: NOW });
    expect(out.totalMinutes).toBe(0);
    expect(out.totalCount).toBe(0);
    expect(out.days).toEqual([]);
    expect(out.byType).toEqual([]);
  });

  it("aggregates across days, keeps zero-downtime days, sorts oldest first", () => {
    const days: DayIn[] = [
      day("2026-07-02", [
        {
          brand: "Basha",
          flavor: "Cheese",
          stoppages: [
            { reason: "Jam at wrapper", type: "stop", startedAt: NOW - 60 * MIN, endedAt: NOW - 45 * MIN },
            { reason: "Break", type: "pause", startedAt: NOW - 30 * MIN, endedAt: NOW - 20 * MIN },
          ],
        },
      ]),
      day("2026-06-30", [{ brand: "Vita", flavor: "Pep", stoppages: [] }]),
      day("2026-07-01", [
        {
          brand: "Basha",
          flavor: "Cheese",
          stoppages: [{ reason: "jam at wrapper", type: "stop", startedAt: NOW - 26 * 60 * MIN, endedAt: NOW - 26 * 60 * MIN + 5 * MIN }],
        },
      ]),
    ];
    const out = aggregateDowntime(days, { nowMs: NOW });
    expect(out.days.map((d) => d.date)).toEqual(["2026-06-30", "2026-07-01", "2026-07-02"]);
    expect(out.days[0]).toEqual({ date: "2026-06-30", minutes: 0, count: 0 });
    expect(out.totalMinutes).toBe(30);
    expect(out.totalCount).toBe(3);
    expect(out.daysWithDowntime).toBe(2);
    // byType: stop = 20min, pause = 10min
    expect(out.byType[0]).toEqual({ key: "stop", minutes: 20, count: 2 });
    expect(out.byType[1]).toEqual({ key: "pause", minutes: 10, count: 1 });
    // byRun rolls both days of the same product together
    expect(out.byRun[0]).toEqual({ key: "Basha Cheese", minutes: 30, count: 3 });
    // reasons are case/whitespace-normalized... reason text differs by case only
    expect(out.topReasons.find((r) => r.key.toLowerCase() === "jam at wrapper")?.count).toBe(2);
    expect(out.longest[0].minutes).toBe(15);
  });

  it("skips mergedAway runs and duplicate/invalid dates", () => {
    const days: DayIn[] = [
      day("2026-07-02", [
        { brand: "Ghost", mergedAway: true, stoppages: [{ startedAt: NOW - 10 * MIN, endedAt: NOW }] },
      ]),
      day("2026-07-02", [
        { brand: "Dup", stoppages: [{ startedAt: NOW - 10 * MIN, endedAt: NOW }] },
      ]),
      day("bad-date", [
        { brand: "Bad", stoppages: [{ startedAt: NOW - 10 * MIN, endedAt: NOW }] },
      ]),
    ];
    const out = aggregateDowntime(days, { nowMs: NOW });
    expect(out.totalCount).toBe(0);
    expect(out.days).toHaveLength(1);
  });

  it("buckets hour-of-day in the caller's local clock via tzOffsetMin", () => {
    // 18:00 UTC start; tzOffsetMin 240 (UTC-4) → 14 local
    const days: DayIn[] = [
      day("2026-07-02", [{ brand: "B", stoppages: [{ startedAt: NOW, endedAt: NOW + 5 * MIN }] }]),
    ];
    const out = aggregateDowntime(days, { nowMs: NOW + 10 * MIN, tzOffsetMin: 240 });
    expect(out.byHour).toEqual([{ key: "14", minutes: 5, count: 1 }]);
  });

  it("labels blank reasons and runs", () => {
    const days: DayIn[] = [
      day("2026-07-02", [{ stoppages: [{ startedAt: NOW - 5 * MIN, endedAt: NOW }] }]),
    ];
    const out = aggregateDowntime(days, { nowMs: NOW });
    expect(out.byRun[0].key).toBe("(no brand)");
    expect(out.topReasons[0].key).toBe("(no reason given)");
    expect(out.byType[0].key).toBe("other");
  });
});

describe("detectStall", () => {
  const base = {
    running: true,
    hasOpenStoppage: false,
    ppm: 20, // 20 pizzas/min
    pizzasPerCase: 10, // → 2 cases/min expected
    elapsedMinAfterTunnel: 30, // expected 60 cases
    casesCompleted: 60,
  };

  it("not stalled when on pace", () => {
    expect(detectStall(base)).toEqual({ stalled: false, behindMinutes: 0 });
  });

  it("stalls when behind by at least the threshold", () => {
    // 60 expected, 40 done → 20 cases behind = 10 minutes at 2 cases/min
    const out = detectStall({ ...base, casesCompleted: 40 });
    expect(out.stalled).toBe(true);
    expect(out.behindMinutes).toBe(STALL_DEFAULT_THRESHOLD_MIN);
  });

  it("reports behindMinutes below threshold without stalling", () => {
    // 10 cases behind = 5 minutes
    const out = detectStall({ ...base, casesCompleted: 50 });
    expect(out).toEqual({ stalled: false, behindMinutes: 5 });
  });

  it("never stalls when not running, already stopped, or rate unknown", () => {
    expect(detectStall({ ...base, casesCompleted: 0, running: false }).stalled).toBe(false);
    expect(detectStall({ ...base, casesCompleted: 0, hasOpenStoppage: true }).stalled).toBe(false);
    expect(detectStall({ ...base, casesCompleted: 0, ppm: 0 }).stalled).toBe(false);
    expect(detectStall({ ...base, casesCompleted: 0, pizzasPerCase: 0 }).stalled).toBe(false);
    expect(detectStall({ ...base, casesCompleted: 0, elapsedMinAfterTunnel: 0 }).stalled).toBe(false);
  });

  it("respects a custom threshold", () => {
    const out = detectStall({ ...base, casesCompleted: 50, thresholdMin: 5 });
    expect(out.stalled).toBe(true);
  });

  it("ahead of pace is never a stall", () => {
    expect(detectStall({ ...base, casesCompleted: 80 })).toEqual({ stalled: false, behindMinutes: 0 });
  });
});

describe("detectStallFromDelta", () => {
  const base = { running: true, hasOpenStoppage: false, ppm: 20, pizzasPerCase: 10 };

  it("matches detectStall for the same situation", () => {
    // detectStall: expected 60, done 40 → paceDelta = -20
    const full = detectStall({
      ...base,
      elapsedMinAfterTunnel: 30,
      casesCompleted: 40,
    });
    const fromDelta = detectStallFromDelta({ ...base, paceDelta: -20 });
    expect(fromDelta).toEqual(full);
    expect(fromDelta.stalled).toBe(true);
    expect(fromDelta.behindMinutes).toBe(STALL_DEFAULT_THRESHOLD_MIN);
  });

  it("boundary: exactly at threshold stalls, one case less does not", () => {
    // -20 cases = 10 min (threshold); -19 cases = 9.5 min → rounds to 10 but stalled=false
    expect(detectStallFromDelta({ ...base, paceDelta: -20 }).stalled).toBe(true);
    expect(detectStallFromDelta({ ...base, paceDelta: -19 }).stalled).toBe(false);
  });

  it("zero/positive delta, paused-equivalent gates, and bad inputs never stall", () => {
    expect(detectStallFromDelta({ ...base, paceDelta: 0 })).toEqual({ stalled: false, behindMinutes: 0 });
    expect(detectStallFromDelta({ ...base, paceDelta: 5 })).toEqual({ stalled: false, behindMinutes: 0 });
    expect(detectStallFromDelta({ ...base, paceDelta: -40, running: false }).stalled).toBe(false);
    expect(detectStallFromDelta({ ...base, paceDelta: -40, hasOpenStoppage: true }).stalled).toBe(false);
    expect(detectStallFromDelta({ ...base, paceDelta: -40, ppm: 0 }).stalled).toBe(false);
    expect(detectStallFromDelta({ ...base, paceDelta: -40, pizzasPerCase: 0 }).stalled).toBe(false);
    expect(detectStallFromDelta({ ...base, paceDelta: NaN }).stalled).toBe(false);
  });

  it("respects a custom threshold", () => {
    // -10 cases = 5 min behind
    expect(detectStallFromDelta({ ...base, paceDelta: -10 }).stalled).toBe(false);
    expect(detectStallFromDelta({ ...base, paceDelta: -10, thresholdMin: 5 }).stalled).toBe(true);
  });
});
