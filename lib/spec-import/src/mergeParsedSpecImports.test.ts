// Multi-file batch merge: when two workbooks in one import batch mention the
// same brand+flavor profile or the same kind+name recipe, the combine step must
// merge them FIELD-LEVEL — not wholesale replace with the later file — or the
// earlier file's fields and recipe→profile ties silently vanish (reported by
// users as multi-file imports "mixing things up").

import { describe, it, expect } from "vitest";
import {
  mergeParsedSpecImports,
  recipeTargets,
  type ParsedProfile,
  type ParsedRecipe,
  type ParsedSpecImport,
} from "./index";

const profile = (over: Partial<ParsedProfile> = {}): ParsedProfile => ({
  brand: "Aldo's",
  flavor: "Cheese",
  applicators: [],
  pepperonis: [],
  ...over,
});

const recipe = (over: Partial<ParsedRecipe> = {}): ParsedRecipe => ({
  kind: "dough",
  name: "House Dough",
  rows: [{ ingredient: "Flour", lbs: 50 }],
  ...over,
});

const fileOf = (profiles: ParsedProfile[], recipes: ParsedRecipe[] = []): ParsedSpecImport => ({
  profiles,
  recipes,
});

describe("mergeParsedSpecImports — cross-file collisions merge, not clobber", () => {
  it("keeps distinct profiles and recipes from different files side by side", () => {
    const out = mergeParsedSpecImports([
      fileOf([profile()], [recipe()]),
      fileOf([profile({ brand: "Basha's" })], [recipe({ kind: "sauce", name: "Marinara" })]),
    ]);
    expect(out.profiles).toHaveLength(2);
    expect(out.recipes).toHaveLength(2);
  });

  it("field-merges a colliding profile: later file's stated fields win, unstated fields survive", () => {
    const out = mergeParsedSpecImports([
      fileOf([profile({ dieType: "12 inch", sauceOzPerPizza: 4, pizzasPerCase: 12 })]),
      fileOf([profile({ sauceOzPerPizza: 5 })]),
    ]);
    expect(out.profiles).toHaveLength(1);
    const p = out.profiles[0];
    expect(p.sauceOzPerPizza).toBe(5); // later file stated it → wins
    expect(p.dieType).toBe("12 inch"); // later file silent → earlier survives
    expect(p.pizzasPerCase).toBe(12);
  });

  it("keeps earlier applicators/pepperonis when the later file lists none (empty = not stated)", () => {
    const out = mergeParsedSpecImports([
      fileOf([
        profile({
          applicators: [{ type: "Mozzarella", ozPerPizza: 5 }],
          pepperonis: [{ type: "Pepperoni", sticks: 2, ozPerPizza: 1.5 }],
        }),
      ]),
      fileOf([profile({ pizzasPerCase: 10 })]),
    ]);
    const p = out.profiles[0];
    expect(p.applicators).toHaveLength(1);
    expect(p.pepperonis).toHaveLength(1);
    expect(p.pizzasPerCase).toBe(10);
  });

  it("replaces applicators when the later file DOES list them", () => {
    const out = mergeParsedSpecImports([
      fileOf([profile({ applicators: [{ type: "Mozzarella", ozPerPizza: 5 }] })]),
      fileOf([profile({ applicators: [{ type: "Cheddar", ozPerPizza: 3 }] })]),
    ]);
    expect(out.profiles[0].applicators).toEqual([{ type: "Cheddar", ozPerPizza: 3 }]);
  });

  it("unions brand/flavor ties when two files share one recipe name (no file loses its products)", () => {
    const out = mergeParsedSpecImports([
      fileOf([], [recipe({ brand: "Aldo's", flavor: "Cheese" })]),
      fileOf([], [recipe({ brand: "Basha's", flavor: "Pepperoni", rows: [{ ingredient: "Flour", lbs: 55 }] })]),
    ]);
    expect(out.recipes).toHaveLength(1);
    const ties = recipeTargets(out.recipes[0]);
    expect(ties).toEqual(
      expect.arrayContaining([
        { brand: "Aldo's", flavor: "Cheese" },
        { brand: "Basha's", flavor: "Pepperoni" },
      ]),
    );
    // Later file's rows win (single-file overwrite-by-name semantics).
    expect(out.recipes[0].rows).toEqual([{ ingredient: "Flour", lbs: 55 }]);
  });

  it("keeps earlier rows when the later duplicate has none", () => {
    const out = mergeParsedSpecImports([
      fileOf([], [recipe()]),
      fileOf([], [recipe({ rows: [], flavor: "Sausage", brand: "Aldo's" })]),
    ]);
    expect(out.recipes[0].rows).toEqual([{ ingredient: "Flour", lbs: 50 }]);
  });

  it("preserves a flavorless whole-brand anchor from the earlier file as a brandAnchor", () => {
    const out = mergeParsedSpecImports([
      fileOf([], [recipe({ brand: "Hannaford", flavor: undefined })]),
      fileOf([], [recipe({ brand: "Lucia", flavor: "Cheese" })]),
    ]);
    const r = out.recipes[0];
    expect(r.brandAnchors).toContain("Hannaford");
    expect(recipeTargets(r)).toEqual([{ brand: "Lucia", flavor: "Cheese" }]);
  });

  it("unions brandAnchors from both files without duplicates (case-insensitive)", () => {
    const out = mergeParsedSpecImports([
      fileOf([], [recipe({ brandAnchors: ["Hannaford", "Lucia"] })]),
      fileOf([], [recipe({ brandAnchors: ["lucia", "Wegmans"] })]),
    ]);
    expect(out.recipes[0].brandAnchors).toEqual(["Hannaford", "Lucia", "Wegmans"]);
  });

  it("keeps earlier dough scalars the later duplicate doesn't state", () => {
    const out = mergeParsedSpecImports([
      fileOf([], [recipe({ doughballOz: 18, doughBatchYield: 120 })]),
      fileOf([], [recipe({ rows: [{ ingredient: "Flour", lbs: 60 }] })]),
    ]);
    expect(out.recipes[0].doughballOz).toBe(18);
    expect(out.recipes[0].doughBatchYield).toBe(120);
  });

  it("never collides recipes of different kinds or nameless recipes", () => {
    const out = mergeParsedSpecImports([
      fileOf([], [recipe({ kind: "dough", name: "Base" }), recipe({ kind: "sauce", name: "Base" })]),
      fileOf([], [recipe({ name: "" }), recipe({ name: " " })]),
    ]);
    expect(out.recipes).toHaveLength(4);
  });

  it("single-file passthrough keeps content unchanged", () => {
    const one = fileOf([profile()], [recipe()]);
    const out = mergeParsedSpecImports([one]);
    expect(out.profiles).toEqual(one.profiles);
    expect(out.recipes).toEqual(one.recipes);
  });
});

// ── Duplicate-prevention: overlapping multi-file batches ─────────────────────
//
// When two workbooks in one batch describe the same profile (same brand+flavor)
// or the same recipe (same kind+name), the merge must produce EXACTLY ONE entry
// regardless of minor name variations — case differences, trailing whitespace —
// that could slip past a naive string-equality check. An equally important
// counter-case: a profile that appears ONLY in the first file must not be
// silently dropped because the second file omits it.

describe("mergeParsedSpecImports — no duplicate profiles or recipes from overlapping files", () => {
  it("two files with the same brand+flavor profile yield exactly one profile", () => {
    const out = mergeParsedSpecImports([
      fileOf([profile({ brand: "Aldo's", flavor: "Cheese", dieType: "12 inch" })]),
      fileOf([profile({ brand: "Aldo's", flavor: "Cheese", pizzasPerCase: 8 })]),
    ]);
    expect(out.profiles).toHaveLength(1);
    // Both files' data is present in the single merged profile
    expect(out.profiles[0].dieType).toBe("12 inch");
    expect(out.profiles[0].pizzasPerCase).toBe(8);
  });

  it("recipe name differing only in case between two files yields exactly one recipe", () => {
    const out = mergeParsedSpecImports([
      fileOf([], [recipe({ name: "House Dough", brand: "Aldo's", flavor: "Cheese" })]),
      fileOf([], [recipe({ name: "HOUSE DOUGH", brand: "Basha's", flavor: "Pepperoni", rows: [{ ingredient: "Flour", lbs: 60 }] })]),
    ]);
    expect(out.recipes).toHaveLength(1);
    // Both files' brand+flavor ties must be unioned into the single recipe
    const ties = recipeTargets(out.recipes[0]);
    expect(ties).toEqual(
      expect.arrayContaining([
        { brand: "Aldo's", flavor: "Cheese" },
        { brand: "Basha's", flavor: "Pepperoni" },
      ]),
    );
  });

  it("recipe name differing only in surrounding whitespace between two files yields exactly one recipe", () => {
    const out = mergeParsedSpecImports([
      fileOf([], [recipe({ name: "House Dough ", brand: "Aldo's", flavor: "Cheese" })]),
      fileOf([], [recipe({ name: " House Dough", brand: "Basha's", flavor: "Sausage", rows: [{ ingredient: "Flour", lbs: 55 }] })]),
    ]);
    expect(out.recipes).toHaveLength(1);
    const ties = recipeTargets(out.recipes[0]);
    expect(ties).toEqual(
      expect.arrayContaining([
        { brand: "Aldo's", flavor: "Cheese" },
        { brand: "Basha's", flavor: "Sausage" },
      ]),
    );
  });

  it("a profile present only in file A is NOT dropped when file B omits it", () => {
    // File A has two profiles; file B mentions only one of them.
    // The profile absent from file B must survive the merge unchanged.
    const profileA = profile({ brand: "Aldo's", flavor: "Cheese", dieType: "12 inch" });
    const profileShared = profile({ brand: "Basha's", flavor: "Pepperoni", pizzasPerCase: 6 });
    const out = mergeParsedSpecImports([
      fileOf([profileA, profileShared]),
      fileOf([profile({ brand: "Basha's", flavor: "Pepperoni", sauceOzPerPizza: 3 })]),
    ]);
    expect(out.profiles).toHaveLength(2);
    const aldos = out.profiles.find((p) => p.brand === "Aldo's");
    expect(aldos).toBeDefined();
    expect(aldos?.dieType).toBe("12 inch");
    // The shared profile picked up the update from file B
    const bashas = out.profiles.find((p) => p.brand === "Basha's");
    expect(bashas?.sauceOzPerPizza).toBe(3);
    expect(bashas?.pizzasPerCase).toBe(6);
  });

  it("same brand+flavor with overlapping recipe names yields one profile and one recipe entry", () => {
    // Both files describe the same product and point to the same dough recipe
    // (the recipe name is identical modulo case). The final result must be
    // exactly one profile and one recipe — no duplicates.
    const out = mergeParsedSpecImports([
      fileOf(
        [profile({ brand: "Lucia", flavor: "Cheese", dieType: "10 inch" })],
        [recipe({ kind: "dough", name: "Lucia Thin Dough", brand: "Lucia", flavor: "Cheese" })],
      ),
      fileOf(
        [profile({ brand: "Lucia", flavor: "Cheese", sauceOzPerPizza: 2.5 })],
        [recipe({ kind: "dough", name: "lucia thin dough", brand: "Lucia", flavor: "Cheese", rows: [{ ingredient: "Flour", lbs: 45 }] })],
      ),
    ]);
    expect(out.profiles).toHaveLength(1);
    expect(out.recipes).toHaveLength(1);
    // Profile merges both files' fields
    expect(out.profiles[0].dieType).toBe("10 inch");
    expect(out.profiles[0].sauceOzPerPizza).toBe(2.5);
    // Recipe keeps later file's rows, ties union to a single Lucia/Cheese entry
    expect(out.recipes[0].rows).toEqual([{ ingredient: "Flour", lbs: 45 }]);
    const ties = recipeTargets(out.recipes[0]);
    const luciaCount = ties.filter((t) => t.brand === "Lucia" && t.flavor === "Cheese").length;
    expect(luciaCount).toBe(1);
  });
});
