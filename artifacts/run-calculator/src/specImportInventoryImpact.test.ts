import { describe, expect, it } from "vitest";
import type { ParsedSpecImport } from "@workspace/spec-import";
import { DEFAULT_VALUES } from "./types";
import { projectSpecImportForRun } from "./specImportInventoryImpact";

describe("projectSpecImportForRun", () => {
  it("projects reviewed case-pack, applicator, and recipe changes without mutating the run", () => {
    const values = {
      ...DEFAULT_VALUES,
      casesNeeded: 2,
      pizzasPerCase: 10,
      app1Type: "cheese",
      app1OzPerPizza: 1,
      app1CheeseRecipeName: "Blend",
      app1CheeseRecipe: [{ ingredient: "Old Cheese", lbs: 10 }],
    };
    const parsed: ParsedSpecImport = {
      profiles: [{
        brand: "Acme",
        flavor: "Supreme",
        pizzasPerCase: 12,
        applicators: [{ type: "Mix", recipeName: "Blend", ozPerPizza: 2 }],
        pepperonis: [],
      }],
      recipes: [{
        kind: "cheese",
        forcedCategory: "mix",
        name: "Blend",
        brand: "Acme",
        flavor: "Supreme",
        rows: [{ ingredient: "New Cheese", lbs: 20 }],
      }],
    };

    const projection = projectSpecImportForRun(
      { brand: "Acme", flavor: "Supreme", values },
      parsed,
      new Set(),
      (recipe) => recipe.forcedCategory === "mix" ? "mix" : "cheese",
    );

    expect(projection).toMatchObject({ status: "ready", profileLabel: "Acme — Supreme" });
    if (projection.status !== "ready") throw new Error("Expected a ready projection");
    expect(projection.values).toMatchObject({
      casesNeeded: 2,
      pizzasPerCase: 12,
      app1Type: "Mix",
      app1OzPerPizza: 2,
      app1CheeseRecipe: [{ ingredient: "New Cheese", lbs: 20 }],
    });
    expect(values.pizzasPerCase).toBe(10);
    expect(values.app1CheeseRecipe).toEqual([{ ingredient: "Old Cheese", lbs: 10 }]);
  });

  it("identifies missing comparison inputs instead of guessing a run size", () => {
    const projection = projectSpecImportForRun(
      {
        brand: "Acme",
        flavor: "Supreme",
        values: { ...DEFAULT_VALUES, casesNeeded: 2 },
      },
      { profiles: [{ brand: "Acme", flavor: "Supreme", pizzasPerCase: 12, applicators: [], pepperonis: [] }], recipes: [] },
      new Set(),
      () => "cheese",
    );

    expect(projection).toMatchObject({
      status: "unavailable",
      reason: "A positive pizzas-per-case value is needed before and after the import to compare demand.",
    });
  });
});
