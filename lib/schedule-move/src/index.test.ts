import { describe, it, expect } from "vitest";
import { moveEntries, relocateValues } from "./index";

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
