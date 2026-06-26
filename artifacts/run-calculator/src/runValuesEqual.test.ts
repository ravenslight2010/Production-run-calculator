// @vitest-environment node
//
// Guard for the web autosave edit-attribution fix. The autosave effect must only
// stamp a per-run edit (markRunValuesUpdated) and push when the live form values
// actually DIFFER from what is already stored for that run. A programmatic
// form.reset() — run switch, sync-apply, daily rollover, post-login load —
// re-emits the SAME stored values through form.watch(); re-stamping those as a
// fresh edit defeats the per-run lost-update guard and lets a loaded/stale/empty
// value win the cross-device merge and clobber a peer's real edit. deepEqual is
// the discriminator. This mirrors mobile's primed-baseline diffStampRunEdits.

import { describe, it, expect } from "vitest";
import { deepEqual } from "./storage";
import { DEFAULT_VALUES } from "./types";

describe("deepEqual — autosave edit attribution", () => {
  it("treats a re-emit of identical values as NOT an edit (key order irrelevant)", () => {
    const stored = { casesNeeded: 384, brand: "Costco", flavor: "Three Meat", doughRecipe: [] };
    const reemitted = { flavor: "Three Meat", doughRecipe: [], casesNeeded: 384, brand: "Costco" };
    expect(deepEqual(stored, reemitted)).toBe(true);
  });

  it("detects a changed scalar (a genuine cases-needed edit)", () => {
    const stored = { casesNeeded: 384, brand: "Costco" };
    const edited = { casesNeeded: 500, brand: "Costco" };
    expect(deepEqual(stored, edited)).toBe(false);
  });

  it("does NOT mistake a populated run for an empty/default re-load (would clobber)", () => {
    const populated = { casesNeeded: 500, brand: "Costco", flavor: "Three Meat" };
    const blank = { casesNeeded: 0, brand: "", flavor: "" };
    expect(deepEqual(populated, blank)).toBe(false);
  });

  it("compares recipe-row arrays by index (order is meaningful)", () => {
    const a = { doughRecipe: [{ type: "Flour", lbs: 50 }, { type: "Water", lbs: 30 }] };
    const same = { doughRecipe: [{ type: "Flour", lbs: 50 }, { type: "Water", lbs: 30 }] };
    const reordered = { doughRecipe: [{ type: "Water", lbs: 30 }, { type: "Flour", lbs: 50 }] };
    const changed = { doughRecipe: [{ type: "Flour", lbs: 55 }, { type: "Water", lbs: 30 }] };
    expect(deepEqual(a, same)).toBe(true);
    expect(deepEqual(a, reordered)).toBe(false);
    expect(deepEqual(a, changed)).toBe(false);
  });

  it("detects added/removed recipe rows", () => {
    const a = { doughRecipe: [{ type: "Flour", lbs: 50 }] };
    const added = { doughRecipe: [{ type: "Flour", lbs: 50 }, { type: "Salt", lbs: 1 }] };
    expect(deepEqual(a, added)).toBe(false);
  });

  it("distinguishes null from missing/empty", () => {
    expect(deepEqual({ a: null }, { a: undefined })).toBe(false);
    expect(deepEqual({ a: 0 }, { a: null })).toBe(false);
    expect(deepEqual(null, null)).toBe(true);
  });
});

// The autosave effect adds a second, semantic guard on top of deepEqual: it must
// NEVER save+stamp an all-default form over a populated stored value. A genuine
// user edit never reduces every field to its default at once — an all-default
// form is always a programmatic reset (mount/init race, daily rollover, or a
// sync-apply echo) re-emitting through form.watch() while localStorage still
// holds the real values. Stamping it mints a fresh markRunValuesUpdated() time
// that wins the per-run lost-update guard on every connected tab and clobbers
// the real run data on the shared day-state row. This block locks in that guard
// predicate exactly as written in home.tsx.
describe("autosave guard — empty form must not clobber populated stored value", () => {
  // The exact predicate from the effect: skip when the live form equals DEFAULT
  // but the stored value does not.
  const blocksClobber = (v: unknown, stored: unknown) =>
    deepEqual(v, DEFAULT_VALUES) && !deepEqual(stored, DEFAULT_VALUES);

  it("BLOCKS a default form from overwriting a populated stored value", () => {
    const stored = { ...DEFAULT_VALUES, casesNeeded: 500, crustsPerCycle: 12 };
    expect(blocksClobber({ ...DEFAULT_VALUES }, stored)).toBe(true);
  });

  it("BLOCKS even when only a single real field is populated (e.g. cases-needed)", () => {
    const stored = { ...DEFAULT_VALUES, casesNeeded: 384 };
    expect(blocksClobber({ ...DEFAULT_VALUES }, stored)).toBe(true);
  });

  it("does NOT block a genuine edit (form differs from default)", () => {
    const stored = { ...DEFAULT_VALUES, casesNeeded: 500 };
    const edited = { ...DEFAULT_VALUES, casesNeeded: 600 };
    expect(blocksClobber(edited, stored)).toBe(false);
  });

  it("does NOT block when the stored value is itself default (a legitimately blank run)", () => {
    expect(blocksClobber({ ...DEFAULT_VALUES }, { ...DEFAULT_VALUES })).toBe(false);
  });

  it("does NOT block typing the first value into a blank run", () => {
    const stored = { ...DEFAULT_VALUES };
    const typing = { ...DEFAULT_VALUES, casesNeeded: 1 };
    expect(blocksClobber(typing, stored)).toBe(false);
  });
});
