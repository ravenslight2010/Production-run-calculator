import { describe, expect, it } from "vitest";
import {
  backfillCheeseRecipeFromMergedSources,
  type CheeseRecipe,
} from "./index";

function recipe(over: Partial<CheeseRecipe>): CheeseRecipe {
  return {
    id: over.id ?? (over.name ?? "r").toLowerCase(),
    name: "R",
    brand: "",
    flavors: [],
    shredderSetting: "",
    cellulose: "",
    notes: "",
    components: [],
    enabled: true,
    ...over,
  };
}

describe("backfillCheeseRecipeFromMergedSources", () => {
  it("fills a spec-import stub target from the real source (SMD scenario)", () => {
    const target = recipe({
      name: "SMD Pep Cheese Mix",
      brand: "SMD",
      components: [
        { ingredient: "Part Skim Mozzarella", lbs: 0 },
        { ingredient: "Provolone", lbs: 0 },
        { ingredient: "Diced Pepperoni", lbs: 0 },
        { ingredient: "Cow's Romano", lbs: 0 },
      ],
    });
    const source = recipe({
      name: "SMD Pepperoni Cheese Mix",
      brand: "Show Me Dough",
      shredderSetting: "#1",
      cellulose: "0.83",
      components: [
        { ingredient: "Part Skim Mozzarella", lbs: 20 },
        { ingredient: "Provolone", lbs: 8 },
        { ingredient: "Pepperoni, Diced", lbs: 8 },
        { ingredient: "Cows Romano", lbs: 2.5 },
        { ingredient: "Cellulose", lbs: 0.3 },
      ],
    });
    const out = backfillCheeseRecipeFromMergedSources(target, [source]);
    expect(out).not.toBeNull();
    // Target's own row naming is kept; lbs are filled by loose ingredient match.
    expect(out!.components).toEqual([
      { ingredient: "Part Skim Mozzarella", lbs: 20 },
      { ingredient: "Provolone", lbs: 8 },
      { ingredient: "Diced Pepperoni", lbs: 8 },
      { ingredient: "Cow's Romano", lbs: 2.5 },
      { ingredient: "Cellulose", lbs: 0.3 },
    ]);
    expect(out!.components.reduce((s, c) => s + c.lbs, 0)).toBeCloseTo(38.8);
    expect(out!.shredderSetting).toBe("#1");
    expect(out!.cellulose).toBe("0.83");
    // Target already has a brand — never overwritten.
    expect(out!.brand).toBe("SMD");
  });

  it("never clobbers real data on a populated target", () => {
    const target = recipe({
      name: "Blend",
      brand: "A",
      shredderSetting: "3",
      cellulose: "1.0",
      notes: "keep",
      components: [{ ingredient: "Mozzarella", lbs: 15, sharePct: 60 }],
    });
    const source = recipe({
      name: "Old Blend",
      brand: "B",
      shredderSetting: "9",
      cellulose: "9.9",
      notes: "drop",
      components: [
        { ingredient: "Mozzarella", lbs: 99, sharePct: 10 },
        { ingredient: "Romano", lbs: 2 },
      ],
    });
    const out = backfillCheeseRecipeFromMergedSources(target, [source]);
    expect(out).not.toBeNull();
    expect(out!.brand).toBe("A");
    expect(out!.shredderSetting).toBe("3");
    expect(out!.cellulose).toBe("1.0");
    expect(out!.notes).toBe("keep");
    // Matched row: existing lbs/sharePct kept (target values win); source only fills blanks.
    expect(out!.components[0]).toEqual({
      ingredient: "Mozzarella",
      lbs: 15,
      sharePct: 60,
    });
    // Source-only row appended.
    expect(out!.components[1]).toEqual({ ingredient: "Romano", lbs: 2 });
  });

  it("folds multiple sources in order (earlier source wins ties)", () => {
    const target = recipe({ name: "T", components: [] });
    const s1 = recipe({
      name: "S1",
      shredderSetting: "#2",
      components: [{ ingredient: "Mozzarella", lbs: 10 }],
    });
    const s2 = recipe({
      name: "S2",
      shredderSetting: "#7",
      components: [
        { ingredient: "Mozzarella", lbs: 99 },
        { ingredient: "Provolone", lbs: 4 },
      ],
    });
    const out = backfillCheeseRecipeFromMergedSources(target, [s1, s2]);
    expect(out).not.toBeNull();
    expect(out!.shredderSetting).toBe("#2");
    expect(out!.components).toEqual([
      { ingredient: "Mozzarella", lbs: 10 },
      { ingredient: "Provolone", lbs: 4 },
    ]);
  });

  it("returns null when the source adds nothing", () => {
    const target = recipe({
      name: "T",
      brand: "A",
      shredderSetting: "1",
      cellulose: "0.5",
      notes: "n",
      components: [{ ingredient: "Mozzarella", lbs: 5, sharePct: 100 }],
    });
    const source = recipe({
      name: "S",
      components: [{ ingredient: "Mozzarella", lbs: 3 }],
    });
    expect(backfillCheeseRecipeFromMergedSources(target, [source])).toBeNull();
  });

  it("keeps a branded target's empty flavors list (All Varieties) untouched", () => {
    const target = recipe({ name: "T", brand: "A", flavors: [] });
    const source = recipe({
      name: "S",
      brand: "B",
      flavors: ["Pepperoni"],
      components: [{ ingredient: "Mozzarella", lbs: 1 }],
    });
    const out = backfillCheeseRecipeFromMergedSources(target, [source]);
    expect(out).not.toBeNull();
    expect(out!.brand).toBe("A");
    expect(out!.flavors).toEqual([]);
  });
});
