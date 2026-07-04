import { describe, it, expect } from "vitest";
import {
  normalizeNamedRecipe,
  normalizeNamedRecipes,
  namedRecipeTotalLbs,
  namedRecipeMatchesQuery,
  sortNamedRecipesByName,
  namedRecipeFromDraft,
  addNamedRecipesIfAbsentByName,
  type NamedRecipe,
} from "./index";

describe("normalizeNamedRecipe", () => {
  it("returns null without a usable name", () => {
    expect(normalizeNamedRecipe({ name: "  " })).toBeNull();
    expect(normalizeNamedRecipe(null)).toBeNull();
    expect(normalizeNamedRecipe(42)).toBeNull();
  });

  it("defaults enabled to true, notes to '', components to []", () => {
    const r = normalizeNamedRecipe({ name: "Dough A" });
    expect(r).toEqual({
      id: "dough a",
      name: "Dough A",
      notes: "",
      components: [],
      enabled: true,
    });
  });

  it("keeps an explicit id and scope, clamps lbs, drops bad components", () => {
    const r = normalizeNamedRecipe({
      id: "dough:x",
      scope: "sandbox",
      name: " Dough X ",
      notes: " hi ",
      enabled: false,
      components: [
        { ingredient: " Flour ", lbs: "50" },
        { ingredient: "Water", lbs: -3 },
        { ingredient: "", lbs: 9 },
        "garbage",
      ],
    });
    expect(r).toEqual({
      id: "dough:x",
      scope: "sandbox",
      name: "Dough X",
      notes: "hi",
      enabled: false,
      components: [
        { ingredient: "Flour", lbs: 50 },
        { ingredient: "Water", lbs: 0 },
      ],
    });
  });
});

describe("normalizeNamedRecipes", () => {
  it("drops malformed and collapses duplicate ids (last wins)", () => {
    const list = normalizeNamedRecipes([
      { id: "a", name: "First" },
      null,
      { id: "a", name: "Second" },
      { name: "  " },
    ]);
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe("Second");
  });
});

describe("namedRecipeTotalLbs", () => {
  it("sums component pounds", () => {
    const r = normalizeNamedRecipe({
      name: "x",
      components: [
        { ingredient: "a", lbs: 2 },
        { ingredient: "b", lbs: 3.5 },
      ],
    })!;
    expect(namedRecipeTotalLbs(r)).toBe(5.5);
  });
});

describe("namedRecipeMatchesQuery", () => {
  const r = normalizeNamedRecipe({
    name: "NY Dough",
    components: [{ ingredient: "Semolina", lbs: 1 }],
  })!;
  it("matches on name, ingredient, and empty query", () => {
    expect(namedRecipeMatchesQuery(r, "")).toBe(true);
    expect(namedRecipeMatchesQuery(r, "ny")).toBe(true);
    expect(namedRecipeMatchesQuery(r, "semol")).toBe(true);
    expect(namedRecipeMatchesQuery(r, "zzz")).toBe(false);
  });
});

describe("sortNamedRecipesByName", () => {
  it("sorts case-insensitively without mutating input", () => {
    const input = [
      normalizeNamedRecipe({ name: "banana" })!,
      normalizeNamedRecipe({ name: "Apple" })!,
    ];
    const sorted = sortNamedRecipesByName(input);
    expect(sorted.map((r) => r.name)).toEqual(["Apple", "banana"]);
    expect(input.map((r) => r.name)).toEqual(["banana", "Apple"]);
  });
});

describe("namedRecipeFromDraft", () => {
  it("builds a deterministic prefixed slug id", () => {
    const r = namedRecipeFromDraft({
      name: "12in NY Dough!",
      idPrefix: "dough",
      components: [{ ingredient: "Flour", lbs: 10 }],
    });
    expect(r?.id).toBe("dough:12in-ny-dough");
    expect(r?.name).toBe("12in NY Dough!");
    expect(r?.enabled).toBe(true);
    expect(r?.components).toEqual([{ ingredient: "Flour", lbs: 10 }]);
  });

  it("returns null for a blank name", () => {
    expect(
      namedRecipeFromDraft({ name: "   ", idPrefix: "sauce", components: [] }),
    ).toBeNull();
  });

  it("same name → same id (idempotent re-migration)", () => {
    const a = namedRecipeFromDraft({ name: "Marinara", idPrefix: "sauce", components: [] });
    const b = namedRecipeFromDraft({ name: " marinara ", idPrefix: "sauce", components: [] });
    expect(a?.id).toBe(b?.id);
  });
});

describe("addNamedRecipesIfAbsentByName", () => {
  const existing: NamedRecipe[] = [
    normalizeNamedRecipe({ id: "sauce:marinara", name: "Marinara" })!,
  ];

  it("skips existing names (case-insensitive) and ids, adds new", () => {
    const { merged, added } = addNamedRecipesIfAbsentByName(existing, [
      normalizeNamedRecipe({ id: "sauce:m2", name: "marinara" })!, // dup name
      normalizeNamedRecipe({ id: "sauce:marinara", name: "Other" })!, // dup id
      normalizeNamedRecipe({ id: "sauce:bbq", name: "BBQ" })!, // new
    ]);
    expect(added).toBe(1);
    expect(merged.map((r) => r.name)).toEqual(["Marinara", "BBQ"]);
  });
});
