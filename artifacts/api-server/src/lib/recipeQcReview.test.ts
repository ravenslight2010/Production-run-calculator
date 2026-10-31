import { describe, expect, it } from "vitest";
import { buildRecipeQcCapture, recipeQcResultHash } from "./recipeQcReview";

describe("recipe QC revision evidence", () => {
  it("hashes canonical recipe content and binds the exact family and identity", () => {
    const first = {
      name: "Mix A",
      batchSize: 4,
      components: [{ ingredient: "Salt", lbs: 1 }, { ingredient: "Oil", lbs: 2 }],
      notes: "",
      amountAlreadyMade: 0,
    };
    const reordered = {
      amountAlreadyMade: 900,
      notes: "",
      components: [{ lbs: 1, ingredient: "Salt" }, { lbs: 2, ingredient: "Oil" }],
      batchSize: 4,
      name: "Mix A",
    };
    expect(recipeQcResultHash("mix", "mix-1", first))
      .toBe(recipeQcResultHash("mix", "mix-1", reordered));
    expect(recipeQcResultHash("mix", "mix-1", first))
      .not.toBe(recipeQcResultHash("mix", "mix-2", first));
    expect(recipeQcResultHash("mix", "mix-1", first))
      .not.toBe(recipeQcResultHash("dough", "mix-1", first));
    expect(recipeQcResultHash("mix", "mix-1", first))
      .not.toBe(recipeQcResultHash("mix", "mix-1", { ...first, batchSize: 5 }));
  });

  it("treats omitted database defaults as the same revision as normalized recipe values", () => {
    const sparse = { name: "Dough" };
    const normalized = {
      name: "Dough",
      notes: "",
      components: [],
      enabled: false,
      brand: "",
      flavors: [],
      doughballWeightOz: 0,
      doughballsPerTray: 0,
      doughballVariants: [],
    };
    expect(recipeQcResultHash("dough", "dough-1", sparse))
      .toBe(recipeQcResultHash("dough", "dough-1", normalized));
    expect(buildRecipeQcCapture("dough", "dough-1", sparse, normalized)).toBeNull();
    expect(buildRecipeQcCapture("dough", "dough-1", sparse, {
        name: "Dough",
        notes: "",
        components: [],
        enabled: false,
        brand: "",
        flavors: [],
        doughballWeightOz: 0,
        doughballsPerTray: 0,
        doughballVariants: [],
      })).toBeNull();
  });

  it("creates a bounded, field-specific capture and ignores operational mix stock changes", () => {
    const before = {
      name: "Mix",
      notes: "short",
      components: [],
      batchSize: 2,
      amountAlreadyMade: 0,
    };
    const after = {
      ...before,
      notes: "x".repeat(250),
      amountAlreadyMade: 99,
      components: Array.from({ length: 12 }, (_, index) => ({
        ingredient: `ingredient-${index}`,
        lbs: 1,
        metadata: { detail: "nested" },
      })),
    };
    const capture = buildRecipeQcCapture("mix", "mix-1", before, after);
    expect(capture).not.toBeNull();
    expect(capture?.recordId).toBe("mix:mix-1");
    expect(capture?.payload.changedFields).toEqual(["notes", "components"]);
    const notes = (capture?.payload.after as Record<string, { value: string; truncated: boolean }>).notes;
    expect(notes.value).toHaveLength(121);
    expect(notes.truncated).toBe(true);
    const components = (capture?.payload.after as Record<string, { value: { count: number; sample: unknown[] }; truncated: boolean }>).components;
    expect(components.value.count).toBe(12);
    expect(components.value.sample).toHaveLength(8);
    expect(components.truncated).toBe(true);
    expect(buildRecipeQcCapture("mix", "mix-1", before, { ...before, amountAlreadyMade: 1 }))
      .toBeNull();
  });
});
