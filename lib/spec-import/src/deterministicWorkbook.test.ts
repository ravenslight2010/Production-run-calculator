import { describe, expect, it } from "vitest";
import {
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
  });

  it("parses recipe blocks and retains unsupported rows for review", () => {
    const grids: SheetGrid[] = [{
      name: "Dough Recipes",
      rows: [
        ["Recipe: House Dough"],
        ["Aldo Foods: Classic, Thin"],
        ["Target Doughball Weight (oz)", "8.25"],
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
        { brand: "Aldo Foods", flavor: "Classic" },
        { brand: "Aldo Foods", flavor: "Thin" },
      ],
      rows: [
        { ingredient: "Flour", lbs: 10 },
        { ingredient: "Water", lbs: 6.5 },
      ],
    })]);
    expect(result.unresolved).toEqual([expect.objectContaining({
      source: "Dough Recipes",
      reason: "Row is outside a supported Recipe: block.",
    })]);
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