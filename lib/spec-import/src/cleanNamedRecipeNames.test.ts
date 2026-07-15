import { describe, it, expect } from "vitest";
import {
  cleanSpecNamedRecipeName,
  canonicalizeSpecImportNamedRecipeNames,
  type ParsedSpecImport,
} from "./index";

describe("cleanSpecNamedRecipeName", () => {
  it("unwraps 'Parbake crust (…)' and drops a trailing die qualifier", () => {
    expect(cleanSpecNamedRecipeName("dough", 'Parbake crust (11" CRB recipe - 11" Dies)')).toBe('CRB recipe');
    expect(cleanSpecNamedRecipeName("dough", "Par-baked crusts (Thin Crust – Round Dies)")).toBe("Thin Crust");
    expect(cleanSpecNamedRecipeName("dough", "Parbake Crust (House Dough)")).toBe("House Dough");
  });

  it("strips made-in-house style provenance parentheticals", () => {
    expect(cleanSpecNamedRecipeName("sauce", "Aldo's Sauce (made in house)")).toBe("Aldo's Sauce");
    expect(cleanSpecNamedRecipeName("sauce", "Red Sauce (In-House)")).toBe("Red Sauce");
    expect(cleanSpecNamedRecipeName("dough", "Dough (house made) Classic")).toBe("Dough Classic");
  });

  it("strips other sourcing qualifiers (Legacy, Recipe, UFI)", () => {
    expect(cleanSpecNamedRecipeName("sauce", "BBQ Sauce (Legacy)")).toBe("BBQ Sauce");
    expect(cleanSpecNamedRecipeName("sauce", "Lucia's Sauce (Lucia's Recipe)")).toBe("Lucia's Sauce");
    expect(cleanSpecNamedRecipeName("sauce", "Marinara (UFI - Made in House)")).toBe("Marinara");
  });

  it("leaves ordinary names (and other parentheticals) alone", () => {
    expect(cleanSpecNamedRecipeName("sauce", "Aldo's Sauce")).toBe("Aldo's Sauce");
    expect(cleanSpecNamedRecipeName("sauce", "Sauce (Spicy)")).toBe("Sauce (Spicy)");
    expect(cleanSpecNamedRecipeName("sauce", "Wing Sauce (Mild)")).toBe("Wing Sauce (Mild)");
    expect(cleanSpecNamedRecipeName("sauce", "  Two   Spaces  ")).toBe("Two Spaces");
    expect(cleanSpecNamedRecipeName("sauce", "")).toBe("");
  });

  it("keeps the original when cleaning would leave nothing usable", () => {
    expect(cleanSpecNamedRecipeName("sauce", "(made in house)")).toBe("(made in house)");
    expect(cleanSpecNamedRecipeName("sauce", "Sauce (Lucia Recipe)")).toBe("Sauce (Lucia Recipe)");
  });
});

describe("canonicalizeSpecImportNamedRecipeNames", () => {
  const base: ParsedSpecImport = { profiles: [], recipes: [] };

  it("cleans dough/sauce recipe names in lockstep with profile references", () => {
    const parsed: ParsedSpecImport = {
      ...base,
      recipes: [
        { kind: "dough", name: 'Parbake crust (11" CRB recipe - 11" Dies)', rows: [] },
        { kind: "sauce", name: "Aldo's Sauce (made in house)", rows: [] },
      ],
      profiles: [
        {
          brand: "Aldo's",
          flavor: "Cheese",
          doughName: 'Parbake crust (11" CRB recipe - 11" Dies)',
          sauceName: "Aldo's Sauce (made in house)",
        } as ParsedSpecImport["profiles"][number],
      ],
    };
    const out = canonicalizeSpecImportNamedRecipeNames(parsed);
    expect(out.recipes?.map((r) => r.name)).toEqual(['CRB recipe', "Aldo's Sauce"]);
    expect(out.profiles?.[0].doughName).toBe('CRB recipe');
    expect(out.profiles?.[0].sauceName).toBe("Aldo's Sauce");
  });

  it("cleans profile references even when the recipe wasn't parsed", () => {
    const parsed: ParsedSpecImport = {
      ...base,
      profiles: [
        {
          brand: "B",
          flavor: "F",
          sauceName: "Red Sauce (made in house)",
        } as ParsedSpecImport["profiles"][number],
      ],
    };
    const out = canonicalizeSpecImportNamedRecipeNames(parsed);
    expect(out.profiles?.[0].sauceName).toBe("Red Sauce");
  });

  it("never rewrites user-typed names and returns the same object when nothing changes", () => {
    const parsed: ParsedSpecImport = {
      ...base,
      recipes: [
        { kind: "dough", name: "Dough (made in house)", rows: [], userNamed: true },
        { kind: "cheese", name: "Cheese Mix (made in house)", rows: [] },
      ],
    };
    const out = canonicalizeSpecImportNamedRecipeNames(parsed);
    expect(out.recipes?.[0].name).toBe("Dough (made in house)");
    expect(out.recipes?.[1].name).toBe("Cheese Mix (made in house)");

    const clean: ParsedSpecImport = { ...base, recipes: [{ kind: "sauce", name: "Red Sauce", rows: [] }] };
    expect(canonicalizeSpecImportNamedRecipeNames(clean)).toBe(clean);
  });
});
