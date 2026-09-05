import { describe, expect, it } from "vitest";
import {
  backfillNamedRecipeFromMergedSources,
  type NamedRecipe,
} from "./index";

function rec(over: Partial<NamedRecipe>): NamedRecipe {
  return {
    id: over.id ?? (over.name ?? "r").toLowerCase(),
    name: "R",
    notes: "",
    components: [],
    enabled: true,
    brand: "",
    flavors: [],
    ...over,
  };
}

describe("backfillNamedRecipeFromMergedSources", () => {
  it("fills a stub target's rows, dough numbers and tags from the source", () => {
    const target = rec({
      name: "CRB Dough",
      components: [{ ingredient: "Flour", lbs: 0 }],
    });
    const source = rec({
      name: "CRB Dough Heavy",
      brand: "Lowe's",
      flavors: ["Cheese"],
      notes: "note",
      doughballWeightOz: 13,
      doughballsPerTray: 12,
      doughballVariants: [{ label: "11\" CRB", weightOz: 13, perTray: 12 }],
      components: [
        { ingredient: "Flour", lbs: 50 },
        { ingredient: "Yeast", lbs: 1 },
      ],
    });
    const out = backfillNamedRecipeFromMergedSources(target, [source]);
    expect(out).not.toBeNull();
    expect(out!.components).toEqual([
      { ingredient: "Flour", lbs: 50 },
      { ingredient: "Yeast", lbs: 1 },
    ]);
    expect(out!.brand).toBe("Lowe's");
    expect(out!.flavors).toEqual(["Cheese"]);
    expect(out!.notes).toBe("note");
    expect(out!.doughballWeightOz).toBe(13);
    expect(out!.doughballsPerTray).toBe(12);
    expect(out!.doughballVariants).toEqual([
      { label: "11\" CRB", weightOz: 13, perTray: 12 },
    ]);
  });

  it("never clobbers real data on a populated target and merges variants by label", () => {
    const target = rec({
      name: "T",
      brand: "A",
      doughballWeightOz: 8,
      doughballVariants: [{ label: "V1", weightOz: 8 }],
      components: [{ ingredient: "Flour", lbs: 40 }],
    });
    const source = rec({
      name: "S",
      brand: "B",
      doughballWeightOz: 13,
      doughballVariants: [
        { label: "v1", weightOz: 99 },
        { label: "V2", weightOz: 13 },
      ],
      components: [
        { ingredient: "Flour", lbs: 99 },
        { ingredient: "Salt", lbs: 0.5 },
      ],
    });
    const out = backfillNamedRecipeFromMergedSources(target, [source]);
    expect(out).not.toBeNull();
    expect(out!.brand).toBe("A");
    expect(out!.doughballWeightOz).toBe(8);
    expect(out!.components).toEqual([
      { ingredient: "Flour", lbs: 40 },
      { ingredient: "Salt", lbs: 0.5 },
    ]);
    expect(out!.doughballVariants).toEqual([
      { label: "V1", weightOz: 8 },
      // v1 @99 contradicts V1 @8 — a genuinely different variant survives
      { label: "v1", weightOz: 99 },
      { label: "V2", weightOz: 13 },
    ]);
  });

  it("folds suffix-equivalent variant labels with compatible values", () => {
    const target = rec({
      name: "CRB Dough",
      components: [{ ingredient: "Flour", lbs: 40 }],
      doughballVariants: [
        { label: "Corner Booth", weightOz: 8.25, perTray: 24 },
      ],
    });
    const source = rec({
      name: "S",
      doughballVariants: [
        { label: "Corner Booth CRB Dough", weightOz: 8.25, perTray: 24 },
        { label: "Lowe's 7 Inch", weightOz: 5.7, perTray: 24 },
      ],
    });
    const out = backfillNamedRecipeFromMergedSources(target, [source]);
    expect(out).not.toBeNull();
    expect(out!.doughballVariants).toEqual([
      { label: "Corner Booth", weightOz: 8.25, perTray: 24 },
      { label: "Lowe's 7 Inch", weightOz: 5.7, perTray: 24 },
    ]);
  });

  it("keeps suffix-equivalent variants whose weights contradict", () => {
    const target = rec({
      name: "CRB Dough",
      components: [{ ingredient: "Flour", lbs: 40 }],
      doughballVariants: [
        { label: "Corner Booth", weightOz: 8.25, perTray: 24 },
      ],
    });
    const source = rec({
      name: "S",
      doughballVariants: [
        { label: "Corner Booth CRB Dough", weightOz: 9, perTray: 24 },
      ],
    });
    const out = backfillNamedRecipeFromMergedSources(target, [source]);
    expect(out).not.toBeNull();
    expect(out!.doughballVariants).toEqual([
      { label: "Corner Booth", weightOz: 8.25, perTray: 24 },
      { label: "Corner Booth CRB Dough", weightOz: 9, perTray: 24 },
    ]);
  });

  it("returns null when the source adds nothing", () => {
    const target = rec({
      name: "T",
      brand: "A",
      notes: "n",
      components: [{ ingredient: "Flour", lbs: 40 }],
    });
    const source = rec({
      name: "S",
      components: [{ ingredient: "Flour", lbs: 10 }],
    });
    expect(backfillNamedRecipeFromMergedSources(target, [source])).toBeNull();
  });

  it("canonicalizes equivalent Dough and Sauce component rows and is repeat-safe", () => {
    const doughTarget = rec({
      name: "Dough",
      components: [
        { ingredient: "King Arthur Flour", lbs: 0 },
        { ingredient: "Flour, King Arthur", lbs: 40 },
      ],
    });
    const sauceTarget = rec({
      name: "Sauce",
      components: [{ ingredient: "Tomato's Crushed", lbs: 12 }],
    });
    const doughSource = rec({
      name: "Old Dough",
      components: [
        { ingredient: "Arthur King Flour", lbs: 99 },
        { ingredient: "Salt", lbs: 1 },
        { ingredient: "Salt", lbs: 2 },
      ],
    });
    const sauceSource = rec({
      name: "Old Sauce",
      components: [
        { ingredient: "Crushed Tomato", lbs: 99 },
        { ingredient: "Oregano", lbs: 0.5 },
        { ingredient: "Oregano", lbs: 1 },
      ],
    });

    const dough = backfillNamedRecipeFromMergedSources(doughTarget, [doughSource]);
    const sauce = backfillNamedRecipeFromMergedSources(sauceTarget, [sauceSource]);

    expect(dough!.components).toEqual([
      { ingredient: "King Arthur Flour", lbs: 40 },
      { ingredient: "Salt", lbs: 1 },
    ]);
    expect(sauce!.components).toEqual([
      { ingredient: "Tomato's Crushed", lbs: 12 },
      { ingredient: "Oregano", lbs: 0.5 },
    ]);
    expect(backfillNamedRecipeFromMergedSources(dough!, [doughSource])).toBeNull();
    expect(backfillNamedRecipeFromMergedSources(sauce!, [sauceSource])).toBeNull();
  });
});
