import { describe, expect, it } from "vitest";
import { shouldEmitLiveCalcTick } from "../lib/liveCalcTick";

const TICK_MS = 5_000;

function dayState(runs: Array<{ id: string; startedAt?: number; endedAt?: number; pausedAt?: number }>) {
  return { dayState: { runs, currentIndex: 0 } };
}

describe("shouldEmitLiveCalcTick", () => {
  it("emits when the current run is active (started, not ended)", () => {
    const data = dayState([{ id: "r1", startedAt: 1000 }]);
    expect(shouldEmitLiveCalcTick(data, 6_000, 0, TICK_MS)).toBe(true);
  });

  it("does not emit when the day state is idle (no runs)", () => {
    expect(shouldEmitLiveCalcTick(dayState([]), 2_000, 0, TICK_MS)).toBe(false);
    expect(shouldEmitLiveCalcTick(null, 2_000, 0, TICK_MS)).toBe(false);
  });

  it("does not emit when the current run has ended", () => {
    const data = dayState([{ id: "r1", startedAt: 1000, endedAt: 1500 }]);
    expect(shouldEmitLiveCalcTick(data, 2_000, 0, TICK_MS)).toBe(false);
  });

  it("does not emit before the tick interval has elapsed", () => {
    const data = dayState([{ id: "r1", startedAt: 1000 }]);
    expect(shouldEmitLiveCalcTick(data, 4_999, 0, TICK_MS)).toBe(false);
  });

  it("emits at exactly the tick interval boundary", () => {
    const data = dayState([{ id: "r1", startedAt: 1000 }]);
    expect(shouldEmitLiveCalcTick(data, 5_000, 0, TICK_MS)).toBe(true);
  });

  it("tracks a run that is paused but not ended as active", () => {
    const data = dayState([{ id: "r1", startedAt: 1000, pausedAt: 1100 }]);
    expect(shouldEmitLiveCalcTick(data, 6_000, 0, TICK_MS)).toBe(true);
  });
});
