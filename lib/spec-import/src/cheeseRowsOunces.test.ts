import { describe, it, expect } from "vitest";
import { mergeParsedSpecImports, sanitizeParsedSpecImport } from "./index";

// Recipe rows preserve the source workbook's raw number in the shared `lbs`
// field. `rowsUnit` is descriptive provenance for the AI response only; it
// must never trigger an implicit oz↔lb conversion.
describe("sanitizeParsedSpecImport recipe row raw units", () => {
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

  it("keeps cheese, dough, and sauce row numbers verbatim", () => {
    const parsed = sanitizeParsedSpecImport(raw);
    const byName = new Map(parsed.recipes.map((r) => [r.name, r]));
    expect(byName.get("White Fajita Mix")?.rows).toEqual([
      { ingredient: "White Cheddar", lbs: 1.5 },
      { ingredient: "Fajita Seasoning", lbs: 0.5 },
    ]);
    expect(byName.get("CRB Dough")?.rows).toEqual([
      { ingredient: "Flour", lbs: 32 },
    ]);
    expect(byName.get("Lucia Pizza Sauce")?.rows).toEqual([
      { ingredient: "Tomato Paste", lbs: 16 },
    ]);
  });

  it("does not convert rows when the source explicitly reports either unit", () => {
    const parsed = sanitizeParsedSpecImport({
      profiles: [],
      recipes: [
        {
          kind: "dough",
          name: "Ounce-Labeled Dough",
          rowsUnit: "oz",
          rows: [{ ingredient: "Flour", lbs: 3.25 }],
        },
        {
          kind: "sauce",
          name: "Pound-Labeled Sauce",
          rowsUnit: "lbs",
          rows: [{ ingredient: "Tomato Paste", lbs: 18.5 }],
        },
      ],
    });
    expect(parsed.recipes[0]?.rows).toEqual([{ ingredient: "Flour", lbs: 3.25 }]);
    expect(parsed.recipes[1]?.rows).toEqual([{ ingredient: "Tomato Paste", lbs: 18.5 }]);
  });

  it("preserves raw dough and sauce values after per-chunk sanitizing and merging", () => {
    const chunks = [
      sanitizeParsedSpecImport({
        profiles: [],
        recipes: [
          {
            kind: "dough",
            name: "Chunked Dough A",
            rowsUnit: "oz",
            rows: [{ ingredient: "Flour", lbs: 48 }],
          },
        ],
      }),
      sanitizeParsedSpecImport({
        profiles: [],
        recipes: [
          {
            kind: "sauce",
            name: "Chunked Sauce B",
            rowsUnit: "oz",
            rows: [{ ingredient: "Tomato Paste", lbs: 24 }],
          },
        ],
      }),
    ];
    const merged = mergeParsedSpecImports(chunks);
    expect(merged.recipes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "dough",
          name: "Chunked Dough A",
          rows: [{ ingredient: "Flour", lbs: 48 }],
        }),
        expect.objectContaining({
          kind: "sauce",
          name: "Chunked Sauce B",
          rows: [{ ingredient: "Tomato Paste", lbs: 24 }],
        }),
      ]),
    );
  });
});
