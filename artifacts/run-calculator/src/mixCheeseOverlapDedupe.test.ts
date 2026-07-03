import { describe, it, expect, beforeEach } from "vitest";
import { applyMixCheeseOverlapDedupeIfNeeded } from "./storage";
import { CHEESE_RECIPE_NAMES_KEY, MIX_RECIPE_NAMES_KEY } from "./types";

const MARKER = "run-calc-dedupe-mix-cheese-overlap-v1";
const DELETED_KEY = "run-calc-deleted-items";

function seed(key: string, names: string[]) {
  localStorage.setItem(key, JSON.stringify(names));
}
function read(key: string): string[] {
  return JSON.parse(localStorage.getItem(key) ?? "[]");
}

describe("applyMixCheeseOverlapDedupeIfNeeded", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("removes names from Cheese that also live in the Mix list (case-insensitive), keeping Mix", () => {
    seed(CHEESE_RECIPE_NAMES_KEY, [
      "White Fajita Mix",
      "Garlic Chicken Mix",
      "Aldo's Cheese Mix",
      "Mozzarella Cheese Mix",
    ]);
    seed(MIX_RECIPE_NAMES_KEY, ["white fajita mix", "Garlic Chicken Mix", "House Veggie Mix"]);

    applyMixCheeseOverlapDedupeIfNeeded();

    const cheese = read(CHEESE_RECIPE_NAMES_KEY);
    expect(cheese).toEqual(["Aldo's Cheese Mix", "Mozzarella Cheese Mix"]);
    expect(read(MIX_RECIPE_NAMES_KEY)).toEqual([
      "white fajita mix",
      "Garlic Chicken Mix",
      "House Veggie Mix",
    ]);
  });

  it("tombstones the removed Cheese entries and clears any Mix tombstone so the kept name sticks", () => {
    seed(CHEESE_RECIPE_NAMES_KEY, ["White Fajita Mix"]);
    seed(MIX_RECIPE_NAMES_KEY, ["White Fajita Mix"]);
    localStorage.setItem(
      DELETED_KEY,
      JSON.stringify({ mixRecipeNames: ["white fajita mix"] }),
    );

    applyMixCheeseOverlapDedupeIfNeeded();

    const deleted = JSON.parse(localStorage.getItem(DELETED_KEY) ?? "{}");
    expect(deleted.cheeseRecipeNames).toEqual(["white fajita mix"]);
    expect(deleted.mixRecipeNames).toBeUndefined();
  });

  it("is guarded by a version marker (runs once)", () => {
    seed(CHEESE_RECIPE_NAMES_KEY, ["White Fajita Mix"]);
    seed(MIX_RECIPE_NAMES_KEY, ["White Fajita Mix"]);
    applyMixCheeseOverlapDedupeIfNeeded();
    expect(localStorage.getItem(MARKER)).toBe("1");

    // A duplicate created after the marker is set is left untouched.
    seed(CHEESE_RECIPE_NAMES_KEY, ["Late Mix"]);
    seed(MIX_RECIPE_NAMES_KEY, ["Late Mix"]);
    applyMixCheeseOverlapDedupeIfNeeded();
    expect(read(CHEESE_RECIPE_NAMES_KEY)).toContain("Late Mix");
  });

  it("sets the marker even when there is no overlap", () => {
    seed(CHEESE_RECIPE_NAMES_KEY, ["Mozzarella Cheese Mix"]);
    seed(MIX_RECIPE_NAMES_KEY, ["House Veggie Mix"]);
    applyMixCheeseOverlapDedupeIfNeeded();
    expect(localStorage.getItem(MARKER)).toBe("1");
    expect(read(CHEESE_RECIPE_NAMES_KEY)).toEqual(["Mozzarella Cheese Mix"]);
  });
});
