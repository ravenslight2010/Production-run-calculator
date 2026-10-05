import { describe, expect, it } from "vitest";
import {
  buildProfileBrandGrounding,
  buildProfileFlavorGrounding,
  groundProfileBrand,
  groundProfileFlavor,
  limitSpecImportWarnings,
  mergeParsedSpecImports,
  sanitizeParsedSpecImport,
  specImportOmittedWarningCount,
  type SpecImportWarning,
} from "./index";
import { reviewSpecImportPerPizzaAmounts } from "./perPizzaReview";

describe("reviewed import defects", () => {
  it.each([
    { brand: "Example", flavor: "" },
    { brand: "", flavor: "Supreme" },
    { brand: "", flavor: "" },
  ])("flags an incomplete profile without allowing it into writes: %j", (profile) => {
    const result = sanitizeParsedSpecImport({ profiles: [profile], recipes: [] });
    expect(result.profiles).toEqual([]);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings?.[0].message).toMatch(/missing .*will not be saved/);
  });

  it.each([
    { field: "sauceName", name: "Hot Buffalo", source: "Buffalo Chicken" },
    { field: "doughName", name: "Thin Supreme Dough", source: "Supreme" },
  ])("does not snap $field to an unrelated flavor cell", ({ field, name, source }) => {
    const result = sanitizeParsedSpecImport({
      profiles: [{ brand: "Example", flavor: source, [field]: name }], recipes: [],
    }, undefined, { sourceText: `Example\t${source}`, knownBrands: ["Example"], knownFlavors: [source] });
    expect(result.profiles[0][field as "sauceName" | "doughName"]).toBe(name);
    expect(result.warnings?.some((w) => /was not found on the sheet/.test(w.message))).toBe(true);
  });

  it.each(["Flavor", "Flavor:", "Flavor Name", "Recipe", "Brand", "Brand Name", "Target Weight", "Ingredient:"])(
    "does not use header %s as a brand/flavor fuzzy candidate", (header) => {
      const flavor = `${header.replace(":", "")} Supreme`;
      const flavorCtx = buildProfileFlavorGrounding({ sourceText: header })!;
      const brandCtx = buildProfileBrandGrounding({ sourceText: header })!;
      expect(groundProfileFlavor(flavor, flavorCtx).kind).toBe("ungrounded");
      expect(groundProfileBrand(flavor, brandCtx).kind).toBe("ungrounded");
    },
  );

  it.each([
    { field: "sauceName", name: "Sweet Sassy" },
    { field: "doughName", name: "Traditional" },
    { field: "sauceName", name: "Recipe: Special" },
  ])("preserves exact-source names without requiring a kind keyword: $name", ({ field, name }) => {
    const result = sanitizeParsedSpecImport({
      profiles: [{ brand: "Example", flavor: "Supreme", [field]: name }], recipes: [],
    }, undefined, { sourceText: `Example\tSupreme\t${name}` });
    expect(result.profiles[0][field as "sauceName" | "doughName"]).toBe(name);
    expect(result.warnings).toBeUndefined();
  });

  it("keeps known names even when absent from the source or resembling a label", () => {
    const result = sanitizeParsedSpecImport({
      profiles: [{ brand: "Brand", flavor: "Flavor", sauceName: "Sweet Sassy", doughName: "Traditional" }],
      recipes: [],
    }, undefined, {
      sourceText: "unrelated", knownBrands: ["Brand"], knownFlavors: ["Flavor"],
      knownSauceNames: ["Sweet Sassy"], knownRecipeNames: { dough: ["Traditional"] },
    });
    expect(result.profiles[0]).toMatchObject({
      brand: "Brand", flavor: "Flavor", sauceName: "Sweet Sassy", doughName: "Traditional",
    });
    expect(result.warnings).toBeUndefined();
  });

  it("still snaps a paraphrased sauce onto a sauce-named source cell", () => {
    const result = sanitizeParsedSpecImport({
      profiles: [{ brand: "Example", flavor: "Supreme", sauceName: "Buffalo Wing Sauce" }], recipes: [],
    }, undefined, { sourceText: "Example\tSupreme\tHot Buffalo Sauce" });
    expect(result.profiles[0].sauceName).toBe("Hot Buffalo Sauce");
  });

  it("keeps an ambiguous sauce name for review rather than choosing a tied candidate", () => {
    const result = sanitizeParsedSpecImport({
      profiles: [{ brand: "Example", flavor: "Supreme", sauceName: "Buffalo Wing Sauce" }], recipes: [],
    }, undefined, { sourceText: "Example\tSupreme\tHot Buffalo Sauce\tBuffalo Ranch Sauce" });
    expect(result.profiles[0].sauceName).toBe("Buffalo Wing Sauce");
    expect(result.warnings?.[0].message).toMatch(/was not found on the sheet/);
  });

  it("retains extreme native ounces while flagging them for advisory review", () => {
    const result = sanitizeParsedSpecImport({
      profiles: [{ brand: "Example", flavor: "Supreme", sauceOzPerPizza: 1e6,
        applicators: [{ type: "Mozzarella", ozPerPizza: 1e6 }] }], recipes: [],
    });
    expect(result.profiles[0].sauceOzPerPizza).toBe(1e6);
    expect(result.profiles[0].applicators?.[0].ozPerPizza).toBe(1e6);
    expect(reviewSpecImportPerPizzaAmounts(result.profiles[0])).toHaveLength(2);
  });
});

const warning = (index: number): SpecImportWarning => ({
  brand: "Example", flavor: `Flavor ${index}`, message: `Review ${index}`,
});
const count = (warnings: SpecImportWarning[]) =>
  warnings.reduce((sum, w) => sum + (specImportOmittedWarningCount(w) || 1), 0);

describe("bounded warnings with visible counts", () => {
  it("flags all 30 incomplete rows, with a summary inside the sanitizer limit", () => {
    const result = sanitizeParsedSpecImport({
      profiles: Array.from({ length: 30 }, (_, i) => ({ brand: `Brand ${i}`, flavor: "" })),
      recipes: [],
    });
    expect(result.warnings).toHaveLength(10);
    expect(count(result.warnings!)).toBe(30);
    expect(specImportOmittedWarningCount(result.warnings!.at(-1)!)).toBe(21);
  });

  it("does not summarize or count repeated visible warnings twice", () => {
    expect(limitSpecImportWarnings([warning(1), warning(1)], 10)).toEqual([warning(1)]);
  });

  it("carries both source overflow counts through merging and another saved-review merge", () => {
    const sources = [0, 100].map((offset) => ({
      profiles: [], recipes: [],
      warnings: limitSpecImportWarnings(Array.from({ length: 30 }, (_, i) => warning(i + offset)), 10),
    }));
    const result = mergeParsedSpecImports(sources);
    expect(result.warnings).toHaveLength(19); // 18 details plus 42 omitted occurrences
    expect(count(result.warnings!)).toBe(60);
    const restored = JSON.parse(JSON.stringify(result));
    const merged = mergeParsedSpecImports([
      restored, { profiles: [], recipes: [], warnings: Array.from({ length: 20 }, (_, i) => warning(i + 200)) },
    ]);
    expect(merged.warnings).toHaveLength(30);
    expect(count(merged.warnings!)).toBe(80);
  });

  it("summarizes a merge-only overflow", () => {
    const result = mergeParsedSpecImports([{
      profiles: [], recipes: [], warnings: Array.from({ length: 40 }, (_, i) => warning(i)),
    }]);
    expect(result.warnings).toHaveLength(30);
    expect(specImportOmittedWarningCount(result.warnings!.at(-1)!)).toBe(11);
    expect(count(result.warnings!)).toBe(40);
  });
});