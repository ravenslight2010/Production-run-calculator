import { describe, it, expect } from "vitest";
import {
  buildFreezerPullUpserts,
  type FreezerPullItem,
  type FreezerPullRequest,
} from "./index";

const existing: FreezerPullItem[] = [
  { id: "egg-item", scope: "live", ingredient: "Scrambled Egg", daysEarly: 3, enabled: true },
  { id: "bacon", ingredient: "Bacon", daysEarly: 2, enabled: false },
];

describe("buildFreezerPullUpserts", () => {
  it("creates a new item (id = lowercased ingredient) for an unknown ingredient", () => {
    const out = buildFreezerPullUpserts(existing, [
      { ingredient: "Chicken, Diced", daysEarly: 4 },
    ]);
    expect(out).toEqual([
      { id: "chicken, diced", ingredient: "Chicken, Diced", daysEarly: 4, enabled: true },
    ]);
  });

  it("updates an existing item's daysEarly keeping its id/scope (case-insensitive match)", () => {
    const out = buildFreezerPullUpserts(existing, [
      { ingredient: "scrambled egg", daysEarly: 5 },
    ]);
    expect(out).toEqual([
      { id: "egg-item", scope: "live", ingredient: "Scrambled Egg", daysEarly: 5, enabled: true },
    ]);
  });

  it("re-enables a disabled item even when daysEarly already matches", () => {
    const out = buildFreezerPullUpserts(existing, [{ ingredient: "Bacon", daysEarly: 2 }]);
    expect(out).toEqual([
      { id: "bacon", ingredient: "Bacon", daysEarly: 2, enabled: true },
    ]);
  });

  it("drops no-op requests (already enabled with the same daysEarly)", () => {
    const out = buildFreezerPullUpserts(existing, [
      { ingredient: "Scrambled Egg", daysEarly: 3 },
    ]);
    expect(out).toEqual([]);
  });

  it("drops blank ingredients and non-positive daysEarly", () => {
    const bad: FreezerPullRequest[] = [
      { ingredient: "   ", daysEarly: 3 },
      { ingredient: "Cheese", daysEarly: 0 },
      { ingredient: "Dough", daysEarly: -1 },
      { ingredient: "Sauce", daysEarly: NaN },
    ];
    expect(buildFreezerPullUpserts(existing, bad)).toEqual([]);
  });

  it("collapses duplicate requests onto the largest daysEarly", () => {
    const out = buildFreezerPullUpserts([], [
      { ingredient: "Egg", daysEarly: 2 },
      { ingredient: "egg", daysEarly: 4 },
      { ingredient: "EGG", daysEarly: 3 },
    ]);
    // The winning request's own casing is kept.
    expect(out).toEqual([{ id: "egg", ingredient: "egg", daysEarly: 4, enabled: true }]);
  });

  it("truncates fractional daysEarly", () => {
    const out = buildFreezerPullUpserts([], [{ ingredient: "Egg", daysEarly: 2.9 }]);
    expect(out[0]?.daysEarly).toBe(2);
  });
});
