import { describe, it, expect } from "vitest";
import { sanitizeParsedSpecImport } from "./index";

// Cheese-kind recipe rows carry per-pizza OUNCES verbatim in the lbs field
// (long-standing contract — see SpecCheeseRecipeDraft). The oz→lbs default
// conversion applies to dough/sauce rows only; converting cheese rows ÷16
// corrupted mix/cheese per-pizza amounts (1.5 oz became 0.094).
describe("sanitizeParsedSpecImport recipe row units", () => {
  const raw = {
    profiles: [],
    recipes: [
      {
        kind: "cheese",
        name: "White Fajita Mix",
        rows: [
          { ingredient: "White Cheddar", lbs: 1.5 },
          { ingredient: "Fajita Seasoning", lbs: 0.5 },
        ],
      },
      {
        kind: "dough",
        name: "CRB Dough",
        rows: [{ ingredient: "Flour", lbs: 32 }],
      },
      {
        kind: "sauce",
        name: "Lucia Pizza Sauce",
        rows: [{ ingredient: "Tomato Paste", lbs: 16 }],
      },
    ],
  };

  it("keeps cheese rows verbatim (per-pizza oz), converts dough/sauce oz→lbs", () => {
    const parsed = sanitizeParsedSpecImport(raw);
    const byName = new Map(parsed.recipes.map((r) => [r.name, r]));
    expect(byName.get("White Fajita Mix")?.rows).toEqual([
      { ingredient: "White Cheddar", lbs: 1.5 },
      { ingredient: "Fajita Seasoning", lbs: 0.5 },
    ]);
    expect(byName.get("CRB Dough")?.rows).toEqual([
      { ingredient: "Flour", lbs: 2 },
    ]);
    expect(byName.get("Lucia Pizza Sauce")?.rows).toEqual([
      { ingredient: "Tomato Paste", lbs: 1 },
    ]);
  });

  it("still respects an explicit lbs label for dough/sauce", () => {
    const parsed = sanitizeParsedSpecImport({
      profiles: [],
      recipes: [
        {
          kind: "dough",
          name: "CRB Dough",
          rowsUnit: "lbs",
          rows: [{ ingredient: "Flour", lbs: 32 }],
        },
      ],
    });
    expect(parsed.recipes[0]?.rows).toEqual([{ ingredient: "Flour", lbs: 32 }]);
  });
});
