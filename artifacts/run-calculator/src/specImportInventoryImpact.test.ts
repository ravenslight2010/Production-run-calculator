import { describe, expect, it } from "vitest";
import type { ParsedSpecImport } from "@workspace/spec-import";
import { DEFAULT_VALUES } from "./types";
import { computeRunLines } from "./inventoryShared";
import {
  projectSpecImportForIncludedProducts,
  projectSpecImportForRun,
} from "./specImportInventoryImpact";

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
    expect(projection.plannedCases).toBe(2);
    expect(values.pizzasPerCase).toBe(10);
    expect(values.app1CheeseRecipe).toEqual([{ ingredient: "Old Cheese", lbs: 10 }]);
  });

  it("projects one-case demand when there is no explicit planned case count", () => {
    const projection = projectSpecImportForRun(
      {
        brand: "Acme",
        flavor: "Supreme",
        values: { ...DEFAULT_VALUES, casesNeeded: 0 },
      },
      { profiles: [{ brand: "Acme", flavor: "Supreme", pizzasPerCase: 12, applicators: [], pepperonis: [] }], recipes: [] },
      new Set(),
      () => "cheese",
    );

    expect(projection).toMatchObject({
      status: "ready",
      plannedCases: null,
      values: { casesNeeded: 1, pizzasPerCase: 12 },
    });
  });

  it("projects all included products without borrowing the selected product's case count or case pack", () => {
    const parsed: ParsedSpecImport = {
      profiles: [
        {
          brand: "Acme",
          flavor: "Supreme",
          pizzasPerCase: 10,
          applicators: [{ type: "Pepperoni", ozPerPizza: 1 }],
          pepperonis: [],
        },
        {
          brand: "Acme",
          flavor: "Veggie",
          pizzasPerCase: 12,
          applicators: [{ type: "Pepperoni", ozPerPizza: 2 }],
          pepperonis: [],
        },
      ],
      recipes: [],
    };
    const projections = projectSpecImportForIncludedProducts(
      {
        brand: "Acme",
        flavor: "Supreme",
        values: {
          ...DEFAULT_VALUES,
          casesNeeded: 3,
          pizzasPerCase: 10,
          cartonsPerCase: 2,
          cartonSize: 1,
          app1Type: "Pepperoni",
          app1OzPerPizza: 0.5,
        },
      },
      parsed,
      new Set(),
      () => "cheese",
    );

    expect(projections).toHaveLength(2);
    expect(projections[0]).toMatchObject({
      status: "ready",
      profileLabel: "Acme — Supreme",
      plannedCases: 3,
      values: { casesNeeded: 3, pizzasPerCase: 10, app1OzPerPizza: 1 },
    });
    expect(projections[1]).toMatchObject({
      status: "ready",
      profileLabel: "Acme — Veggie",
      plannedCases: null,
      values: { casesNeeded: 1, pizzasPerCase: 12, app1OzPerPizza: 2 },
    });
    if (projections[0].status !== "ready" || projections[1].status !== "ready") {
      throw new Error("Expected both products to have a projection");
    }

    const supremeDemand = computeRunLines(projections[0].values);
    const veggieDemand = computeRunLines(projections[1].values);
    expect(supremeDemand.find((line) => line.key === "ingredient:Pepperoni:lbs")?.qty)
      .toBeGreaterThan(veggieDemand.find((line) => line.key === "ingredient:Pepperoni:lbs")?.qty ?? 0);
    expect(supremeDemand.find((line) => line.key === "packaging:cartons:cases")?.qty).toBe(15);
    expect(veggieDemand.find((line) => line.key === "packaging:cartons:cases")?.qty).toBe(6);
  });

  it("keeps a product unavailable when its case pack is unknown instead of borrowing another product's value", () => {
    const projections = projectSpecImportForIncludedProducts(
      {
        brand: "Acme",
        flavor: "Supreme",
        values: { ...DEFAULT_VALUES, casesNeeded: 4, pizzasPerCase: 10 },
      },
      {
        profiles: [
          { brand: "Acme", flavor: "Veggie", applicators: [], pepperonis: [] },
        ],
        recipes: [],
      },
      new Set(),
      () => "cheese",
    );

    expect(projections[0]).toMatchObject({
      status: "unavailable",
      profileLabel: "Acme — Veggie",
      plannedCases: null,
      reason: "A positive pizzas-per-case value is needed to project this product's demand.",
    });
  });
});
