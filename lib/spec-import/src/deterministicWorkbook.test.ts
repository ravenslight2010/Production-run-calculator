import { describe, expect, it } from "vitest";
import {
  canonicalizeSpecImportNamedRecipeNames,
  mergeParsedSpecImports,
  parseDeterministicSpecWorkbook,
  type SheetGrid,
} from "./index";

describe("parseDeterministicSpecWorkbook", () => {
  it("parses the exported profile layout without a model", () => {
    const grids: SheetGrid[] = [{
      name: "Profiles",
      rows: [
        [
          "Brand",
          "Flavor",
          "Die Type",
          "Sauce oz/pizza",
          "Dough Recipe",
          "Sauce Recipe",
          "Applicator 1 Type",
          "Applicator 1 oz/pizza",
          "Applicator 1 Recipe",
          "Pepperoni 1 Type",
          "Pepperoni 1 Sticks",
          "Pepperoni 1 oz/pizza",
        ],
        ["Aldo Foods", "Classic", "12 inch", "0.5", "House Dough", "Marinara", "Cheese", "0.75", "House Cheese", "Natural", "4", "0.25"],
      ],
    }];

    const result = parseDeterministicSpecWorkbook(grids);

    expect(result.supported).toBe(true);
    expect(result.unresolved).toHaveLength(0);
    expect(result.parsed.profiles).toEqual([expect.objectContaining({
      brand: "Aldo Foods",
      flavor: "Classic",
      dieType: "12 inch",
      doughName: "House Dough",
      sauceName: "Marinara",
      applicators: [expect.objectContaining({ type: "Cheese", ozPerPizza: 0.75, slot: 1 })],
      pepperonis: [expect.objectContaining({ type: "Natural", sticks: 4, ozPerPizza: 0.25 })],
    })]);
    expect(result.parsed.profiles[0].sourceLocations).toMatchObject({
      brand: [{ sheet: "Profiles", cell: "A2" }],
      flavor: [{ sheet: "Profiles", cell: "B2" }],
      dieType: [{ sheet: "Profiles", cell: "C2" }],
      sauceOzPerPizza: [{ sheet: "Profiles", cell: "D2" }],
      doughName: [{ sheet: "Profiles", cell: "E2" }],
      sauceName: [{ sheet: "Profiles", cell: "F2" }],
    });
    expect(result.parsed.profiles[0].applicators[0].sourceLocations).toEqual({
      type: [{ sheet: "Profiles", cell: "G2" }],
      ozPerPizza: [{ sheet: "Profiles", cell: "H2" }],
      recipeName: [{ sheet: "Profiles", cell: "I2" }],
    });
    expect(result.parsed.profiles[0].pepperonis[0].sourceLocations).toEqual({
      type: [{ sheet: "Profiles", cell: "J2" }],
      sticks: [{ sheet: "Profiles", cell: "K2" }],
      ozPerPizza: [{ sheet: "Profiles", cell: "L2" }],
    });
  });

  it("attaches locations to deterministic profile doughball and tray values", () => {
    const result = parseDeterministicSpecWorkbook([{
      name: "Profiles",
      rows: [
        ["Brand", "Flavor", "Target Doughball Weight (oz)", "Doughballs Per Tray"],
        ["Aldo Foods", "Classic", "8.25", "24"],
      ],
    }]);

    expect(result.parsed.profiles[0]).toMatchObject({
      targetDoughballWeight: 8.25,
      doughballsPerTray: 24,
      sourceLocations: {
        targetDoughballWeight: [{ sheet: "Profiles", cell: "C2" }],
        doughballsPerTray: [{ sheet: "Profiles", cell: "D2" }],
      },
    });
  });

  it("parses recipe blocks and retains unsupported rows for review", () => {
    const grids: SheetGrid[] = [{
      name: "Dough Recipes",
      rows: [
        ["Recipe: House Dough"],
        ["Aldo Foods: Classic, Thin"],
        ["Target Doughball Weight (oz)", "8.25"],
        ["Doughballs Per Tray", "24"],
        ["Ingredient", "Lbs"],
        ["Flour", "10"],
        ["Water", "6.5"],
        [],
        ["Unsupported note", "manager should review"],
      ],
    }];

    const result = parseDeterministicSpecWorkbook(grids);

    expect(result.parsed.recipes).toEqual([expect.objectContaining({
      kind: "dough",
      name: "House Dough",
      doughballOz: 8.25,
      targets: [
        expect.objectContaining({ brand: "Aldo Foods", flavor: "Classic" }),
        expect.objectContaining({ brand: "Aldo Foods", flavor: "Thin" }),
      ],
      rows: [
        expect.objectContaining({ ingredient: "Flour", lbs: 10 }),
        expect.objectContaining({ ingredient: "Water", lbs: 6.5 }),
      ],
    })]);
    const recipe = result.parsed.recipes[0];
    expect(recipe.sourceLocations).toMatchObject({
      name: [{ sheet: "Dough Recipes", cell: "A1" }],
      targets: [{ sheet: "Dough Recipes", cell: "A2" }],
      doughballOz: [{ sheet: "Dough Recipes", cell: "B3" }],
      doughballsPerTray: [{ sheet: "Dough Recipes", cell: "B4" }],
      rowsUnit: [{ sheet: "Dough Recipes", cell: "B5" }],
    });
    expect(recipe.rows.map((row) => row.sourceLocations)).toEqual([
      [
        { sheet: "Dough Recipes", cell: "A6" },
        { sheet: "Dough Recipes", cell: "B6" },
      ],
      [
        { sheet: "Dough Recipes", cell: "A7" },
        { sheet: "Dough Recipes", cell: "B7" },
      ],
    ]);
    expect(canonicalizeSpecImportNamedRecipeNames(result.parsed).recipes[0].sourceLocations)
      .toEqual(recipe.sourceLocations);
    expect(result.unresolved).toEqual([expect.objectContaining({
      source: "Dough Recipes",
      reason: "Row is outside a supported Recipe: block.",
    })]);
  });

  it("uses actual worksheet row numbers when blank rows precede parsed values", () => {
    const result = parseDeterministicSpecWorkbook([{
      name: "Profiles",
      rows: [
        [],
        ["Brand", "Flavor", "Die Type"],
        [],
        ["Aldo Foods", "Classic", "12 inch"],
      ],
    }]);

    expect(result.parsed.profiles[0].sourceLocations).toMatchObject({
      brand: [{ sheet: "Profiles", cell: "A4" }],
      flavor: [{ sheet: "Profiles", cell: "B4" }],
      dieType: [{ sheet: "Profiles", cell: "C4" }],
    });
  });

  it("unions source locations for duplicate values when chunks merge", () => {
    const first = parseDeterministicSpecWorkbook([{
      name: "Chunk A",
      rows: [
        ["Brand", "Flavor", "Applicator 1 Type", "Applicator 1 oz/pizza"],
        ["Aldo Foods", "Classic", "Cheese", "0.75"],
      ],
    }]).parsed;
    const second = parseDeterministicSpecWorkbook([{
      name: "Chunk B",
      rows: [
        ["Brand", "Flavor", "Applicator 1 Type", "Applicator 1 oz/pizza"],
        ["Aldo Foods", "Classic", "Cheese", "0.75"],
      ],
    }]).parsed;

    const merged = mergeParsedSpecImports([first, second], { profileSlots: "union" });

    expect(merged.profiles[0].applicators).toHaveLength(1);
    expect(merged.profiles[0].applicators[0]).toMatchObject({
      type: "Cheese",
      ozPerPizza: 0.75,
      sourceLocations: {
        type: [
          { sheet: "Chunk A", cell: "C2" },
          { sheet: "Chunk B", cell: "C2" },
        ],
        ozPerPizza: [
          { sheet: "Chunk A", cell: "D2" },
          { sheet: "Chunk B", cell: "D2" },
        ],
      },
    });
    expect(merged.profiles[0].sourceLocations?.brand).toEqual([
      { sheet: "Chunk A", cell: "A2" },
      { sheet: "Chunk B", cell: "A2" },
    ]);
  });

  it("keeps the selected recipe rows' cells when duplicate recipes merge", () => {
    const parseRecipe = (sheet: string, ingredient: string, amount: string) =>
      parseDeterministicSpecWorkbook([{
        name: sheet,
        rows: [
          ["Recipe: House Dough"],
          ["Ingredient", "Lbs"],
          [ingredient, amount],
        ],
      }]).parsed;

    const merged = mergeParsedSpecImports([
      parseRecipe("Dough Recipes Earlier", "Flour", "10"),
      parseRecipe("Dough Recipes Later", "Water", "6"),
    ]);

    expect(merged.recipes[0].rows).toEqual([{
      ingredient: "Water",
      lbs: 6,
      sourceLocations: [
        { sheet: "Dough Recipes Later", cell: "A3" },
        { sheet: "Dough Recipes Later", cell: "B3" },
      ],
    }]);
    expect(merged.recipes[0].sourceLocations?.name).toEqual([
      { sheet: "Dough Recipes Earlier", cell: "A1" },
      { sheet: "Dough Recipes Later", cell: "A1" },
    ]);
  });

  it("fails closed for an unsupported workbook", () => {
    const result = parseDeterministicSpecWorkbook([{
      name: "Free form",
      rows: [["some handwritten note", "maybe 12"], ["another row"]],
    }]);

    expect(result.supported).toBe(false);
    expect(result.parsed.profiles).toHaveLength(0);
    expect(result.parsed.recipes).toHaveLength(0);
    expect(result.unresolved[0]).toEqual(expect.objectContaining({
      source: "Free form",
      reason: "Workbook layout is not one of the supported deterministic layouts.",
    }));
  });
});