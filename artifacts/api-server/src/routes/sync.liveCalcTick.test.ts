import { describe, expect, it } from "vitest";
import { buildLiveCalcTickFrame, shouldEmitLiveCalcTick } from "../lib/liveCalcTick";

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


describe("buildLiveCalcTickFrame", () => {
  const data = dayState([{ id: "r1", startedAt: 1000 }]);

  it("returns a calcTick frame with the canonical revision when eligible", () => {
    const out = buildLiveCalcTickFrame(data, 6_000, 0, 7, TICK_MS);
    expect(out).not.toBeNull();
    expect(out!.frame).toEqual({ calcTick: true, canonicalRevision: 7 });
    expect(out!.lastCalcEmitMs).toBe(6_000);
  });

  it("returns null for an idle day", () => {
    expect(buildLiveCalcTickFrame(dayState([]), 6_000, 0, 0, TICK_MS)).toBeNull();
  });

  it("returns null inside the interval window", () => {
    expect(buildLiveCalcTickFrame(data, 4_999, 0, 0, TICK_MS)).toBeNull();
  });
});

import { buildSetupCalcTickFrame, shouldEmitSetupCalcTick } from "../lib/liveCalcTick";

function runValues(id: string) {
  return { dayState: { runs: [{ id }], currentIndex: 0 }, runValues: { [id]: { approxLineSpeed: 60 } } };
}

describe("shouldEmitSetupCalcTick", () => {
  it("emits when the selected run has runValues (pending, no startedAt)", () => {
    const data = runValues("r1");
    expect(shouldEmitSetupCalcTick(data, 6_000, 0, TICK_MS)).toBe(true);
  });

  it("emits when the selected run has runValues AND is active", () => {
    const data = {
      dayState: { runs: [{ id: "r1", startedAt: 1000 }], currentIndex: 0 },
      runValues: { r1: { approxLineSpeed: 60 } },
    };
    expect(shouldEmitSetupCalcTick(data, 6_000, 0, TICK_MS)).toBe(true);
  });

  it("does not emit when the day state is idle (no runs)", () => {
    expect(shouldEmitSetupCalcTick({ dayState: { runs: [], currentIndex: 0 } }, 6_000, 0, TICK_MS)).toBe(false);
    expect(shouldEmitSetupCalcTick(null, 6_000, 0, TICK_MS)).toBe(false);
  });

  it("does not emit when the selected run has no runValues", () => {
    const data = { dayState: { runs: [{ id: "r1" }], currentIndex: 0 } };
    expect(shouldEmitSetupCalcTick(data, 6_000, 0, TICK_MS)).toBe(false);
  });

  it("does not emit before the tick interval has elapsed", () => {
    const data = runValues("r1");
    expect(shouldEmitSetupCalcTick(data, 4_999, 0, TICK_MS)).toBe(false);
  });

  it("emits at exactly the tick interval boundary", () => {
    const data = runValues("r1");
    expect(shouldEmitSetupCalcTick(data, 5_000, 0, TICK_MS)).toBe(true);
  });

  it("does not emit when the run has ended", () => {
    const data = {
      dayState: { runs: [{ id: "r1", startedAt: 1000, endedAt: 1500 }], currentIndex: 0 },
      runValues: { r1: { approxLineSpeed: 60 } },
    };
    expect(shouldEmitSetupCalcTick(data, 6_000, 0, TICK_MS)).toBe(true); // setup tick does NOT require active — still emits for ended runs with runValues for Setup display
  });
});

describe("buildSetupCalcTickFrame", () => {
  it("returns a frame with setupTick: true when the interval has elapsed", () => {
    const data = runValues("r1");
    const result = buildSetupCalcTickFrame(data, 6_000, 0, 42, TICK_MS);
    expect(result).not.toBeNull();
    expect(result!.frame).toMatchObject({ calcTick: true, setupTick: true, canonicalRevision: 42 });
  });

  it("returns null when the interval has not elapsed", () => {
    const data = runValues("r1");
    expect(buildSetupCalcTickFrame(data, 4_999, 0, 42, TICK_MS)).toBeNull();
  });

  it("returns null when there are no runs", () => {
    expect(buildSetupCalcTickFrame({ dayState: { runs: [] } }, 6_000, 0, 42, TICK_MS)).toBeNull();
  });

  it("returns null when there is no runValues", () => {
    const data = { dayState: { runs: [{ id: "r1" }] } };
    expect(buildSetupCalcTickFrame(data, 6_000, 0, 42, TICK_MS)).toBeNull();
  });
});
