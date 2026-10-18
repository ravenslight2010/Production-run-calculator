import { describe, expect, it } from "vitest";
import {
  sanitizeParsedSpecImport,
  type ParsedProfile,
} from "./index";
import {
  reviewSpecImportPerPizzaAmounts,
  SPEC_IMPORT_PER_PIZZA_ADVISORY_LIMITS,
} from "./perPizzaReview";

const profile = (value: number): ParsedProfile => ({
  brand: "Example",
  flavor: "Supreme",
  sauceOzPerPizza: value,
  applicators: [{ type: "Cheese", ozPerPizza: value, slot: 4, batchLbs: 1e6 }],
  pepperonis: [{ type: "Natural", ozPerPizza: value, sticks: 1e6, batchLbs: 1e6 }],
  targetDoughballWeight: 1e6,
  sauceBarrelLbs: 1e6,
});

describe("per-pizza advisory review", () => {
  it("pins the manager-approved field-specific limits", () => {
    expect(SPEC_IMPORT_PER_PIZZA_ADVISORY_LIMITS).toEqual({
      sauce: 16, applicator: 16, pepperoni: 16,
    });
  });

  it.each([0, 0.25, 4, 9, 15.999, 16])("does not warn for normal/boundary value %s", (value) => {
    expect(reviewSpecImportPerPizzaAmounts(profile(value))).toEqual([]);
  });

  it.each([16.000001, 17, 1e6, Number.MAX_VALUE])("flags each extreme field independently at %s", (value) => {
    const input = profile(value);
    const before = JSON.parse(JSON.stringify(input));
    Object.freeze(input);
    const warnings = reviewSpecImportPerPizzaAmounts(input);
    expect(warnings).toHaveLength(3);
    expect(warnings[0]).toContain(`Sauce: ${value} oz per pizza`);
    expect(warnings[1]).toContain(`Applicator 4 (Cheese): ${value} oz per pizza`);
    expect(warnings[2]).toContain(`Pepperoni entry 1 (Natural): ${value} oz per pizza`);
    expect(warnings.every((w) => w.includes("16 oz per pizza advisory limit"))).toBe(true);
    expect(input).toEqual(before);
  });

  it("supports absent legacy fields without guessing units or quantities", () => {
    expect(reviewSpecImportPerPizzaAmounts({ brand: "Example", flavor: "Supreme" } as ParsedProfile)).toEqual([]);
  });

  it.each([NaN, Infinity, -Infinity])("leaves nonfinite validity handling to the existing sanitizer: %s", (value) => {
    expect(reviewSpecImportPerPizzaAmounts(profile(value))).toEqual([]);
  });

  it("does not sum stations or skip unnamed stations, and distinguishes repeated pepperonis", () => {
    const input = profile(0);
    input.applicators = [
      { type: "Cheese", ozPerPizza: 10 },
      { type: "Cheese", ozPerPizza: 10 },
      { type: "", ozPerPizza: 17 },
    ];
    input.pepperonis = [
      { type: "Natural", ozPerPizza: 18, sticks: 2 },
      { type: "Natural", ozPerPizza: 19, sticks: 2 },
    ];
    expect(reviewSpecImportPerPizzaAmounts(input)).toEqual([
      expect.stringContaining("Applicator 3: 17 oz"),
      expect.stringContaining("Pepperoni entry 1 (Natural): 18 oz"),
      expect.stringContaining("Pepperoni entry 2 (Natural): 19 oz"),
    ]);
  });

  it("preserves extreme sanitized native values and recipe unit provenance", () => {
    const parsed = sanitizeParsedSpecImport({
      profiles: [profile(1e6)],
      recipes: [{ kind: "sauce", name: "Example Sauce", rowsUnit: "oz",
        rows: [{ ingredient: "Tomato", lbs: 123.456 }] }],
    });
    const before = JSON.parse(JSON.stringify(parsed));
    expect(reviewSpecImportPerPizzaAmounts(parsed.profiles[0])).toHaveLength(3);
    expect(parsed).toEqual(before);
    expect(parsed.profiles[0].sauceOzPerPizza).toBe(1e6);
    expect(parsed.recipes[0].rowsUnit).toBe("oz");
    expect(parsed.recipes[0].rows[0].lbs).toBe(123.456);
  });
});