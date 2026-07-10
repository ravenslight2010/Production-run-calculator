// @vitest-environment jsdom
//
// One-time mix-slot cleanup migration (approved 2026-07-09). Older spec imports
// wrote a mix/cheese-blend RECIPE name straight into a profile's applicator
// TYPE slot (e.g. app2Type: "White Fajita Mix") and left the raw name in the
// shared Type dropdown. The migration converts those slots to the generic
// types the run form's cards gate on ("Mix" / "cheese"), preserves the name as
// the slot's recipe-name link, backfills rows from the local presets, moves
// remaining stray names out of ingredientTypes (with tombstones), ensures the
// generic "Cheese"/"Mix" dropdown entries exist, and queues converted mixes
// for a best-effort push to the server Mixes pool.

import { describe, it, expect, beforeEach } from "vitest";
import {
  applyMixSlotRecategorizeIfNeeded,
  loadPendingServerMixPushes,
  clearPendingServerMixPushes,
  loadProfile,
  saveBrandFlavors,
  saveCheeseRecipePresets,
  loadList,
  loadDeletedItems,
  tombstoneDeleted,
} from "./storage";
import {
  INGREDIENT_TYPES_KEY,
  CHEESE_RECIPE_NAMES_KEY,
  MIX_RECIPE_NAMES_KEY,
  PROFILE_KEY,
} from "./types";

const MARKER = "run-calc-mix-slot-recat-v1";

function seedProfile(brand: string, flavor: string, profile: Record<string, unknown>) {
  localStorage.setItem(PROFILE_KEY(brand, flavor), JSON.stringify(profile));
}
function readProfile(brand: string, flavor: string): Record<string, unknown> {
  return (loadProfile(brand, flavor) ?? {}) as Record<string, unknown>;
}
function read(key: string): string[] {
  return JSON.parse(localStorage.getItem(key) ?? "[]");
}

beforeEach(() => {
  localStorage.clear();
});

describe("applyMixSlotRecategorizeIfNeeded", () => {
  it("converts a raw mix-name applicator slot to 'Mix' with the name as the recipe link", () => {
    saveBrandFlavors({ "Corner Booth": ["FAJITA"] });
    seedProfile("Corner Booth", "FAJITA", {
      app2Type: "White Fajita Mix",
      app2CheeseRecipeName: "",
      app2CheeseRecipe: [],
    });
    applyMixSlotRecategorizeIfNeeded();
    const prof = readProfile("Corner Booth", "FAJITA");
    expect(prof.app2Type).toBe("Mix");
    expect(prof.app2CheeseRecipeName).toBe("White Fajita Mix");
  });

  it("converts a raw cheese-blend slot to 'cheese' instead", () => {
    saveBrandFlavors({ "Corner Booth": ["MEAT"] });
    seedProfile("Corner Booth", "MEAT", { app1Type: "Aldo's Cheese Mix" });
    applyMixSlotRecategorizeIfNeeded();
    const prof = readProfile("Corner Booth", "MEAT");
    expect(prof.app1Type).toBe("cheese");
    expect(prof.app1CheeseRecipeName).toBe("Aldo's Cheese Mix");
  });

  it("backfills slot rows from the local presets when the slot has none", () => {
    saveBrandFlavors({ "Corner Booth": ["FAJITA"] });
    saveCheeseRecipePresets({
      "White Fajita Mix": [
        { ingredient: "Monterey Jack", lbs: 20 },
        { ingredient: "Green Peppers", lbs: 5 },
      ],
    });
    seedProfile("Corner Booth", "FAJITA", { app2Type: "White Fajita Mix" });
    applyMixSlotRecategorizeIfNeeded();
    const prof = readProfile("Corner Booth", "FAJITA");
    expect(prof.app2CheeseRecipe).toEqual([
      { ingredient: "Monterey Jack", lbs: 20 },
      { ingredient: "Green Peppers", lbs: 5 },
    ]);
  });

  it("keeps existing slot rows and an existing recipe-name link untouched", () => {
    saveBrandFlavors({ "Corner Booth": ["FAJITA"] });
    seedProfile("Corner Booth", "FAJITA", {
      app2Type: "White Fajita Mix",
      app2CheeseRecipeName: "Canonical Fajita Mix",
      app2CheeseRecipe: [{ ingredient: "Jack", lbs: 9 }],
    });
    applyMixSlotRecategorizeIfNeeded();
    const prof = readProfile("Corner Booth", "FAJITA");
    expect(prof.app2CheeseRecipeName).toBe("Canonical Fajita Mix");
    expect(prof.app2CheeseRecipe).toEqual([{ ingredient: "Jack", lbs: 9 }]);
  });

  it("leaves real ingredient types and already-generic slots alone", () => {
    saveBrandFlavors({ "Corner Booth": ["SUPREME"] });
    seedProfile("Corner Booth", "SUPREME", {
      app1Type: "Sausage",
      app2Type: "cheese",
      app3Type: "Mix",
    });
    applyMixSlotRecategorizeIfNeeded();
    const prof = readProfile("Corner Booth", "SUPREME");
    expect(prof.app1Type).toBe("Sausage");
    expect(prof.app2Type).toBe("cheese");
    expect(prof.app3Type).toBe("Mix");
  });

  it("does not clobber unrelated profile fields (targeted write, not saveProfile)", () => {
    saveBrandFlavors({ "Corner Booth": ["FAJITA"] });
    seedProfile("Corner Booth", "FAJITA", {
      app2Type: "White Fajita Mix",
      crustType: "Thin",
      doughballWeightOz: 19,
    });
    applyMixSlotRecategorizeIfNeeded();
    const prof = readProfile("Corner Booth", "FAJITA");
    expect(prof.crustType).toBe("Thin");
    expect(prof.doughballWeightOz).toBe(19);
  });

  it("moves remaining stray names out of the Type dropdown with tombstones and adds the generics", () => {
    localStorage.setItem(
      INGREDIENT_TYPES_KEY,
      JSON.stringify(["4Hands Club Mix", "Aldo's Cheese Mix", "Pepperoni", "Hot Giardiniera Mix"]),
    );
    applyMixSlotRecategorizeIfNeeded();
    const ing = read(INGREDIENT_TYPES_KEY);
    expect(ing).toContain("Pepperoni");
    expect(ing).toContain("Hot Giardiniera Mix"); // allowlisted real ingredient
    expect(ing).toContain("Cheese");
    expect(ing).toContain("Mix");
    expect(ing).not.toContain("4Hands Club Mix");
    expect(ing).not.toContain("Aldo's Cheese Mix");
    const deleted = loadDeletedItems();
    expect(deleted.ingredientTypes).toEqual(
      expect.arrayContaining(["4hands club mix", "aldo's cheese mix"]),
    );
    expect(loadList(MIX_RECIPE_NAMES_KEY, [])).toContain("4Hands Club Mix");
    expect(loadList(CHEESE_RECIPE_NAMES_KEY, [])).toContain("Aldo's Cheese Mix");
  });

  it("clears deletion tombstones on the generic dropdown entries and moved recipe names", () => {
    tombstoneDeleted("ingredientTypes", "Mix");
    tombstoneDeleted("ingredientTypes", "Cheese");
    tombstoneDeleted("mixRecipeNames", "White Fajita Mix");
    saveBrandFlavors({ "Corner Booth": ["FAJITA"] });
    seedProfile("Corner Booth", "FAJITA", { app2Type: "White Fajita Mix" });
    applyMixSlotRecategorizeIfNeeded();
    const deleted = loadDeletedItems();
    expect(deleted.ingredientTypes ?? []).not.toContain("mix");
    expect(deleted.ingredientTypes ?? []).not.toContain("cheese");
    expect(deleted.mixRecipeNames ?? []).not.toContain("white fajita mix");
  });

  it("queues converted mixes (with preset ingredients) for the server push, deduped", () => {
    localStorage.setItem(INGREDIENT_TYPES_KEY, JSON.stringify(["White Fajita Mix"]));
    saveBrandFlavors({ "Corner Booth": ["FAJITA", "FAJITA XL"] });
    saveCheeseRecipePresets({
      "White Fajita Mix": [
        { ingredient: "Monterey Jack", lbs: 20 },
        { ingredient: "Green Peppers", lbs: 5 },
      ],
    });
    seedProfile("Corner Booth", "FAJITA", { app2Type: "White Fajita Mix" });
    seedProfile("Corner Booth", "FAJITA XL", { app2Type: "White Fajita Mix" });
    applyMixSlotRecategorizeIfNeeded();
    const pending = loadPendingServerMixPushes();
    expect(pending).toEqual([
      { name: "White Fajita Mix", componentIngredients: ["Monterey Jack", "Green Peppers"] },
    ]);
    clearPendingServerMixPushes();
    expect(loadPendingServerMixPushes()).toEqual([]);
  });

  it("does NOT queue cheese blends for the mix push", () => {
    saveBrandFlavors({ "Corner Booth": ["MEAT"] });
    seedProfile("Corner Booth", "MEAT", { app1Type: "Aldo's Cheese Mix" });
    applyMixSlotRecategorizeIfNeeded();
    expect(loadPendingServerMixPushes()).toEqual([]);
  });

  it("is guarded by a version marker (runs once) and sets it even when idle", () => {
    applyMixSlotRecategorizeIfNeeded();
    expect(localStorage.getItem(MARKER)).toBe("1");
    saveBrandFlavors({ "Corner Booth": ["FAJITA"] });
    seedProfile("Corner Booth", "FAJITA", { app2Type: "White Fajita Mix" });
    applyMixSlotRecategorizeIfNeeded();
    expect(readProfile("Corner Booth", "FAJITA").app2Type).toBe("White Fajita Mix");
  });
});
