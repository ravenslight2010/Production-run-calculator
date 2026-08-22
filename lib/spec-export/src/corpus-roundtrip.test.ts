// Corpus-style round-trip coverage for both exporter workbooks.
//
// The spec/recipe importer has an AI boundary, so its deterministic contract is
// the semantic workbook document that the parse prompt consumes. Premix is
// deterministic and is exercised through the real importer.

import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import {
  groundPremix,
  parsePremixWorkbook,
  premixId,
  premixToMix,
  type PremixKnown,
} from "@workspace/premix-import";
import { normalizeMix, type Mix } from "@workspace/mixes";
import { buildMixExportGrids, buildSpecExportGrids, type SheetGrid, type SpecExportInput } from "./index";

const ALL = { profiles: true, dough: true, sauce: true, cheese: true } as const;

function xlsxRoundTrip(grids: readonly SheetGrid[]): SheetGrid[] {
  const wb = XLSX.utils.book_new();
  for (const grid of grids) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(grid.rows), grid.name);
  }
  const bytes = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Uint8Array;
  const read = XLSX.read(bytes, { type: "buffer" });
  return read.SheetNames.flatMap((name) => {
    const sheet = read.Sheets[name];
    if (!sheet) return [];
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      defval: "",
      blankrows: false,
    });
    return [{
      name,
      rows: rows.map((row) =>
        Array.isArray(row) ? row.map((cell) => (cell == null ? "" : String(cell))) : [],
      ),
    }];
  });
}

/**
 * XLSX drops blank spacer rows and pads rows with empty cells. Those are
 * formatting, not meaning. Empty ingredient cells are also ignored by the
 * exporter, while a numeric zero is intentional and must remain.
 */
function semanticGrid(grid: SheetGrid) {
  return {
    name: grid.name,
    rows: grid.rows
      .map((row) => row.map((cell) => String(cell ?? "").trim()))
      .map((row) => {
        let end = row.length;
        while (end > 0 && row[end - 1] === "") end--;
        return row.slice(0, end);
      })
      .filter((row) => row.length > 0),
  };
}

function semanticWorkbook(grids: readonly SheetGrid[]) {
  return grids.map(semanticGrid);
}

function mkMix(raw: Omit<Mix, "id" | "amountAlreadyMade" | "enabled">): Mix {
  const mix = normalizeMix({
    ...raw,
    id: premixId(raw),
    amountAlreadyMade: 0,
    enabled: true,
  });
  if (!mix) throw new Error(`invalid round-trip fixture: ${raw.name}`);
  return mix;
}

const largeFlavors = Array.from({ length: 14 }, (_, i) => `Seasonal Flavor ${i + 1}`);

const corpusInput: SpecExportInput = {
  profiles: [
    ...largeFlavors.map((flavor, i) => ({
      brand: "Northstar Foods",
      flavor,
      dieType: i % 2 === 0 ? '12"' : '14"',
      sauceOzPerPizza: i % 2 === 0 ? 3.125 : 4.75,
      applicators: [
        { type: "Mozzarella", ozPerPizza: 4.25 },
        ...(i === 0 ? [{ type: "Finishing Herb", ozPerPizza: 0.0625 }] : []),
      ],
      pepperonis: i === 1 ? [{ type: "Cup Pepperoni", sticks: 2, ozPerPizza: 1.375 }] : [],
      doughRecipeName: i % 2 === 0 ? "Northstar Standard Dough" : "Northstar Thin Dough",
      targetDoughballWeight: i % 2 === 0 ? 19.5 : 11.25,
      doughballsPerTray: i % 2 === 0 ? 24 : 36,
      sauceRecipeName: "Northstar House Sauce",
      cheeseRecipeNames: i % 3 === 0 ? ["Northstar Cheese", undefined, "Northstar Cheese"] : ["Northstar Cheese"],
    })),
    // An intentionally empty optional slot is different from the populated
    // slots above and must not create an empty output row or column.
    {
      brand: "Northstar Foods",
      flavor: "Plain",
      dieType: "",
      sauceOzPerPizza: undefined,
      applicators: [],
      pepperonis: [],
      doughRecipeName: "Northstar Standard Dough",
      targetDoughballWeight: 19.5,
      doughballsPerTray: 24,
      sauceRecipeName: "Northstar House Sauce",
      cheeseRecipeNames: [undefined, undefined, undefined, undefined],
    },
  ],
  doughRecipes: [
    {
      name: "Northstar Standard Dough",
      rows: [
        { ingredient: "Flour", lbs: 500 },
        { ingredient: "Water", lbs: 300.5 },
        { ingredient: "Yeast", lbs: 5 },
        { ingredient: "Salt", lbs: 0 }, // intentional zero, not a removed row
      ],
    },
    {
      name: "Northstar Thin Dough",
      rows: [
        { ingredient: "Flour", lbs: 450 },
        { ingredient: "Water", lbs: 240 },
        { ingredient: "Yeast", lbs: 3.5 },
        { ingredient: "Conditioner", lbs: 2.25 },
      ],
    },
  ],
  sauceRecipes: [{
    name: "Northstar House Sauce",
    rows: [
      { ingredient: "Tomato Paste", lbs: 120 },
      { ingredient: "Water", lbs: 80 },
      { ingredient: "Spice Blend", lbs: 6.5 },
    ],
  }],
  cheeseRecipes: [{
    name: "Northstar Cheese",
    rows: [
      { ingredient: "Mozzarella", lbs: 400 },
      { ingredient: "Provolone", lbs: 100 },
      { ingredient: "Diced Pepperoni", lbs: 0 }, // intentional zero survives
    ],
  }],
};

const known: PremixKnown = {
  brands: ["Northstar Foods", "Old Northstar"],
  flavorsByBrand: { "Northstar Foods": ["Plain", "Seasonal Flavor 1", "Seasonal Flavor 2"] },
  ingredients: ["Onions", "Peppers", "Seasoning", "Removed Ingredient"],
};

const mixes = [
  mkMix({
    name: "House Veggie Mix",
    brand: "Northstar Foods",
    flavor: "Plain",
    batchSize: 62.5,
    daysEarly: 2,
    notes: "Pull 2 Days Early",
    components: [
      { ingredient: "Onions", perPizza: 0.35 },
      { ingredient: "Peppers", perPizza: 0.125 },
      { ingredient: "Seasoning", perPizza: 0 }, // explicit zero is meaningful
    ],
  }),
  mkMix({
    name: "Legacy Topping Mix",
    brand: "Old Northstar",
    flavor: "Seasonal Flavor 1",
    batchSize: 0, // pounds-only / no batch total
    daysEarly: 0,
    components: [{ ingredient: "Onions", perPizza: 0.5 }],
  }),
];

describe("import/export corpus semantic round trips", () => {
  it("keeps spec profiles, dough variants, sauces, cheese, quantities, zeros, and wrapped targets", () => {
    const exported = buildSpecExportGrids(corpusInput, ALL);
    const recovered = xlsxRoundTrip(exported);

    expect(semanticWorkbook(recovered)).toEqual(semanticWorkbook(exported));
    expect(recovered.map((grid) => grid.name)).toEqual([
      "Profiles",
      "Dough Recipes",
      "Sauce Recipes",
      "Cheese Recipes",
    ]);

    const profileRows = recovered.find((grid) => grid.name === "Profiles")!.rows;
    expect(profileRows).toHaveLength(corpusInput.profiles.length + 1);
    expect(profileRows.some((row) => row.includes("3.125"))).toBe(true);
    expect(profileRows.some((row) => row.includes("1.375"))).toBe(true);

    const doughRows = recovered.find((grid) => grid.name === "Dough Recipes")!.rows;
    expect(doughRows.flat()).toContain("Target Doughball Weight (oz)");
    expect(doughRows.flat()).toContain("Doughballs Per Tray");
    expect(doughRows.flat()).toContain("0");
    expect(doughRows.filter((row) => row[0]?.startsWith("Northstar Foods:")).length).toBeGreaterThan(1);
  });

  it("keeps empty, intentional, and removed rows distinguishable", () => {
    const exported = buildSpecExportGrids(corpusInput, ALL);
    const dough = exported.find((grid) => grid.name === "Dough Recipes")!;
    const standard = dough.rows.find((row) => row[0] === "Recipe: Northstar Standard Dough");
    expect(standard).toBeDefined();
    expect(dough.rows).toContainEqual(["Salt", "0"]);
    expect(dough.rows).not.toContainEqual(["", ""]);
    expect(dough.rows).not.toContainEqual(["Removed Ingredient", ""]);

    const removed = dough.rows.filter((row) => row[0] !== "Water");
    expect(semanticGrid({ name: dough.name, rows: removed }).rows).not.toEqual(semanticGrid(dough).rows);
  });

  it("survives multi-pass exports without changing each selected semantic document", () => {
    const passes = [
      { profiles: true, dough: true, sauce: false, cheese: false },
      { profiles: false, dough: false, sauce: true, cheese: true },
      ALL,
    ] as const;
    for (const selection of passes) {
      const exported = buildSpecExportGrids(corpusInput, selection);
      expect(semanticWorkbook(xlsxRoundTrip(exported))).toEqual(semanticWorkbook(exported));
    }
  });

  it("re-imports premix corpus data with aliases, notes, quantities, zeros, and no phantom rows", () => {
    const exported = buildMixExportGrids(mixes);
    const recovered = xlsxRoundTrip(exported);
    const parsed = parsePremixWorkbook(recovered);
    const aliases = [{
    kind: "brand" as const,
      externalName: "Old Northstar",
      canonicalName: "Northstar Foods",
      context: null,
    }];
    const grounded = parsed.map((item) => groundPremix(item, known, aliases));
    const imported = grounded.map((item) => premixToMix(item.mix)).filter((mix): mix is Mix => mix !== null);

    expect(grounded.every((item) => item.productResolved)).toBe(true);
    expect(imported.map((mix) => ({
      name: mix.name,
      brand: mix.brand,
      flavor: mix.flavor,
      batchSize: mix.batchSize,
      daysEarly: mix.daysEarly,
      notes: mix.notes,
      components: mix.components,
    }))).toEqual([
      {
        name: "House Veggie Mix",
        brand: "Northstar Foods",
        flavor: "Plain",
        batchSize: 62.5,
        daysEarly: 2,
        notes: "Pull 2 Days Early",
        components: [
          { ingredient: "Onions", perPizza: 0.35 },
          { ingredient: "Peppers", perPizza: 0.125 },
          { ingredient: "Seasoning", perPizza: 0 },
        ],
      },
      {
        name: "Legacy Topping Mix",
        brand: "Northstar Foods",
        flavor: "Seasonal Flavor 1",
        batchSize: 0,
        daysEarly: 0,
        notes: undefined,
        components: [{ ingredient: "Onions", perPizza: 0.5 }],
      },
    ]);
  });
});