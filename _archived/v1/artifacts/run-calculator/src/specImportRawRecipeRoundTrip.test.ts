// @vitest-environment jsdom
//
// Regression for saved-spec re-imports: raw recipe row numbers are source
// values, not unit-converted values. Keep that contract intact through the
// chunk merge, saved snapshot/prune, reconciliation, and local apply paths.

import { describe, expect, it, beforeEach } from "vitest";
import {
  mergeParsedSpecImports,
  mergePruneSnapshots,
  pruneSpecImportAgainstSnapshot,
  type ParsedSpecImport,
} from "@workspace/spec-import";
import {
  reconcileSpecWithRecipes,
  toReconcileRecipes,
} from "@workspace/spec-reconcile";
import {
  applySpecImport,
  loadDoughRecipePresets,
  loadFrontlineRecipePresets,
  loadProfile,
} from "./storage";

const doughRows = [
  { ingredient: "Flour", lbs: 500 },
  { ingredient: "Water", lbs: 125.25 },
];
const sauceRows = [
  { ingredient: "Tomato", lbs: 32 },
  { ingredient: "Water", lbs: 8.5 },
];

function profile(over: Partial<ParsedSpecImport["profiles"][number]> = {}) {
  return {
    brand: "Raw Values",
    flavor: "Round Trip",
    dieType: "12 inch",
    doughName: "Large Dough",
    sauceName: "Large Sauce",
    applicators: [],
    pepperonis: [],
    ...over,
  };
}

describe("saved spec raw recipe row round trip", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("keeps dough and sauce row values unchanged through chunk merge, snapshot, reconcile, and apply", () => {
    // The real large-sheet path merges chunks from one workbook. Put the
    // profile links in separate chunks too, so this exercises the field-level
    // profile merge instead of only testing a single parsed object.
    const chunks: ParsedSpecImport[] = [
      {
        profiles: [profile({ sauceName: undefined })],
        recipes: [{ kind: "dough", name: "Large Dough", rows: doughRows }],
      },
      {
        profiles: [profile({ doughName: undefined })],
        recipes: [{ kind: "sauce", name: "Large Sauce", rows: sauceRows }],
      },
    ];

    const merged = mergeParsedSpecImports(chunks, { profileSlots: "union" });
    expect(merged.recipes).toEqual([
      { kind: "dough", name: "Large Dough", rows: doughRows },
      { kind: "sauce", name: "Large Sauce", rows: sauceRows },
    ]);
    expect(merged.profiles[0]).toMatchObject({
      doughName: "Large Dough",
      sauceName: "Large Sauce",
    });

    // A saved snapshot is the merged parse. Re-import pruning must not
    // reinterpret or demote recipe rows; recipe content is spec-authoritative.
    const snapshot = mergePruneSnapshots([merged]);
    const reimport = mergeParsedSpecImports(chunks, { profileSlots: "union" });
    const pruned = pruneSpecImportAgainstSnapshot(reimport, snapshot).parsed;
    expect(pruned.recipes).toEqual(snapshot.recipes);

    // Reconciliation normalizes the saved shape but must retain the same raw
    // numbers and report no discrepancy against the re-imported recipes.
    const reconciledSpec = toReconcileRecipes(snapshot.recipes);
    const reconciledCurrent = toReconcileRecipes(pruned.recipes);
    expect(reconciledSpec).toEqual(reconciledCurrent);
    expect(
      reconcileSpecWithRecipes({
        specRecipes: reconciledSpec,
        currentRecipes: reconciledCurrent,
      }),
    ).toEqual([]);

    applySpecImport(pruned);

    expect(loadDoughRecipePresets()["Large Dough"]?.rows).toEqual(doughRows);
    expect(loadFrontlineRecipePresets()["Large Sauce"]).toEqual(sauceRows);
    expect(loadProfile("Raw Values", "Round Trip")).toMatchObject({
      doughRecipeName: "Large Dough",
      doughRecipe: doughRows,
      frontlineRecipeName: "Large Sauce",
      frontlineRecipe: sauceRows,
    });
  });
});