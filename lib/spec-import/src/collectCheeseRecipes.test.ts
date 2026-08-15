import { describe, it, expect } from "vitest";
import { collectSpecImportCheeseRecipes, type ParsedSpecImport } from "./index";

const none = new Set<string>();

function cheeseRecipe(over: Partial<ParsedSpecImport["recipes"][number]> = {}) {
  return {
    kind: "cheese" as const,
    name: over.name ?? "Cheese Blend",
    brand: over.brand,
    flavor: over.flavor,
    targets: over.targets,
    app: over.app,
    rows: over.rows ?? [{ ingredient: "Mozzarella", lbs: 30 }],
    ...over,
  };
}

function parsed(recipes: ParsedSpecImport["recipes"]): ParsedSpecImport {
  return { profiles: [], recipes };
}

describe("collectSpecImportCheeseRecipes", () => {
  it("collects genuine cheese recipes with brand and flavors from targets", () => {
    const drafts = collectSpecImportCheeseRecipes(
      parsed([
        cheeseRecipe({
          name: "Aldo's Cheese Mix",
          brand: "Bobo",
          flavor: "Pepperoni",
          rows: [
            { ingredient: "Mozzarella", lbs: 30 },
            { ingredient: "Provolone", lbs: 10 },
          ],
        }),
      ]),
      none,
    );
    expect(drafts).toHaveLength(1);
    // lbs is always 0 — spec sheets carry per-pizza oz, not batch pounds.
    // sharePct is derived from oz proportions: 30/40=75%, 10/40=25%.
    expect(drafts[0]).toEqual({
      name: "Aldo's Cheese Mix",
      brand: "Bobo",
      flavors: ["Pepperoni"],
      components: [
        { ingredient: "Mozzarella", lbs: 0, sharePct: 75 },
        { ingredient: "Provolone", lbs: 0, sharePct: 25 },
      ],
    });
  });

  it("skips names that route to Mixes (standalone 'mix' word, 2+ ingredients)", () => {
    const drafts = collectSpecImportCheeseRecipes(
      parsed([
        cheeseRecipe({
          name: "White Fajita Mix",
          brand: "Corner Booth",
          flavor: "Fajita",
          rows: [
            { ingredient: "Monterey Jack", lbs: 20 },
            { ingredient: "Green Peppers", lbs: 5 },
          ],
        }),
      ]),
      none,
    );
    expect(drafts).toHaveLength(0);
  });

  it("skips names already in the user Mix list", () => {
    // Note: a name that mentions "cheese" is deliberately NEVER routed to
    // Mixes even when the mix list has it (see specImportCheeseRecipeIsMix),
    // so this uses a non-cheese name.
    const drafts = collectSpecImportCheeseRecipes(
      parsed([cheeseRecipe({ name: "Fajita Blend" })]),
      new Set(["fajita blend"]),
    );
    expect(drafts).toHaveLength(0);
  });

  it("keeps a cheese-named recipe even when the mix list has the same name", () => {
    const drafts = collectSpecImportCheeseRecipes(
      parsed([cheeseRecipe({ name: "Cheese Blend" })]),
      new Set(["cheese blend"]),
    );
    expect(drafts).toHaveLength(1);
  });

  it("ignores non-cheese kinds, empty names, and rowless recipes", () => {
    const drafts = collectSpecImportCheeseRecipes(
      parsed([
        { kind: "dough", name: "Thin Crust", rows: [{ ingredient: "Flour", lbs: 50 }] },
        { kind: "sauce", name: "Marinara", rows: [{ ingredient: "Tomato", lbs: 40 }] },
        cheeseRecipe({ name: "  ", rows: [{ ingredient: "X", lbs: 1 }] }),
        cheeseRecipe({ name: "No Rows", rows: [] }),
      ]),
      none,
    );
    expect(drafts).toHaveLength(0);
  });

  it("de-dupes by name (case-insensitive), keeping the first", () => {
    const drafts = collectSpecImportCheeseRecipes(
      parsed([
        cheeseRecipe({ name: "Cheese Blend", brand: "First", flavor: "Pepperoni" }),
        cheeseRecipe({ name: "cheese blend", brand: "Second", flavor: "Supreme" }),
      ]),
      none,
    );
    expect(drafts).toHaveLength(1);
    expect(drafts[0].brand).toBe("First");
  });

  it("de-dupes component ingredients within a recipe, order preserved", () => {
    const drafts = collectSpecImportCheeseRecipes(
      parsed([
        cheeseRecipe({
          name: "Cheese Blend",
          rows: [
            { ingredient: "Mozzarella", lbs: 30 },
            { ingredient: "mozzarella", lbs: 5 },
            { ingredient: "Provolone", lbs: 10 },
          ],
        }),
      ]),
      none,
    );
    // row.lbs holds per-pizza oz (parser quirk). sharePct is derived from
    // those proportions: 30/40=75%, 10/40=25%. lbs is always 0 — batch
    // pounds are not known from the spec sheet.
    expect(drafts[0].components).toEqual([
      { ingredient: "Mozzarella", lbs: 0, sharePct: 75 },
      { ingredient: "Provolone", lbs: 0, sharePct: 25 },
    ]);
  });

  it("gathers flavors only from targets sharing the first target's brand", () => {
    const drafts = collectSpecImportCheeseRecipes(
      parsed([
        cheeseRecipe({
          name: "Shared Blend",
          brand: "Bobo",
          flavor: "Pepperoni",
          targets: [
            { brand: "Bobo", flavor: "Cheese" },
            { brand: "Other", flavor: "Supreme" },
          ],
        }),
      ]),
      none,
    );
    expect(drafts[0].brand).toBe("Bobo");
    expect(drafts[0].flavors).toEqual(["Pepperoni", "Cheese"]);
  });
});
