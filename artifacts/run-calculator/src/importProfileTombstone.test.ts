// @vitest-environment jsdom
//
// Import-tombstone contract. A spec import routes each parsed profile through
// importProfileIsTombstoned and each parsed recipe through recipeNameIsTombstoned;
// a `true` result moves the item to the "skipped" bucket (surfaced for the user
// to knowingly re-include) instead of applying it.
//
// Principle: a prior DELETE only protects against live-sync RESURRECTION, not
// against a deliberate RE-IMPORT — so a deleted brand/flavor/recipe must NOT be
// skipped on import (applySpecImport clears its tombstone as it re-applies).
// Only a MERGED-away name (the flat mergedAway set) is still surfaced/checked.

import { describe, it, expect, beforeEach } from "vitest";
import {
  importProfileIsTombstoned,
  recipeNameIsTombstoned,
  applyIngredientMerge,
  tombstoneDeleted,
  flavorNamespace,
} from "./storage";

beforeEach(() => {
  localStorage.clear();
});

describe("importProfileIsTombstoned", () => {
  it("does NOT suppress an imported profile whose flavor collides with a merged-away ingredient/pep name", () => {
    // A real ingredient-type merge records "Pepperoni" in the flat mergedAway set.
    applyIngredientMerge({ Pepperoni: "Pepperoni Stick" });
    expect(importProfileIsTombstoned("Basha's Original", "PEPPERONI")).toBe(false);
  });

  it("does NOT suppress a profile whose brand was previously deleted (deletes are re-importable)", () => {
    // The user deleted the brand earlier; re-importing the spec sheet must bring
    // it back rather than silently skip it.
    tombstoneDeleted("brands", "Basha's Original");
    expect(importProfileIsTombstoned("Basha's Original", "PEPPERONI")).toBe(false);
  });

  it("does NOT suppress a profile whose flavor was previously deleted within its brand", () => {
    tombstoneDeleted(flavorNamespace("Basha's Original"), "PEPPERONI");
    expect(importProfileIsTombstoned("Basha's Original", "PEPPERONI")).toBe(false);
    expect(importProfileIsTombstoned("Basha's Original", "CHEESE")).toBe(false);
  });

  it("accepts a normal profile when there are no tombstones", () => {
    expect(importProfileIsTombstoned("Basha's Original", "SUPREME")).toBe(false);
  });
});

describe("recipeNameIsTombstoned", () => {
  it("does NOT suppress a recipe that was only DELETED (deletes are re-importable)", () => {
    tombstoneDeleted("doughRecipeNames", "Classic Dough");
    expect(recipeNameIsTombstoned("dough", "Classic Dough")).toBe(false);
  });

  it("does NOT false-suppress a recipe whose name collides with a merged-away INGREDIENT", () => {
    // The flat mergedAway set is fed ONLY by ingredient/app/pep merges; a recipe
    // named like a merged ingredient ("Pepperoni") must still import, not vanish.
    applyIngredientMerge({ Pepperoni: "Pepperoni Stick" });
    expect(recipeNameIsTombstoned("cheese", "Pepperoni")).toBe(false);
  });

  it("accepts a normal recipe name when there are no tombstones", () => {
    expect(recipeNameIsTombstoned("cheese", "Five Cheese")).toBe(false);
  });

  it("never suppresses a blank recipe name", () => {
    expect(recipeNameIsTombstoned("dough", "   ")).toBe(false);
  });
});
