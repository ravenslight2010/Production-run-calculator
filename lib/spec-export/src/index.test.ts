import { describe, it, expect } from "vitest";
import {
  parsePremixWorkbook,
  groundPremix,
  premixToMix,
  type PremixKnown,
} from "@workspace/premix-import";
import type { Mix } from "@workspace/mixes";
import { PROMPT_MAX_CELL_CHARS } from "@workspace/spec-import";
import {
  buildSpecExportGrids,
  buildMixExportGrids,
  sanitizeSheetName,
  type SheetGrid,
  type SpecExportInput,
  type SpecExportSelection,
} from "./index";

const ALL: SpecExportSelection = { profiles: true, dough: true, sauce: true, cheese: true };

function findSheet(grids: SheetGrid[], name: string) {
  const g = grids.find((x) => x.name === name);
  if (!g) throw new Error(`missing sheet ${name}`);
  return g;
}

describe("buildSpecExportGrids", () => {
  const input: SpecExportInput = {
    profiles: [
      {
        brand: "Bobo's Original",
        flavor: "Pepperoni",
        dieType: "12 inch",
        sauceOzPerPizza: 4,
        applicators: [
          { type: "Mozzarella", ozPerPizza: 3.5 },
          { type: "", ozPerPizza: 0 },
        ],
        pepperonis: [{ type: "Sliced Pepperoni", sticks: 2, ozPerPizza: 1.5 }],
        doughRecipeName: "Standard Dough",
        targetDoughballWeight: 12,
        doughballsPerTray: 24,
        sauceRecipeName: "Pizza Sauce",
        cheeseRecipeNames: ["Cheese Blend", undefined, undefined, undefined],
      },
      {
        brand: "Bobo's Original",
        flavor: "Cheese",
        dieType: "12 inch",
        sauceOzPerPizza: 4,
        applicators: [{ type: "Mozzarella", ozPerPizza: 3.5 }],
        pepperonis: [],
        doughRecipeName: "Standard Dough",
        targetDoughballWeight: 12,
        sauceRecipeName: "Pizza Sauce",
        cheeseRecipeNames: ["Cheese Blend"],
      },
    ],
    doughRecipes: [{ name: "Standard Dough", rows: [{ ingredient: "Flour", lbs: 50 }, { ingredient: "Water", lbs: 30 }] }],
    sauceRecipes: [{ name: "Pizza Sauce", rows: [{ ingredient: "Tomato Paste", lbs: 20 }] }],
    cheeseRecipes: [{ name: "Cheese Blend", rows: [{ ingredient: "Mozzarella", lbs: 40 }] }],
  };

  it("emits a Profiles sheet with a header + one row per brand+flavor", () => {
    const grids = buildSpecExportGrids(input, ALL);
    const profiles = findSheet(grids, "Profiles");
    expect(profiles.rows[0]?.[0]).toBe("Brand");
    // header + 2 profiles
    expect(profiles.rows.length).toBe(3);
    const row = profiles.rows.find((r) => r[1] === "Pepperoni")!;
    expect(row[0]).toBe("Bobo's Original");
    expect(row[2]).toBe("12 inch");
    expect(row[3]).toBe("4");
    // dough/sauce recipe name columns (the product's assigned types)
    expect(row[4]).toBe("Standard Dough");
    expect(row[5]).toBe("Pizza Sauce");
    // applicator 1 (only slot in use across these profiles)
    expect(row[6]).toBe("Mozzarella");
    expect(row[7]).toBe("3.5");
    // pep 1 type/sticks/oz — now immediately after the used applicator slots
    // (cols 8/9/10 not 14/15/16 — trimming removed the empty app 2/3/4 slots)
    expect(row[8]).toBe("Sliced Pepperoni");
    expect(row[9]).toBe("2");
    expect(row[10]).toBe("1.5");
  });

  it("uses spelled-out column headers (Applicator, Pepperoni, oz/pizza)", () => {
    const grids = buildSpecExportGrids(input, ALL);
    const header = findSheet(grids, "Profiles").rows[0]!;
    // No "App" abbreviation — must say "Applicator"
    expect(header.some((h) => /^App \d/.test(h))).toBe(false);
    expect(header).toContain("Applicator 1 Type");
    expect(header).toContain("Applicator 1 oz/pizza");
    // No "Pep" abbreviation — must say "Pepperoni"
    expect(header.some((h) => /^Pep \d/.test(h))).toBe(false);
    expect(header).toContain("Pepperoni 1 Type");
    expect(header).toContain("Pepperoni 1 Sticks");
    expect(header).toContain("Pepperoni 1 oz/pizza");
    // Sauce column shortened
    expect(header).toContain("Sauce oz/pizza");
    expect(header.some((h) => h === "Sauce oz per pizza")).toBe(false);
  });

  it("trims unused applicator/pep slot columns — 2-app 1-pep set yields 11 columns", () => {
    // input has 2 profiles; together they use 1 applicator slot and 1 pep slot.
    // 6 base + 1 app×2 + 1 pep×3 = 11 columns (not 20).
    const grids = buildSpecExportGrids(input, ALL);
    const header = findSheet(grids, "Profiles").rows[0]!;
    expect(header.length).toBe(11);
  });

  it("emits zero applicator/pep columns when no profile uses any", () => {
    const bare: SpecExportInput = {
      profiles: [{ brand: "Acme", flavor: "Cheese", applicators: [], pepperonis: [], doughRecipeName: "CRB" }],
      doughRecipes: [{ name: "CRB", rows: [{ ingredient: "Flour", lbs: 10 }] }],
      sauceRecipes: [],
      cheeseRecipes: [],
    };
    const header = findSheet(buildSpecExportGrids(bare, { profiles: true, dough: false, sauce: false, cheese: false }), "Profiles").rows[0]!;
    // Only the 6 base columns
    expect(header.length).toBe(6);
    expect(header).toEqual(["Brand", "Flavor", "Die Type", "Sauce oz/pizza", "Dough Recipe", "Sauce Recipe"]);
  });

  it("marks the header row bold on the Profiles sheet", () => {
    const grids = buildSpecExportGrids(input, ALL);
    const profiles = findSheet(grids, "Profiles");
    expect(profiles.boldRows).toContain(0);
  });

  it("marks Recipe: rows bold on recipe sheets", () => {
    const grids = buildSpecExportGrids(input, ALL);
    const dough = findSheet(grids, "Dough Recipes");
    const recipeRowIdx = dough.rows.findIndex((r) => r[0]?.startsWith("Recipe:"));
    expect(recipeRowIdx).toBeGreaterThanOrEqual(0);
    expect(dough.boldRows).toContain(recipeRowIdx);
  });

  it("emits recipe blocks with Brand: flavor targets and ingredient tables", () => {
    const grids = buildSpecExportGrids(input, ALL);
    const dough = findSheet(grids, "Dough Recipes");
    const flat = dough.rows.map((r) => r.join("|"));
    expect(flat).toContain("Recipe: Standard Dough");
    // both flavors listed under the one brand
    expect(flat.some((l) => l === "Bobo's Original: Pepperoni, Cheese" || l === "Bobo's Original: Cheese, Pepperoni")).toBe(true);
    expect(flat).toContain("Target Doughball Weight (oz)|12");
    expect(flat).toContain("Doughballs Per Tray|24");
    expect(flat).toContain("Ingredient|Lbs");
    expect(flat).toContain("Flour|50");

    const cheese = findSheet(grids, "Cheese Recipes");
    const cflat = cheese.rows.map((r) => r.join("|"));
    expect(cflat).toContain("Recipe: Cheese Blend");
    expect(cflat).toContain("Applicator Slot|1");
  });

  it("wraps a brand's target flavors across rows so no cell exceeds the prompt cell clamp", () => {
    // Enough distinct flavors that a single "Brand: flavor, flavor…" line would
    // exceed the prompt cell clamp (clamp-relative so the test tracks it).
    const flavors: string[] = [];
    let lineLen = "Silverline Kitchens:".length;
    for (let i = 0; lineLen <= PROMPT_MAX_CELL_CHARS + 40; i++) {
      const f = `Specialty Flavor Number ${i + 1}`;
      flavors.push(f);
      lineLen += f.length + 2;
    }
    const wide: SpecExportInput = {
      profiles: flavors.map((flavor) => ({
        brand: "Silverline Kitchens",
        flavor,
        applicators: [],
        pepperonis: [],
        doughRecipeName: "Silverline Kitchens Dough",
      })),
      doughRecipes: [
        { name: "Silverline Kitchens Dough", rows: [{ ingredient: "Flour", lbs: 10 }] },
      ],
      sauceRecipes: [],
      cheeseRecipes: [],
    };
    const grids = buildSpecExportGrids(wide, ALL);
    const dough = findSheet(grids, "Dough Recipes");
    const targetLines = dough.rows
      .map((r) => r.join("|"))
      .filter((l) => l.startsWith("Silverline Kitchens:"));
    // A single line would exceed the prompt cell clamp and get truncated
    // (losing trailing flavors) — it must wrap into several short lines.
    expect(targetLines.length).toBeGreaterThan(1);
    for (const line of targetLines) expect(line.length).toBeLessThanOrEqual(PROMPT_MAX_CELL_CHARS);
    // Every flavor survives across the wrapped lines.
    const joined = targetLines.map((l) => l.slice("Silverline Kitchens:".length)).join(", ");
    const seen = joined.split(",").map((s) => s.trim()).filter(Boolean);
    expect([...seen].sort()).toEqual([...flavors].sort());
  });

  it("honors the selection (only chosen kinds are emitted)", () => {
    const only: SpecExportSelection = { profiles: true, dough: false, sauce: false, cheese: false };
    const grids = buildSpecExportGrids(input, only);
    expect(grids.map((g) => g.name)).toEqual(["Profiles"]);
  });

  it("skips an orphan-free empty kind but still exports library-only recipes without targets", () => {
    const orphan: SpecExportInput = {
      profiles: [],
      doughRecipes: [{ name: "Masa Dough", rows: [{ ingredient: "Masa", lbs: 10 }] }],
      sauceRecipes: [],
      cheeseRecipes: [],
    };
    const grids = buildSpecExportGrids(orphan, ALL);
    expect(grids.map((g) => g.name)).toEqual(["Dough Recipes"]);
    const flat = grids[0]!.rows.map((r) => r.join("|"));
    expect(flat).toContain("Recipe: Masa Dough");
    // no profile → no "Brand: flavor" line
    expect(flat.some((l) => l.includes(":") && !l.startsWith("Recipe:"))).toBe(false);
  });
});

describe("sanitizeSheetName", () => {
  it("strips illegal chars and clamps to 31 chars", () => {
    expect(sanitizeSheetName("Bobo's / Pep [11in]?", "x")).toBe("Bobo's Pep 11in");
    expect(sanitizeSheetName("", "fallback")).toBe("fallback");
    expect(sanitizeSheetName("a".repeat(50), "x").length).toBe(31);
  });
});

describe("mix export round-trips through the deterministic premix importer", () => {
  const mixes: Mix[] = [
    {
      id: "premix-bobo-s-original-pepperoni-bobo-s-veggie-mix",
      name: "Bobo's Veggie Mix",
      brand: "Bobo's Original",
      flavor: "Pepperoni",
      batchSize: 100,
      daysEarly: 3,
      amountAlreadyMade: 0,
      components: [
        { ingredient: "Onions", perPizza: 0.5 },
        { ingredient: "Peppers", perPizza: 0.25 },
      ],
      enabled: true,
    },
  ];

  it("re-parses to the same name, components, batch size and days-early", () => {
    const grids = buildMixExportGrids(mixes);
    expect(grids.length).toBe(1);
    const parsed = parsePremixWorkbook(grids);
    expect(parsed.length).toBe(1);
    const p = parsed[0]!;
    expect(p.name).toBe("Bobo's Veggie Mix");
    expect(p.batchSize).toBe(100);
    expect(p.daysEarly).toBe(3);
    expect(p.components).toEqual([
      { ingredient: "Onions", perPizza: 0.5, perBatch: 0 },
      { ingredient: "Peppers", perPizza: 0.25, perBatch: 0 },
    ]);
  });

  it("grounds brand/flavor from the tab name and reconstructs a matching Mix id", () => {
    const grids = buildMixExportGrids(mixes);
    const parsed = parsePremixWorkbook(grids);
    const known: PremixKnown = {
      brands: ["Bobo's Original"],
      flavorsByBrand: { "Bobo's Original": ["Pepperoni", "Cheese"] },
      ingredients: ["Onions", "Peppers"],
    };
    const grounded = groundPremix(parsed[0]!, known, []);
    const mix = premixToMix(grounded.mix);
    expect(mix).not.toBeNull();
    expect(mix!.brand).toBe("Bobo's Original");
    expect(mix!.flavor).toBe("Pepperoni");
    expect(mix!.name).toBe("Bobo's Veggie Mix");
    expect(mix!.id).toBe(mixes[0]!.id);
    expect(mix!.batchSize).toBe(100);
    expect(mix!.components).toEqual([
      { ingredient: "Onions", perPizza: 0.5 },
      { ingredient: "Peppers", perPizza: 0.25 },
    ]);
  });
});
