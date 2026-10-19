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
  buildCheeseExportGrids,
  buildDoughExportGrids,
  buildSpecExportGrids,
  buildMixExportGrids,
  buildSauceExportGrids,
  buildSpecsExportGrids,
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
    const profiles = findSheet(buildSpecsExportGrids(input), "Bobo's Original");
    expect(profiles.rows[0]?.[0]).toBe("Brand");
    // header + 2 profiles
    expect(profiles.rows.length).toBe(3);
    const row = profiles.rows.find((r) => r[1] === "Pepperoni")!;
    expect(row[0]).toBe("Bobo's Original");
    expect(row[2]).toBe("12 inch");
    expect(row[3]).toBe("4");
    // dough/sauce recipe name columns (the product's assigned types)
    expect(row[4]).toBe("Standard Dough");
    expect(row[5]).toBe("12");
    expect(row[6]).toBe("24");
    expect(row[7]).toBe("Pizza Sauce");
    expect(row[8]).toBe("Mozzarella");
    expect(row[9]).toBe("3.5");
    expect(row[10]).toBe("Cheese Blend");
    // pep 1 type/sticks/oz — now immediately after the used applicator slots
    expect(row[11]).toBe("Sliced Pepperoni");
    expect(row[12]).toBe("2");
    expect(row[13]).toBe("1.5");
  });

  it("folds only identical case-only rows and retains same-key conflicts and recipe variants", () => {
    const conflicted: SpecExportInput = {
      profiles: [
        {
          brand: "Acme",
          flavor: "Cheese",
          applicators: [
            { type: "Shared Cheese", ozPerPizza: 2 },
            { type: "Shared Cheese", ozPerPizza: 3 },
          ],
          pepperonis: [],
          doughRecipeName: "Shared Dough",
          targetDoughballWeight: 10,
          doughballsPerTray: 24,
          cheeseRecipeNames: ["Shared Cheese", "Shared Cheese"],
        },
        {
          brand: "ACME",
          flavor: "CHEESE",
          applicators: [
            { type: "shared cheese", ozPerPizza: 2 },
            { type: "shared cheese", ozPerPizza: 3 },
          ],
          pepperonis: [],
          doughRecipeName: "shared dough",
          targetDoughballWeight: 10,
          doughballsPerTray: 24,
          cheeseRecipeNames: ["shared cheese", "shared cheese"],
        },
        {
          brand: "Acme",
          flavor: "Cheese",
          applicators: [
            { type: "Shared Cheese", ozPerPizza: 2 },
            { type: "Shared Cheese", ozPerPizza: 3 },
          ],
          pepperonis: [],
          doughRecipeName: "Shared Dough",
          targetDoughballWeight: 11,
          doughballsPerTray: 24,
          cheeseRecipeNames: ["Shared Cheese", "Shared Cheese"],
        },
        {
          brand: "Beta",
          flavor: "Other",
          applicators: [],
          pepperonis: [],
          doughRecipeName: "Shared Dough",
          cheeseRecipeNames: ["Shared Cheese"],
        },
      ],
      doughRecipes: [
        {
          name: "Shared Dough",
          rows: [
            { ingredient: "Flour", lbs: 50 },
            { ingredient: "Flour", lbs: 0 },
          ],
        },
        {
          name: "shared dough",
          rows: [
            { ingredient: "flour", lbs: 50 },
            { ingredient: "flour", lbs: 0 },
          ],
        },
        { name: "SHARED DOUGH", rows: [{ ingredient: "Flour", lbs: 55 }] },
        { name: "Other Dough", rows: [{ ingredient: "Flour", lbs: 5 }] },
      ],
      sauceRecipes: [],
      cheeseRecipes: [
        {
          name: "Shared Cheese",
          rows: [
            { ingredient: "Mozzarella", lbs: 20 },
            { ingredient: "Mozzarella", lbs: 0 },
          ],
        },
        {
          name: "shared cheese",
          rows: [
            { ingredient: "mozzarella", lbs: 20 },
            { ingredient: "mozzarella", lbs: 0 },
          ],
        },
        { name: "SHARED CHEESE", rows: [{ ingredient: "Mozzarella", lbs: 21 }] },
      ],
    };
    const profiles = buildSpecsExportGrids(conflicted);
    expect(profiles.map((grid) => grid.name.toLowerCase())).toEqual(["acme", "beta"]);
    expect(profiles[0]!.rows).toHaveLength(3); // header + exact duplicate collapsed + conflict retained

    const dough = buildDoughExportGrids(conflicted);
    expect(dough.map((grid) => grid.name.toLowerCase())).toEqual([
      "dough — other dough",
      "dough — shared dough",
      "dough — shared dough (2)",
    ]);
    const sharedSheets = dough.slice(1);
    expect(sharedSheets.some((grid) => grid.rows.some((row) => row[0]?.toLowerCase() === "flour" && row[1] === "50"))).toBe(true);
    expect(sharedSheets.some((grid) => grid.rows.some((row) => row[0]?.toLowerCase() === "flour" && row[1] === "0"))).toBe(true);
    expect(sharedSheets.some((grid) => grid.rows.some((row) => row[0]?.toLowerCase() === "flour" && row[1] === "55"))).toBe(true);
    expect(sharedSheets.flatMap((grid) => grid.rows).filter((row) => row[0]?.toLowerCase() === "acme: cheese")).toHaveLength(2);
    expect(sharedSheets.flatMap((grid) => grid.rows).some((row) => row[0] === "Beta: Other")).toBe(true);

    const cheese = buildCheeseExportGrids(conflicted);
    const acme = cheese.find((grid) => grid.name.toLowerCase() === "acme")!;
    expect(acme).toBeDefined();
    expect(acme.rows.filter((row) => row[0]?.toLowerCase() === "recipe: shared cheese")).toHaveLength(2);
    expect(acme.rows.some((row) => row[0]?.toLowerCase() === "mozzarella" && row[1] === "20")).toBe(true);
    expect(acme.rows.some((row) => row[0]?.toLowerCase() === "mozzarella" && row[1] === "0")).toBe(true);
    expect(findSheet(cheese, "Beta").rows.some((row) => row[0]?.toLowerCase() === "recipe: shared cheese")).toBe(true);
  });

  it("uses spelled-out column headers (Applicator, Pepperoni, oz/pizza)", () => {
    const header = findSheet(buildSpecsExportGrids(input), "Bobo's Original").rows[0]!;
    // No "App" abbreviation — must say "Applicator"
    expect(header.some((h) => /^App \d/.test(h))).toBe(false);
    expect(header).toContain("Applicator 1 Type");
    expect(header).toContain("Applicator 1 oz/pizza");
    expect(header).toContain("Applicator 1 Recipe");
    // No "Pep" abbreviation — must say "Pepperoni"
    expect(header.some((h) => /^Pep \d/.test(h))).toBe(false);
    expect(header).toContain("Pepperoni 1 Type");
    expect(header).toContain("Pepperoni 1 Sticks");
    expect(header).toContain("Pepperoni 1 oz/pizza");
    // Sauce column shortened
    expect(header).toContain("Sauce oz/pizza");
    expect(header).toContain("Target Doughball Weight (oz)");
    expect(header).toContain("Doughballs Per Tray");
    expect(header.some((h) => h === "Sauce oz per pizza")).toBe(false);
  });

  it("trims unused applicator/pep slot columns", () => {
    // input has 2 profiles; together they use 1 applicator slot and 1 pep slot.
    // 6 base + 2 optional dough columns + 1 app×3 + 1 pep×3 = 14 columns.
    const header = findSheet(buildSpecsExportGrids(input), "Bobo's Original").rows[0]!;
    expect(header.length).toBe(14);
  });

  it("emits zero applicator/pep columns when no profile uses any", () => {
    const bare: SpecExportInput = {
      profiles: [{ brand: "Acme", flavor: "Cheese", applicators: [], pepperonis: [], doughRecipeName: "CRB" }],
      doughRecipes: [{ name: "CRB", rows: [{ ingredient: "Flour", lbs: 10 }] }],
      sauceRecipes: [],
      cheeseRecipes: [],
    };
    const header = findSheet(buildSpecsExportGrids(bare), "Acme").rows[0]!;
    // Only the 6 base columns
    expect(header.length).toBe(6);
    expect(header).toEqual(["Brand", "Flavor", "Die Type", "Sauce oz/pizza", "Dough Recipe", "Sauce Recipe"]);
  });

  it("marks the header row bold on the Profiles sheet", () => {
    const profiles = findSheet(buildSpecsExportGrids(input), "Bobo's Original");
    expect(profiles.boldRows).toContain(0);
  });

  it("marks Recipe: rows bold on recipe sheets", () => {
    const dough = findSheet(buildDoughExportGrids(input), "Dough — Standard Dough");
    const recipeRowIdx = dough.rows.findIndex((r) => r[0]?.startsWith("Recipe:"));
    expect(recipeRowIdx).toBeGreaterThanOrEqual(0);
    expect(dough.boldRows).toContain(recipeRowIdx);
  });

  it("emits recipe blocks with Brand: flavor targets and ingredient tables", () => {
    const dough = findSheet(buildDoughExportGrids(input), "Dough — Standard Dough");
    const flat = dough.rows.map((r) => r.join("|"));
    expect(flat).toContain("Recipe: Standard Dough");
    // both flavors listed under the one brand
    expect(flat.some((l) => l === "Bobo's Original: Pepperoni, Cheese" || l === "Bobo's Original: Cheese, Pepperoni")).toBe(true);
    expect(flat).toContain("Target Doughball Weight (oz)|12");
    expect(flat).not.toContain("Doughballs Per Tray|24");
    expect(flat).toContain("Ingredient|Lbs");
    expect(flat).toContain("Flour|50");

    const cheese = findSheet(buildCheeseExportGrids(input), "Bobo's Original");
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
    const dough = buildDoughExportGrids(wide)[0]!;
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
    expect(grids.map((g) => g.name)).toEqual(["Bobo's Original"]);
  });

  it("skips an orphan-free empty kind but still exports library-only recipes without targets", () => {
    const orphan: SpecExportInput = {
      profiles: [],
      doughRecipes: [{ name: "Masa Dough", rows: [{ ingredient: "Masa", lbs: 10 }] }],
      sauceRecipes: [],
      cheeseRecipes: [],
    };
    const grids = buildSpecExportGrids(orphan, ALL);
    expect(grids.map((g) => g.name)).toEqual(["Dough — Masa Dough"]);
    const flat = grids[0]!.rows.map((r) => r.join("|"));
    expect(flat).toContain("Recipe: Masa Dough");
    // no profile → no "Brand: flavor" line
    expect(flat.some((l) => l.includes(":") && !l.startsWith("Recipe:"))).toBe(false);
  });

  it("groups shared cheese by every using brand and puts unused recipes on Unassigned", () => {
    const grouped: SpecExportInput = {
      profiles: [
        { brand: "Alpha", flavor: "Cheese", applicators: [], pepperonis: [], cheeseRecipeNames: ["Shared Blend"] },
        { brand: "Beta", flavor: "Pep", applicators: [], pepperonis: [], cheeseRecipeNames: ["Shared Blend"] },
      ],
      doughRecipes: [],
      sauceRecipes: [],
      cheeseRecipes: [
        { name: "Shared Blend", rows: [{ ingredient: "Mozzarella", lbs: 10 }] },
        { name: "Library Only", rows: [{ ingredient: "Provolone", lbs: 5 }] },
      ],
    };
    const grids = buildCheeseExportGrids(grouped);
    expect(grids.map((grid) => grid.name)).toEqual(["Alpha", "Beta", "Unassigned"]);
    expect(findSheet(grids, "Alpha").rows).toContainEqual(["Recipe: Shared Blend"]);
    expect(findSheet(grids, "Beta").rows).toContainEqual(["Recipe: Shared Blend"]);
    expect(findSheet(grids, "Unassigned").rows).toContainEqual(["Recipe: Library Only"]);
  });

  it("keeps Mix-only recipe links in Specs but excludes them from Cheese targets", () => {
    const mixLinked: SpecExportInput = {
      profiles: [{
        brand: "Sample Food",
        flavor: "Veggie",
        applicators: [{ type: "Whole Mozzarella", ozPerPizza: 1 }],
        pepperonis: [],
        cheeseRecipeNames: ["Garden Mix"],
      }],
      doughRecipes: [],
      sauceRecipes: [],
      cheeseRecipes: [{ name: "Garden Mix", rows: [{ ingredient: "Onion", lbs: 2 }] }],
      mixOnlyRecipeNames: ["Garden Mix"],
    };

    const profileRow = findSheet(buildSpecsExportGrids(mixLinked), "Sample Food")
      .rows.find((row) => row[1] === "Veggie")!;
    expect(profileRow).toContain("Whole Mozzarella");
    expect(profileRow).toContain("Garden Mix");

    const cheeseSheets = buildCheeseExportGrids(mixLinked);
    expect(cheeseSheets.map((grid) => grid.name)).toEqual(["Unassigned"]);
    const cheeseRows = cheeseSheets.flatMap((grid) => grid.rows);
    expect(cheeseRows).toContainEqual(["Recipe: Garden Mix"]);
    expect(cheeseRows).not.toContainEqual(["Sample Food: Veggie"]);
  });

  it("keeps explicit Mix assignments out of Cheese targets even for shared pool names", () => {
    const shared: SpecExportInput = {
      profiles: [{
        brand: "Sample Food",
        flavor: "Veggie",
        applicators: [{ type: "Mix", ozPerPizza: 1 }],
        pepperonis: [],
        cheeseRecipeNames: ["Garden Mix"],
      }],
      doughRecipes: [],
      sauceRecipes: [],
      cheeseRecipes: [{ name: "Garden Mix", rows: [{ ingredient: "Onion", lbs: 2 }] }],
      // The same display name exists in both pools, so it is not Mix-only.
      mixOnlyRecipeNames: [],
    };

    const cheeseSheets = buildCheeseExportGrids(shared);
    expect(cheeseSheets.map((grid) => grid.name)).toEqual(["Unassigned"]);
    expect(cheeseSheets[0]!.rows).not.toContainEqual(["Sample Food: Veggie"]);
  });

  it("preserves a shared cross-pool Cheese target when the profile uses a Cheese type", () => {
    const shared: SpecExportInput = {
      profiles: [{
        brand: "Sample Food",
        flavor: "Cheese",
        applicators: [{ type: "Cheese Blend", ozPerPizza: 1 }],
        pepperonis: [],
        cheeseRecipeNames: ["Shared Blend"],
      }],
      doughRecipes: [],
      sauceRecipes: [],
      cheeseRecipes: [{ name: "Shared Blend", rows: [{ ingredient: "Mozzarella", lbs: 10 }] }],
      // A same-name Mix entry is not Mix-only when a canonical Cheese entry exists.
      mixOnlyRecipeNames: [],
    };

    const cheeseRows = findSheet(buildCheeseExportGrids(shared), "Sample Food").rows;
    expect(cheeseRows).toContainEqual(["Recipe: Shared Blend"]);
    expect(cheeseRows).toContainEqual(["Sample Food: Cheese"]);
  });

  it("emits one dough and sauce worksheet per recipe, including unreferenced recipes", () => {
    const extra: SpecExportInput = {
      ...input,
      doughRecipes: [...input.doughRecipes, { name: "Unused Dough", rows: [{ ingredient: "Flour", lbs: 1 }] }],
      sauceRecipes: [...input.sauceRecipes, { name: "Unused Sauce", rows: [{ ingredient: "Tomato", lbs: 1 }] }],
    };
    expect(buildDoughExportGrids(extra).map((grid) => grid.name)).toEqual([
      "Dough — Standard Dough",
      "Dough — Unused Dough",
    ]);
    expect(buildSauceExportGrids(extra).map((grid) => grid.name)).toEqual([
      "Sauce — Pizza Sauce",
      "Sauce — Unused Sauce",
    ]);
  });

  it("does not export one profile's ambiguous recipe metadata as if it applied to every target", () => {
    const ambiguous: SpecExportInput = {
      profiles: [
        {
          brand: "Alpha",
          flavor: "One",
          applicators: [{ type: "cheese", ozPerPizza: 3 }],
          pepperonis: [],
          doughRecipeName: "Shared Dough",
          targetDoughballWeight: 10,
          doughballsPerTray: 20,
          cheeseRecipeNames: ["Shared Cheese"],
        },
        {
          brand: "Alpha",
          flavor: "Two",
          applicators: [
            { type: "", ozPerPizza: 0 },
            { type: "cheese", ozPerPizza: 4 },
          ],
          pepperonis: [],
          doughRecipeName: "Shared Dough",
          targetDoughballWeight: 12,
          doughballsPerTray: 24,
          cheeseRecipeNames: [undefined, "Shared Cheese"],
        },
      ],
      doughRecipes: [{ name: "Shared Dough", rows: [{ ingredient: "Flour", lbs: 10 }] }],
      sauceRecipes: [],
      cheeseRecipes: [{ name: "Shared Cheese", rows: [{ ingredient: "Mozzarella", lbs: 10 }] }],
    };
    expect(buildDoughExportGrids(ambiguous)[0]!.rows.flat()).not.toContain("Target Doughball Weight (oz)");
    expect(buildDoughExportGrids(ambiguous)[0]!.rows.flat()).not.toContain("Doughballs Per Tray");
    expect(buildCheeseExportGrids(ambiguous)[0]!.rows.flat()).not.toContain("Applicator Slot");
    const profileRows = buildSpecsExportGrids(ambiguous)[0]!.rows;
    expect(profileRows[0]).toContain("Target Doughball Weight (oz)");
    expect(profileRows[0]).toContain("Doughballs Per Tray");
    expect(profileRows[0]).toContain("Applicator 2 Recipe");
    const one = profileRows.find((row) => row[1] === "One")!;
    const two = profileRows.find((row) => row[1] === "Two")!;
    expect(one[profileRows[0]!.indexOf("Target Doughball Weight (oz)")]).toBe("10");
    expect(two[profileRows[0]!.indexOf("Target Doughball Weight (oz)")]).toBe("12");
    expect(one[profileRows[0]!.indexOf("Applicator 1 Recipe")]).toBe("Shared Cheese");
    expect(two[profileRows[0]!.indexOf("Applicator 2 Recipe")]).toBe("Shared Cheese");
  });

  it("omits shared dough metadata when any tied profile leaves the field unset", () => {
    const partial: SpecExportInput = {
      profiles: [
        {
          brand: "Alpha",
          flavor: "One",
          applicators: [],
          pepperonis: [],
          doughRecipeName: "Shared Dough",
          targetDoughballWeight: 10,
          doughballsPerTray: 20,
        },
        {
          brand: "Beta",
          flavor: "Two",
          applicators: [],
          pepperonis: [],
          doughRecipeName: "Shared Dough",
        },
      ],
      doughRecipes: [{ name: "Shared Dough", rows: [{ ingredient: "Flour", lbs: 10 }] }],
      sauceRecipes: [],
      cheeseRecipes: [],
    };
    const cells = buildDoughExportGrids(partial)[0]!.rows.flat();
    expect(cells).not.toContain("Target Doughball Weight (oz)");
    expect(cells).not.toContain("Doughballs Per Tray");
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

  it("uses explicit units and preserves per-batch lbs separately from per-pizza oz", () => {
    const mix: Mix = {
      ...mixes[0]!,
      components: [
        { ingredient: "Onions", perPizza: 0.5, perBatchLbs: 2.75 },
        { ingredient: "Peppers", perPizza: 0, perBatchLbs: 1.25 },
      ],
    };
    const grid = buildMixExportGrids([mix])[0]!;
    expect(grid.rows).toContainEqual(["Ingredient", "Per Pizza (oz)", "Per Batch (lbs)"]);
    expect(grid.rows).toContainEqual(["Onions", "0.5", "2.75"]);
    expect(grid.rows).toContainEqual(["Peppers", "0", "1.25"]);
    const parsed = parsePremixWorkbook(grid ? [grid] : []);
    expect(parsed[0]?.components).toEqual([
      { ingredient: "Onions", perPizza: 0.5, perBatch: 2.75 },
      { ingredient: "Peppers", perPizza: 0, perBatch: 1.25 },
    ]);
  });

  it("groups case-only brand spellings on one Mixes tab without dropping distinct blocks", () => {
    const grids = buildMixExportGrids([
      mixes[0]!,
      { ...mixes[0]!, id: "case-only", brand: "bobo's original", name: "Distinct Mix", flavor: "Cheese" },
    ]);
    expect(grids).toHaveLength(1);
    const parsed = parsePremixWorkbook(grids);
    expect(parsed.map((mix) => mix.name).sort()).toEqual([
      "Bobo's Veggie Mix",
      "Distinct Mix",
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

  it("groups mixes by brand, keeps notes block-local, and uses Unassigned for orphans", () => {
    const grouped: Mix[] = [
      mixes[0]!,
      {
        ...mixes[0]!,
        id: "second",
        name: "Bobo's Cheese Mix",
        flavor: "Cheese",
        daysEarly: 0,
        notes: undefined,
      },
      {
        ...mixes[0]!,
        id: "orphan",
        name: "Library Mix",
        brand: "",
        flavor: "",
        daysEarly: 0,
        notes: undefined,
      },
    ];
    const grids = buildMixExportGrids(grouped);
    expect(grids.map((grid) => grid.name)).toEqual(["Bobo's Original", "Unassigned"]);
    const parsed = parsePremixWorkbook(grids);
    expect(parsed.map((mix) => [mix.name, mix.daysEarly])).toEqual([
      ["Bobo's Cheese Mix", 0],
      ["Bobo's Veggie Mix", 3],
      ["Library Mix", 0],
    ]);
    expect(parsed.find((mix) => mix.name === "Bobo's Veggie Mix")).toMatchObject({
      productBrand: "Bobo's Original",
      productFlavor: "Pepperoni",
      productMarked: true,
    });
    expect(parsed.find((mix) => mix.name === "Library Mix")).toMatchObject({
      productMarked: true,
      productBrand: undefined,
      productFlavor: undefined,
    });
  });
});
