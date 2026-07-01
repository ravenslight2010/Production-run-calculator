import { describe, it, expect, beforeEach } from "vitest";
import { applyStrayMixRecategorizeIfNeeded } from "./storage";
import {
  INGREDIENT_TYPES_KEY,
  CHEESE_RECIPE_NAMES_KEY,
  MIX_RECIPE_NAMES_KEY,
} from "./types";

const MARKER = "run-calc-recat-stray-mix-v1";
const DELETED_KEY = "run-calc-deleted-items";

function seedIngredients(names: string[]) {
  localStorage.setItem(INGREDIENT_TYPES_KEY, JSON.stringify(names));
}
function read(key: string): string[] {
  return JSON.parse(localStorage.getItem(key) ?? "[]");
}

describe("applyStrayMixRecategorizeIfNeeded", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("moves stray mix names to Mixes and cheese-mix names to Cheese, keeping real ingredients", () => {
    seedIngredients([
      "4Hands Club Mix",
      "Aldo's Cheese Mix",
      "Red Hot Cheese Mix Monterey Jack 5.0",
      "Pepperoni",
      "Mushroom",
      "Hot Giardiniera Mix", // allowlisted real ingredient — must stay
    ]);

    applyStrayMixRecategorizeIfNeeded();

    const ingredients = read(INGREDIENT_TYPES_KEY);
    expect(ingredients).toContain("Pepperoni");
    expect(ingredients).toContain("Mushroom");
    expect(ingredients).toContain("Hot Giardiniera Mix");
    expect(ingredients).not.toContain("4Hands Club Mix");
    expect(ingredients).not.toContain("Aldo's Cheese Mix");

    expect(read(MIX_RECIPE_NAMES_KEY)).toContain("4Hands Club Mix");
    expect(read(MIX_RECIPE_NAMES_KEY)).not.toContain("Aldo's Cheese Mix");

    expect(read(CHEESE_RECIPE_NAMES_KEY)).toEqual(
      expect.arrayContaining(["Aldo's Cheese Mix", "Red Hot Cheese Mix Monterey Jack 5.0"]),
    );
  });

  it("tombstones moved ingredient names so live-sync can't resurrect them", () => {
    seedIngredients(["4Hands Club Mix", "Aldo's Cheese Mix"]);
    applyStrayMixRecategorizeIfNeeded();
    const deleted = JSON.parse(localStorage.getItem(DELETED_KEY) ?? "{}");
    expect(deleted.ingredientTypes).toEqual(
      expect.arrayContaining(["4hands club mix", "aldo's cheese mix"]),
    );
  });

  it("is guarded by a version marker (runs once)", () => {
    seedIngredients(["4Hands Club Mix"]);
    applyStrayMixRecategorizeIfNeeded();
    expect(localStorage.getItem(MARKER)).toBe("1");

    // A later stray name added after the marker is set is left untouched.
    seedIngredients(["Late Club Mix"]);
    applyStrayMixRecategorizeIfNeeded();
    expect(read(INGREDIENT_TYPES_KEY)).toContain("Late Club Mix");
    expect(read(MIX_RECIPE_NAMES_KEY)).not.toContain("Late Club Mix");
  });

  it("sets the marker even when there is nothing to move", () => {
    seedIngredients(["Pepperoni", "Mushroom"]);
    applyStrayMixRecategorizeIfNeeded();
    expect(localStorage.getItem(MARKER)).toBe("1");
    expect(read(MIX_RECIPE_NAMES_KEY)).toEqual([]);
  });
});
