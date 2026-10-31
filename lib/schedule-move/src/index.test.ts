import { describe, it, expect } from "vitest";
import {
  isTodayScheduleSwapAllowed,
  moveEntries,
  relocateValues,
  swapDateScopedScheduleState,
} from "./index";

interface Run {
  id: string;
  brand: string;
  imported?: boolean;
}

const seq = (start = 0) => {
  let n = start;
  return () => `gen${n++}`;
};

describe("moveEntries", () => {
  it("moves a whole day onto an empty target, preserving order and fields", () => {
    const source: Run[] = [
      { id: "a", brand: "X", imported: true },
      { id: "b", brand: "Y" },
    ];
    const res = moveEntries(source, [], "all", seq());
    expect(res.source).toEqual([]);
    expect(res.target).toEqual(source);
    expect(res.idMap).toEqual([
      { from: "a", to: "a" },
      { from: "b", to: "b" },
    ]);
    // fields (incl. imported) preserved verbatim
    expect(res.target[0]).toEqual({ id: "a", brand: "X", imported: true });
  });

  it("moves a single run, leaving the rest on the source", () => {
    const source: Run[] = [
      { id: "a", brand: "X" },
      { id: "b", brand: "Y" },
      { id: "c", brand: "Z" },
    ];
    const res = moveEntries(source, [{ id: "t1", brand: "T" }], ["b"], seq());
    expect(res.source.map((r) => r.id)).toEqual(["a", "c"]);
    expect(res.target.map((r) => r.id)).toEqual(["t1", "b"]);
    expect(res.idMap).toEqual([{ from: "b", to: "b" }]);
  });

  it("appends to an existing target without collapsing duplicates", () => {
    const source: Run[] = [{ id: "a", brand: "Dup" }];
    const target: Run[] = [{ id: "t", brand: "Dup" }];
    const res = moveEntries(source, target, "all", seq());
    // same brand kept as two distinct entries (no merge-by-brand)
    expect(res.target).toEqual([
      { id: "t", brand: "Dup" },
      { id: "a", brand: "Dup" },
    ]);
  });

  it("regenerates colliding ids and reports them via idMap", () => {
    const source: Run[] = [
      { id: "x", brand: "A" },
      { id: "y", brand: "B" },
    ];
    const target: Run[] = [{ id: "x", brand: "existing" }];
    const res = moveEntries(source, target, "all", seq());
    expect(res.target.map((r) => r.id)).toEqual(["x", "gen0", "y"]);
    expect(res.idMap).toEqual([
      { from: "x", to: "gen0" },
      { from: "y", to: "y" },
    ]);
  });

  it("never assigns the same regenerated id to two moved entries", () => {
    const source: Run[] = [
      { id: "x", brand: "A" },
      { id: "x", brand: "B" },
    ];
    const target: Run[] = [{ id: "x", brand: "existing" }];
    const res = moveEntries(source, target, "all", seq());
    const ids = res.target.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("skips already-used generated ids", () => {
    const source: Run[] = [{ id: "x", brand: "A" }];
    const target: Run[] = [
      { id: "x", brand: "existing" },
      { id: "gen0", brand: "alsoThere" },
    ];
    // generator first yields gen0 (taken), must advance to gen1
    const res = moveEntries(source, target, "all", seq());
    expect(res.target.map((r) => r.id)).toEqual(["x", "gen0", "gen1"]);
    expect(res.idMap).toEqual([{ from: "x", to: "gen1" }]);
  });
});

describe("relocateValues", () => {
  it("moves keys from source to target following the idMap", () => {
    const src = { a: 1, b: 2, c: 3 };
    const tgt = { z: 9 };
    const res = relocateValues(src, tgt, [
      { from: "a", to: "a" },
      { from: "b", to: "b" },
    ]);
    expect(res.source).toEqual({ c: 3 });
    expect(res.target).toEqual({ z: 9, a: 1, b: 2 });
  });

  it("writes regenerated ids into the target", () => {
    const src = { x: 10 };
    const tgt = { x: 99 };
    const res = relocateValues(src, tgt, [{ from: "x", to: "gen0" }]);
    expect(res.source).toEqual({});
    expect(res.target).toEqual({ x: 99, gen0: 10 });
  });

  it("skips ids missing from the source map", () => {
    const src: Record<string, number> = { a: 1 };
    const tgt: Record<string, number> = {};
    const res = relocateValues(src, tgt, [
      { from: "a", to: "a" },
      { from: "b", to: "b" },
    ]);
    expect(res.source).toEqual({});
    expect(res.target).toEqual({ a: 1 });
  });

  it("relocates per-run edit stamps without changing the target's existing stamps", () => {
    const src = { moved: 1200, untouched: 900 };
    const tgt = { live: 2400 };
    const res = relocateValues(src, tgt, [{ from: "moved", to: "moved-copy" }]);

    expect(res.source).toEqual({ untouched: 900 });
    expect(res.target).toEqual({ live: 2400, "moved-copy": 1200 });
  });
});

describe("swapDateScopedScheduleState", () => {
  it("swaps date-owned state while retaining factory-wide data on each date", () => {
    const left = {
      dayState: { date: "2026-10-30", runs: [{ id: "left-run" }], breaks: { a: 10 } },
      runValues: { "left-run": { casesNeeded: 11 } },
      runValuesUpdatedAt: { "left-run": 101 },
      packagingProgress: { "left-run": { casesOnCurrentSkid: 3 } },
      autoTrackCoordination: { runs: { "left-run": { sequence: 1 } } },
      doughTimerControls: { "left-run": { generation: "left" } },
      brands: ["Left factory list"],
      templates: [{ id: "left-template" }],
    };
    const right = {
      dayState: { date: "2026-10-31", runs: [{ id: "right-run" }], breaks: { a: 20 } },
      runValues: { "right-run": { casesNeeded: 22 } },
      runValuesUpdatedAt: { "right-run": 202 },
      packagingProgress: { "right-run": { casesOnCurrentSkid: 4 } },
      autoTrackServerState: { netOwnership: { "right-run": { case: { sequence: 2 } } } },
      brands: ["Right factory list"],
      templates: [{ id: "right-template" }],
    };

    const result = swapDateScopedScheduleState(left, right, "2026-10-30", "2026-10-31");

    expect(result.left.dayState).toEqual({
      date: "2026-10-30",
      runs: [{ id: "right-run" }],
      breaks: { a: 20 },
    });
    expect(result.left.runValues).toEqual(right.runValues);
    expect(result.left.runValuesUpdatedAt).toEqual(right.runValuesUpdatedAt);
    expect(result.left.packagingProgress).toEqual(right.packagingProgress);
    expect(result.left.autoTrackServerState).toEqual(right.autoTrackServerState);
    expect(result.left.doughTimerControls).toBeUndefined();
    expect(result.right.dayState.date).toBe("2026-10-31");
    expect(result.right.runValues).toEqual(left.runValues);
    expect(result.right.autoTrackCoordination).toEqual(left.autoTrackCoordination);
    expect(result.left.brands).toEqual(["Left factory list"]);
    expect(result.right.brands).toEqual(["Right factory list"]);
    expect(result.left.templates).toEqual([{ id: "left-template" }]);
    expect(result.right.templates).toEqual([{ id: "right-template" }]);
  });
});

describe("isTodayScheduleSwapAllowed", () => {
  const runs = [{ id: "run", startedAt: "06:30" }];

  it("allows started runs before 7:00 a.m. and rejects them at 7:00", () => {
    expect(isTodayScheduleSwapAllowed(runs, Date.parse("2026-10-29T06:59:00Z"), "UTC")).toBe(true);
    expect(isTodayScheduleSwapAllowed(runs, Date.parse("2026-10-29T07:00:00Z"), "UTC")).toBe(false);
  });

  it("allows any time when today's plan has no started run", () => {
    expect(isTodayScheduleSwapAllowed([{ id: "run" }], Date.parse("2026-10-29T12:00:00Z"), "UTC")).toBe(true);
  });

  it("fails closed when the configured time zone is invalid and a run has started", () => {
    expect(isTodayScheduleSwapAllowed(runs, Date.now(), "Not/AZone")).toBe(false);
  });
});
