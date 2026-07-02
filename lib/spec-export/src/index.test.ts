import { describe, it, expect } from "vitest";
import {
  parsePremixWorkbook,
  groundPremix,
  premixToMix,
  type PremixKnown,
} from "@workspace/premix-import";
import type { Mix } from "@workspace/mixes";
import {
  buildSpecExportGrids,
  buildMixExportGrids,
  sanitizeSheetName,
  type SpecExportInput,
  type SpecExportSelection,
} from "./index";

const ALL: SpecExportSelection = { profiles: true, dough: true, sauce: true, cheese: true };

function findSheet(grids: { name: string; rows: string[][] }[], name: string) {
  const g = grids.find((x) => x.name === name);
  if (!g) throw new Error(`missing sheet ${name}`);
  return g;
}

describe("buildSpecExportGrids", () => {
  const input: SpecExportInput = {
    profiles: [
      {
        brand: "Bobo's Original",
        flavor: "Pepperoni",
        dieType: "12 inch",
        sauceOzPerPizza: 4,
        applicators: [
          { type: "Mozzarella", ozPerPizza: 3.5 },
          { type: "", ozPerPizza: 0 },
        ],
        pepperonis: [{ type: "Sliced Pepperoni", sticks: 2, ozPerPizza: 1.5 }],
        doughRecipeName: "Standard Dough",
        targetDoughballWeight: 12,
        sauceRecipeName: "Pizza Sauce",
        cheeseRecipeNames: ["Cheese Blend", undefined, undefined, undefined],
      },
      {
        brand: "Bobo's Original",
        flavor: "Cheese",
        dieType: "12 inch",
        sauceOzPerPizza: 4,
        applicators: [{ type: "Mozzarella", ozPerPizza: 3.5 }],
        pepperonis: [],
        doughRecipeName: "Standard Dough",
        targetDoughballWeight: 12,
        sauceRecipeName: "Pizza Sauce",
        cheeseRecipeNames: ["Cheese Blend"],
      },
    ],
    doughRecipes: [{ name: "Standard Dough", rows: [{ ingredient: "Flour", lbs: 50 }, { ingredient: "Water", lbs: 30 }] }],
    sauceRecipes: [{ name: "Pizza Sauce", rows: [{ ingredient: "Tomato Paste", lbs: 20 }] }],
    cheeseRecipes: [{ name: "Cheese Blend", rows: [{ ingredient: "Mozzarella", lbs: 40 }] }],
  };

  it("emits a Profiles sheet with a header + one row per brand+flavor", () => {
    const grids = buildSpecExportGrids(input, ALL);
    const profiles = findSheet(grids, "Profiles");
    expect(profiles.rows[0]?.[0]).toBe("Brand");
    // header + 2 profiles
    expect(profiles.rows.length).toBe(3);
    const row = profiles.rows.find((r) => r[1] === "Pepperoni")!;
    expect(row[0]).toBe("Bobo's Original");
    expect(row[2]).toBe("12 inch");
    expect(row[3]).toBe("4");
    expect(row[4]).toBe("Mozzarella");
    expect(row[5]).toBe("3.5");
    // pep 1 type/sticks/oz
    expect(row[12]).toBe("Sliced Pepperoni");
    expect(row[13]).toBe("2");
    expect(row[14]).toBe("1.5");
  });

  it("emits recipe blocks with Brand: flavor targets and ingredient tables", () => {
    const grids = buildSpecExportGrids(input, ALL);
    const dough = findSheet(grids, "Dough Recipes");
    const flat = dough.rows.map((r) => r.join("|"));
    expect(flat).toContain("Recipe: Standard Dough");
    // both flavors listed under the one brand
    expect(flat.some((l) => l === "Bobo's Original: Pepperoni, Cheese" || l === "Bobo's Original: Cheese, Pepperoni")).toBe(true);
    expect(flat).toContain("Target Doughball Weight (oz)|12");
    expect(flat).toContain("Ingredient|Lbs");
    expect(flat).toContain("Flour|50");

    const cheese = findSheet(grids, "Cheese Recipes");
    const cflat = cheese.rows.map((r) => r.join("|"));
    expect(cflat).toContain("Recipe: Cheese Blend");
    expect(cflat).toContain("Applicator Slot|1");
  });

  it("honors the selection (only chosen kinds are emitted)", () => {
    const only: SpecExportSelection = { profiles: true, dough: false, sauce: false, cheese: false };
    const grids = buildSpecExportGrids(input, only);
    expect(grids.map((g) => g.name)).toEqual(["Profiles"]);
  });

  it("skips an orphan-free empty kind but still exports library-only recipes without targets", () => {
    const orphan: SpecExportInput = {
      profiles: [],
      doughRecipes: [{ name: "Masa Dough", rows: [{ ingredient: "Masa", lbs: 10 }] }],
      sauceRecipes: [],
      cheeseRecipes: [],
    };
    const grids = buildSpecExportGrids(orphan, ALL);
    expect(grids.map((g) => g.name)).toEqual(["Dough Recipes"]);
    const flat = grids[0]!.rows.map((r) => r.join("|"));
    expect(flat).toContain("Recipe: Masa Dough");
    // no profile → no "Brand: flavor" line
    expect(flat.some((l) => l.includes(":") && !l.startsWith("Recipe:"))).toBe(false);
  });
});

describe("sanitizeSheetName", () => {
  it("strips illegal chars and clamps to 31 chars", () => {
    expect(sanitizeSheetName("Bobo's / Pep [11in]?", "x")).toBe("Bobo's Pep 11in");
    expect(sanitizeSheetName("", "fallback")).toBe("fallback");
    expect(sanitizeSheetName("a".repeat(50), "x").length).toBe(31);
  });
});

describe("mix export round-trips through the deterministic premix importer", () => {
  const mixes: Mix[] = [
    {
      id: "premix-bobo-s-original-pepperoni-bobo-s-veggie-mix",
      name: "Bobo's Veggie Mix",
      brand: "Bobo's Original",
      flavor: "Pepperoni",
      batchSize: 100,
      daysEarly: 3,
      amountAlreadyMade: 0,
      components: [
        { ingredient: "Onions", perPizza: 0.5 },
        { ingredient: "Peppers", perPizza: 0.25 },
      ],
      enabled: true,
    },
  ];

  it("re-parses to the same name, components, batch size and days-early", () => {
    const grids = buildMixExportGrids(mixes);
    expect(grids.length).toBe(1);
    const parsed = parsePremixWorkbook(grids);
    expect(parsed.length).toBe(1);
    const p = parsed[0]!;
    expect(p.name).toBe("Bobo's Veggie Mix");
    expect(p.batchSize).toBe(100);
    expect(p.daysEarly).toBe(3);
    expect(p.components).toEqual([
      { ingredient: "Onions", perPizza: 0.5, perBatch: 0 },
      { ingredient: "Peppers", perPizza: 0.25, perBatch: 0 },
    ]);
  });

  it("grounds brand/flavor from the tab name and reconstructs a matching Mix id", () => {
    const grids = buildMixExportGrids(mixes);
    const parsed = parsePremixWorkbook(grids);
    const known: PremixKnown = {
      brands: ["Bobo's Original"],
      flavorsByBrand: { "Bobo's Original": ["Pepperoni", "Cheese"] },
      ingredients: ["Onions", "Peppers"],
    };
    const grounded = groundPremix(parsed[0]!, known, []);
    const mix = premixToMix(grounded.mix);
    expect(mix).not.toBeNull();
    expect(mix!.brand).toBe("Bobo's Original");
    expect(mix!.flavor).toBe("Pepperoni");
    expect(mix!.name).toBe("Bobo's Veggie Mix");
    expect(mix!.id).toBe(mixes[0]!.id);
    expect(mix!.batchSize).toBe(100);
    expect(mix!.components).toEqual([
      { ingredient: "Onions", perPizza: 0.5 },
      { ingredient: "Peppers", perPizza: 0.25 },
    ]);
  });
});
