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
