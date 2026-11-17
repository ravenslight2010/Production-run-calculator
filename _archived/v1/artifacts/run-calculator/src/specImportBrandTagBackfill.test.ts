// @vitest-environment node
//
// Unit tests for the spec-import "who does this blend belong to" backfills:
//
//   • fillSpecCheeseTargetsFromProfiles — a cheese-kind recipe that the AI
//     emitted with NO brand/flavor targets gets its targets from the import's
//     own profiles whose applicator grid references it by name, so the pool
//     entries it seeds carry a customer tag instead of "no customer".
//   • fillCheeseRecipeTags — already-saved UNBRANDED cheese pool recipes get
//     tagged from a later import's drafts; branded ones are never re-scoped.
//   • fillSpecMixTags — same backfill for the Mixes pool.
//
// Regression for the Lowe's Caribbean import, where the recipe blocks named
// nobody and the cheese_recipes/mixes rows landed with empty brand/flavors.

import { describe, it, expect } from "vitest";
import {
  fillSpecCheeseTargetsFromProfiles,
  recipeTargets,
  type ParsedSpecImport,
  type ParsedProfile,
  type ParsedRecipe,
} from "@workspace/spec-import";
import { fillCheeseRecipeTags, normalizeCheeseRecipe } from "@workspace/cheese-recipes";
import { fillSpecMixTags, normalizeMix } from "@workspace/mixes";
import type { CheeseRecipe } from "@workspace/cheese-recipes";
import type { Mix } from "@workspace/mixes";

const profile = (brand: string, flavor: string, appTypes: string[]): ParsedProfile => ({
  brand,
  flavor,
  dieType: "",
  sauceOzPerPizza: 0,
  applicators: appTypes.map((type) => ({ type, ozPerPizza: 1 })),
  pepperonis: [],
});

const cheeseRecipe = (name: string, extra?: Partial<ParsedRecipe>): ParsedRecipe => ({
  kind: "cheese",
  name,
  rows: [{ ingredient: "Mozzarella", lbs: 2 }],
  ...extra,
});

describe("fillSpecCheeseTargetsFromProfiles", () => {
  it("tags an unscoped cheese recipe from the profiles whose applicators name it", () => {
    const parsed: ParsedSpecImport = {
      profiles: [
        profile("Lowe's 11in", "Caribbean", ["Caribbean Veggie Mix", "cheese"]),
        profile("Lowe's 11in", "Supreme", ["Supreme Mix"]),
      ],
      recipes: [cheeseRecipe("Caribbean Veggie Mix")],
    };
    const out = fillSpecCheeseTargetsFromProfiles(parsed);
    const r = (out.recipes ?? [])[0];
    expect(recipeTargets(r)).toEqual([{ brand: "Lowe's 11in", flavor: "Caribbean" }]);
    // Only the referencing profile tags it — Supreme does not.
    expect(recipeTargets(r)).toHaveLength(1);
  });

  it("collects every referencing profile, de-duped", () => {
    const parsed: ParsedSpecImport = {
      profiles: [
        profile("Lowe's 11in", "Caribbean", ["Veggie Mix", "Veggie Mix"]),
        profile("Lowe's 11in", "Deluxe", ["Veggie Mix"]),
      ],
      recipes: [cheeseRecipe("Veggie Mix")],
    };
    const r = (fillSpecCheeseTargetsFromProfiles(parsed).recipes ?? [])[0];
    expect(recipeTargets(r)).toEqual([
      { brand: "Lowe's 11in", flavor: "Caribbean" },
      { brand: "Lowe's 11in", flavor: "Deluxe" },
    ]);
  });

  it("cross-brand references: tags EVERY referencing profile (downstream collect scopes to the first target's brand)", () => {
    const parsed: ParsedSpecImport = {
      profiles: [
        profile("Brand A", "Cheese", ["Shared Mix"]),
        profile("Brand B", "Deluxe", ["Shared Mix"]),
      ],
      recipes: [cheeseRecipe("Shared Mix")],
    };
    const r = (fillSpecCheeseTargetsFromProfiles(parsed).recipes ?? [])[0];
    // Intended policy: record ALL ties; collectSpecImportCheeseRecipes then
    // keys brand off targets[0] and only unions flavors of that same brand,
    // so a genuinely shared blend stays scoped to the first brand in profile
    // order rather than being left untagged.
    expect(recipeTargets(r)).toEqual([
      { brand: "Brand A", flavor: "Cheese" },
      { brand: "Brand B", flavor: "Deluxe" },
    ]);
  });

  it("never touches a recipe that already carries any target", () => {
    const parsed: ParsedSpecImport = {
      profiles: [profile("Other Brand", "Cheese", ["Veggie Mix"])],
      recipes: [cheeseRecipe("Veggie Mix", { brand: "Scoped Brand", flavor: "Original" })],
    };
    const r = (fillSpecCheeseTargetsFromProfiles(parsed).recipes ?? [])[0];
    expect(recipeTargets(r)).toEqual([{ brand: "Scoped Brand", flavor: "Original" }]);
  });

  it("leaves recipes alone when no profile references them (bare generic 'Mix' types)", () => {
    const parsed: ParsedSpecImport = {
      profiles: [profile("Lowe's 11in", "Caribbean", ["Mix", "Mix"])],
      recipes: [cheeseRecipe("Caribbean Veggie Mix")],
    };
    const out = fillSpecCheeseTargetsFromProfiles(parsed);
    expect(recipeTargets((out.recipes ?? [])[0])).toEqual([]);
    // and the input object is returned unchanged (pure no-op path)
    expect(out).toBe(parsed);
  });

  it("matches loosely (apostrophes, per-weight suffix cleaning)", () => {
    const parsed: ParsedSpecImport = {
      profiles: [profile("Aldo's", "Cheese", ["Aldos Cheese Mix 1.75"])],
      recipes: [cheeseRecipe("Aldo's Cheese Mix")],
    };
    const r = (fillSpecCheeseTargetsFromProfiles(parsed).recipes ?? [])[0];
    expect(recipeTargets(r)).toEqual([{ brand: "Aldo's", flavor: "Cheese" }]);
  });
});

const savedCheese = (name: string, brand: string, flavors: string[] = []): CheeseRecipe =>
  normalizeCheeseRecipe({
    id: `id-${name}`,
    name,
    brand,
    flavors,
    components: [{ ingredient: "Mozzarella", lbs: 10 }],
    enabled: true,
  })!;

describe("fillCheeseRecipeTags", () => {
  const drafts = [
    { name: "Caribbean Veggie Mix", brand: "Lowe's 11in", flavors: ["Caribbean"] },
  ];

  it("tags an unbranded saved recipe by name", () => {
    const { next, tagged } = fillCheeseRecipeTags(
      [savedCheese("Caribbean Veggie Mix", "")],
      drafts,
    );
    expect(tagged).toBe(1);
    expect(next[0].brand).toBe("Lowe's 11in");
    expect(next[0].flavors).toEqual(["Caribbean"]);
  });

  it("never re-scopes a recipe that already has a brand", () => {
    const { next, tagged } = fillCheeseRecipeTags(
      [savedCheese("Caribbean Veggie Mix", "Someone Else", [])],
      drafts,
    );
    expect(tagged).toBe(0);
    expect(next[0].brand).toBe("Someone Else");
    expect(next[0].flavors).toEqual([]); // "All Varieties" stays empty
  });

  it("ignores drafts without a brand", () => {
    const { tagged } = fillCheeseRecipeTags(
      [savedCheese("Caribbean Veggie Mix", "")],
      [{ name: "Caribbean Veggie Mix", brand: "", flavors: ["Caribbean"] }],
    );
    expect(tagged).toBe(0);
  });
});

const savedMix = (name: string, brand: string): Mix =>
  normalizeMix({
    id: `id-${name}`,
    name,
    brand,
    flavor: "",
    batchSize: 0,
    daysEarly: 0,
    amountAlreadyMade: 0,
    components: [],
    enabled: true,
  })!;

describe("fillSpecMixTags", () => {
  it("tags an unbranded saved mix via the loose mix name key", () => {
    const { next, tagged } = fillSpecMixTags(
      [savedMix("Caribbean Veggie Mix", "")],
      [{ name: "Caribbean  veggie mix", brand: "Lowe's 11in", flavor: "Caribbean" }],
    );
    expect(tagged).toBe(1);
    expect(next[0].brand).toBe("Lowe's 11in");
    expect(next[0].flavor).toBe("Caribbean");
  });

  it("never re-scopes a branded mix and ignores brandless candidates", () => {
    const res1 = fillSpecMixTags(
      [savedMix("Veggie Mix", "Existing Brand")],
      [{ name: "Veggie Mix", brand: "New Brand", flavor: "X" }],
    );
    expect(res1.tagged).toBe(0);
    expect(res1.next[0].brand).toBe("Existing Brand");
    const res2 = fillSpecMixTags(
      [savedMix("Veggie Mix", "")],
      [{ name: "Veggie Mix", brand: "", flavor: "X" }],
    );
    expect(res2.tagged).toBe(0);
  });
});
