// @vitest-environment node
//
// Unit tests for computeNewMixIngredients — the brand-scope-aware detection
// helper that finds incoming spec mix components missing from saved mixes.
//
// Key regression covered: same-named mixes under TWO different brands must
// both appear as detection candidates and the returned entries must be
// independently filter-able by the compound brand+name key the dialog uses.

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ParsedSpecImport } from "@workspace/spec-import";
import type { Mix } from "@workspace/mixes";
import { normalizeMix } from "@workspace/mixes";

// ── Mocks ──────────────────────────────────────────────────────────────────

const mixStore = vi.hoisted(() => ({
  existing: [] as Mix[],
}));

vi.mock("./mixes", () => ({
  fetchMixes: async () => mixStore.existing,
  saveMixes: async (items: Mix[]) => items,
}));

// fillSpecCheeseTargetsFromProfiles just returns the parse as-is in tests
// (we're supplying already-scoped parsed objects).
vi.mock("@workspace/spec-import", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/spec-import")>();
  return {
    ...actual,
    fillSpecCheeseTargetsFromProfiles: (p: ParsedSpecImport) => p,
  };
});

import { computeNewMixIngredients } from "./specImport";

function makeMix(
  name: string,
  brand: string,
  components: Array<{ ingredient: string; perPizza: number }>,
): Mix {
  return normalizeMix({
    id: `${brand.toLowerCase()}-${name.toLowerCase()}`.replace(/\s+/g, "-"),
    name,
    brand,
    flavor: "",
    batchSize: 0,
    daysEarly: 0,
    amountAlreadyMade: 0,
    components,
    enabled: true,
  })!;
}

// A bare-bones ParsedSpecImport where every recipe IS a mix (kind=="cheese"
// with a brand/flavor target so `specImportRecipeIsMix` qualifies it as a mix
// via the userMixNamesLower lookup, and fillSpecCheeseTargetsFromProfiles
// passes it through unchanged). We achieve the "is a mix" qualification by
// naming the recipe exactly as one of the existing mixes in the pool.
function makeSpecImport(
  mixes: Array<{
    name: string;
    brand: string;
    flavor: string;
    ingredients: Array<{ ingredient: string; lbs: number }>;
  }>,
): ParsedSpecImport {
  return {
    profiles: mixes.map((m) => ({
      brand: m.brand,
      flavor: m.flavor,
      applicators: [],
      pepperonis: [],
    })),
    recipes: mixes.map((m) => ({
      kind: "cheese" as const,
      name: m.name,
      brand: m.brand,
      flavor: m.flavor,
      rows: m.ingredients.map((i) => ({
        ingredient: i.ingredient,
        lbs: i.lbs, // parser quirk: perPizza oz is stored in lbs
      })),
    })),
  };
}

beforeEach(() => {
  mixStore.existing = [];
});

describe("computeNewMixIngredients", () => {
  it("detects a new ingredient on a single branded existing mix", async () => {
    mixStore.existing = [
      makeMix("Veggie Mix", "Aldo's", [{ ingredient: "Mozzarella", perPizza: 2.5 }]),
    ];
    const parsed = makeSpecImport([
      {
        name: "Veggie Mix",
        brand: "Aldo's",
        flavor: "BBQ",
        ingredients: [
          { ingredient: "Mozzarella", lbs: 2.5 },
          { ingredient: "Bell Peppers", lbs: 0.75 }, // NEW
        ],
      },
    ]);
    const result = await computeNewMixIngredients(parsed);
    expect(result).toHaveLength(1);
    expect(result[0].mixName).toBe("Veggie Mix");
    expect(result[0].brand).toBe("Aldo's");
    const bellPeppers = result[0].newComponents.find((c) => c.ingredient === "Bell Peppers");
    expect(bellPeppers).toBeDefined();
    expect(bellPeppers?.perPizza).toBe(0.75);
  });

  it("produces ONE entry per brand when same-named mixes exist under TWO brands", async () => {
    // Both Aldo's and Lucia's have saved a "Taco Mix" with one component each.
    mixStore.existing = [
      makeMix("Taco Mix", "Aldo's",  [{ ingredient: "Cheese", perPizza: 2 }]),
      makeMix("Taco Mix", "Lucia's", [{ ingredient: "Cheese", perPizza: 2 }]),
    ];
    // The spec sheet adds "Ham" to Aldo's Taco Mix and "Cumin" to Lucia's Taco Mix.
    const parsed = makeSpecImport([
      {
        name: "Taco Mix",
        brand: "Aldo's",
        flavor: "Taco",
        ingredients: [
          { ingredient: "Cheese", lbs: 2 },
          { ingredient: "Ham",    lbs: 1 },   // NEW for Aldo's
        ],
      },
      {
        name: "Taco Mix",
        brand: "Lucia's",
        flavor: "Taco",
        ingredients: [
          { ingredient: "Cheese", lbs: 2 },
          { ingredient: "Cumin",  lbs: 0.3 }, // NEW for Lucia's
        ],
      },
    ]);
    const result = await computeNewMixIngredients(parsed);
    // Both brand-scoped entries must appear — not just the first brand.
    expect(result).toHaveLength(2);

    const aldosEntry  = result.find((e) => e.brand === "Aldo's");
    const luciasEntry = result.find((e) => e.brand === "Lucia's");
    expect(aldosEntry).toBeDefined();
    expect(luciasEntry).toBeDefined();

    expect(aldosEntry!.newComponents.some((c) => c.ingredient === "Ham")).toBe(true);
    expect(luciasEntry!.newComponents.some((c) => c.ingredient === "Cumin")).toBe(true);
    // Neither should see the other brand's new ingredient.
    expect(aldosEntry!.newComponents.some((c) => c.ingredient === "Cumin")).toBe(false);
    expect(luciasEntry!.newComponents.some((c) => c.ingredient === "Ham")).toBe(false);
  });

  it("compound keys from the two-brand entries are independently filter-able", async () => {
    // This mirrors how the dialog and commitSpecImport use the accepted set:
    // accepting only Aldo's key must not affect Lucia's entry.
    mixStore.existing = [
      makeMix("Taco Mix", "Aldo's",  [{ ingredient: "Cheese", perPizza: 2 }]),
      makeMix("Taco Mix", "Lucia's", [{ ingredient: "Cheese", perPizza: 2 }]),
    ];
    const parsed = makeSpecImport([
      {
        name: "Taco Mix",
        brand: "Aldo's",
        flavor: "T",
        ingredients: [{ ingredient: "Cheese", lbs: 2 }, { ingredient: "Ham", lbs: 1 }],
      },
      {
        name: "Taco Mix",
        brand: "Lucia's",
        flavor: "T",
        ingredients: [{ ingredient: "Cheese", lbs: 2 }, { ingredient: "Cumin", lbs: 0.3 }],
      },
    ]);
    const result = await computeNewMixIngredients(parsed);

    // Simulate accepting only Aldo's via compound key.
    const acceptedSet = new Set(["aldo's\0taco mix"]);
    const acceptedAdditions = result.filter((e) => {
      const key = `${e.brand.trim().toLowerCase()}\0${e.mixName.trim().toLowerCase()}`;
      return acceptedSet.has(key);
    });

    expect(acceptedAdditions).toHaveLength(1);
    expect(acceptedAdditions[0].brand).toBe("Aldo's");
    expect(acceptedAdditions[0].newComponents.some((c) => c.ingredient === "Ham")).toBe(true);
  });

  it("returns empty array when the pool is empty", async () => {
    mixStore.existing = [];
    const parsed = makeSpecImport([
      { name: "Veggie Mix", brand: "Aldo's", flavor: "BBQ", ingredients: [{ ingredient: "Cheese", lbs: 2 }] },
    ]);
    const result = await computeNewMixIngredients(parsed);
    expect(result).toHaveLength(0);
  });

  it("returns empty array when all ingredients already exist in the mix", async () => {
    mixStore.existing = [
      makeMix("Veggie Mix", "Aldo's", [{ ingredient: "Mozzarella", perPizza: 2.5 }, { ingredient: "Cheddar", perPizza: 1 }]),
    ];
    const parsed = makeSpecImport([
      {
        name: "Veggie Mix",
        brand: "Aldo's",
        flavor: "BBQ",
        ingredients: [{ ingredient: "Mozzarella", lbs: 2.5 }, { ingredient: "Cheddar", lbs: 1 }],
      },
    ]);
    const result = await computeNewMixIngredients(parsed);
    expect(result).toHaveLength(0);
  });
});
