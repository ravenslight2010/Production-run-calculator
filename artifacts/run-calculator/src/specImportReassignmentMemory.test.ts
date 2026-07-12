// @vitest-environment node
//
// Spec import must REMEMBER review-time dough/sauce reassignments (web-only;
// parity paused). Two guarantees are pinned here:
//
//   1. repointProfileNamedRecipes (pure, @workspace/spec-import): when the user
//      links a dough/sauce recipe to an existing saved recipe (or renames it)
//      during review, the profiles' dough/sauce TYPE assignments follow the
//      recipe's FINAL name. Without this the recipe is renamed but every
//      product still points at the raw sheet name, so nothing connects and the
//      raw name leaks into the type dropdowns. (SpecImportDialog's `edited`
//      memo drives this helper with the user's decisions.)
//
//   2. prepareSpecImport applies learned "recipeName" aliases (saved from a
//      prior review's link/rename) to profile doughName/sauceName during
//      canonicalization — so a RE-import assigns the user's chosen recipe name
//      even when the recipe itself is not in the sheet. Alias-only on purpose:
//      exact/fuzzy pool snapping stays the link pass's job.

import { describe, it, expect, vi, beforeEach } from "vitest";
import * as XLSX from "xlsx";
import {
  repointProfileNamedRecipes,
  type NamedRecipeRename,
  type ParsedProfile,
  type ParsedSpecImport,
  type SpecImportAlias,
} from "@workspace/spec-import";

const BRAND = "Aldo's";

const EMPTY_KNOWN = {
  brands: [] as string[],
  flavorsByBrand: {} as Record<string, string[]>,
  appTypes: [] as string[],
  pepTypes: [] as string[],
  cheeseIngredients: [] as string[],
  doughIngredients: [] as string[],
  sauceIngredients: [] as string[],
  sauceNames: [] as string[],
  dieTypes: [] as string[],
  doughRecipes: [] as string[],
  sauceRecipes: [] as string[],
  cheeseRecipes: [] as string[],
};

/** A legit tiny spec workbook (real text → passes the grid sanity check). */
function goodBuffer(): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([
      ["Brand", "Flavor", "Cases"],
      [BRAND, "Cheese", "120"],
    ]),
    "Specs",
  );
  return XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
}

// ---------------------------------------------------------------------------
// 1. Pure helper — profile dough/sauce assignments follow the recipe decision.
// ---------------------------------------------------------------------------

const profile = (over: Partial<ParsedProfile>): ParsedProfile => ({
  brand: BRAND,
  flavor: "Cheese",
  applicators: [],
  pepperonis: [],
  ...over,
});

describe("repointProfileNamedRecipes — review decisions follow through to profiles", () => {
  it("repoints doughName to a linked existing recipe (loose-key match)", () => {
    const profiles = [
      profile({ doughName: "sheet   dough", sauceName: "House Marinara" }),
    ];
    const renames: NamedRecipeRename[] = [
      { kind: "dough", fromNames: ["Sheet Dough"], to: "House Dough" },
    ];
    const out = repointProfileNamedRecipes(profiles, renames);
    expect(out[0].doughName).toBe("House Dough");
    expect(out[0].sauceName).toBe("House Marinara");
  });

  it("is kind-scoped: a dough rename never rewrites a same-named sauce assignment", () => {
    const profiles = [profile({ doughName: "Special", sauceName: "Special" })];
    const out = repointProfileNamedRecipes(profiles, [
      { kind: "dough", fromNames: ["Special"], to: "House Dough" },
    ]);
    expect(out[0].doughName).toBe("House Dough");
    expect(out[0].sauceName).toBe("Special");
  });

  it("repoints sauceName for sauce renames and leaves unmatched profiles by identity", () => {
    const untouched = profile({ doughName: "Other Dough" });
    const touched = profile({ sauceName: "Sheet Sauce" });
    const out = repointProfileNamedRecipes(
      [untouched, touched],
      [{ kind: "sauce", fromNames: ["Sheet Sauce"], to: "House Marinara" }],
    );
    expect(out[0]).toBe(untouched); // identity kept — no spurious rewrites
    expect(out[1].sauceName).toBe("House Marinara");
    expect(out[1].doughName).toBeUndefined();
  });

  it("first-wins when two renames share the same loose source key", () => {
    // Two included recipes whose parsed names collapse to the same loose key
    // but diverge to different final names: the FIRST mapping registered wins,
    // deterministically (Map.has guard in the helper).
    const profiles = [profile({ doughName: "Sheet Dough" })];
    const out = repointProfileNamedRecipes(profiles, [
      { kind: "dough", fromNames: ["Sheet Dough"], to: "House Dough" },
      { kind: "dough", fromNames: ["SHEET  DOUGH"], to: "Other Dough" },
    ]);
    expect(out[0].doughName).toBe("House Dough");
  });

  it("no renames → profiles unchanged", () => {
    const p = profile({ doughName: "Sheet Dough" });
    const out = repointProfileNamedRecipes([p], []);
    expect(out).toEqual([p]);
  });
});

// ---------------------------------------------------------------------------
// 2. Pipeline — a RE-import applies learned recipeName aliases to profile
//    dough/sauce assignments, even when the recipe is absent from the sheet.
// ---------------------------------------------------------------------------

const { parseSpy, aliasesSpy } = vi.hoisted(() => ({
  parseSpy: vi.fn(),
  aliasesSpy: vi.fn(),
}));

vi.mock("./storage", () => ({
  loadSpecImportKnown: () => ({ ...EMPTY_KNOWN }),
  profileExistsForImport: () => false,
  recipeExistsForImport: () => false,
  importProfileIsTombstoned: () => false,
  recipeNameIsTombstoned: () => false,
  applySpecImport: () => {},
}));
vi.mock("./specImportAliases", () => ({
  fetchSpecImportAliases: aliasesSpy,
  saveSpecImportAliases: async () => {},
}));
vi.mock("./savedSpecSheets", () => ({
  saveSpecSheet: async () => {},
  buildSpecSheetLabel: () => "",
  deriveSourceKey: () => "",
  loadCurrentReconcileRecipes: () => [],
}));
vi.mock("./parseSpecSheet", () => ({ requestParseSpecSheet: parseSpy }));
vi.mock("./matchImport", () => ({
  requestMatchImport: async () => {
    throw new Error("no AI matcher in tests");
  },
}));
vi.mock("./aiCorrections", () => ({ saveAiCorrections: async () => {} }));
vi.mock("./cheeseRecipes", () => ({
  fetchCheeseRecipes: async () => [],
  saveCheeseRecipes: async (items: unknown[]) => items,
}));
vi.mock("./mixes", () => ({
  fetchMixes: async () => [],
  saveMixes: async (items: unknown[]) => items,
}));

import { prepareSpecImport } from "./specImport";

// Sheet carries ONLY a profile naming the raw dough/sauce labels — the recipes
// themselves are NOT in this sheet (the "name-only re-import" worst case).
function fixtureParse(): ParsedSpecImport {
  return {
    profiles: [
      profile({ doughName: "Sheet Dough", sauceName: "Sheet Sauce" }),
    ],
    recipes: [],
  };
}

beforeEach(() => {
  parseSpy.mockReset();
  parseSpy.mockImplementation(async () => fixtureParse());
  aliasesSpy.mockReset();
  aliasesSpy.mockImplementation(async () => []);
});

describe("prepareSpecImport — learned recipeName aliases apply to profile assignments", () => {
  it("rewrites doughName/sauceName from learned aliases (recipe absent from sheet)", async () => {
    const learned: SpecImportAlias[] = [
      { kind: "recipeName", externalName: "Sheet Dough", canonicalName: "House Dough", context: "dough" },
      { kind: "recipeName", externalName: "sheet sauce", canonicalName: "House Marinara", context: "sauce" },
    ];
    aliasesSpy.mockImplementation(async () => learned);

    const prepared = await prepareSpecImport(goodBuffer());
    expect(prepared.parsed.profiles[0].doughName).toBe("House Dough");
    expect(prepared.parsed.profiles[0].sauceName).toBe("House Marinara");
  });

  it("context matters: a sauce-context alias never rewrites doughName", async () => {
    aliasesSpy.mockImplementation(async () => [
      { kind: "recipeName", externalName: "Sheet Dough", canonicalName: "House Marinara", context: "sauce" },
    ] satisfies SpecImportAlias[]);

    const prepared = await prepareSpecImport(goodBuffer());
    expect(prepared.parsed.profiles[0].doughName).toBe("Sheet Dough");
  });

  it("no aliases → raw sheet names kept untouched", async () => {
    const prepared = await prepareSpecImport(goodBuffer());
    expect(prepared.parsed.profiles[0].doughName).toBe("Sheet Dough");
    expect(prepared.parsed.profiles[0].sauceName).toBe("Sheet Sauce");
  });

  it("conflicting (cyclic) aliases are dropped, not applied", async () => {
    aliasesSpy.mockImplementation(async () => [
      { kind: "recipeName", externalName: "Sheet Dough", canonicalName: "House Dough", context: "dough" },
      { kind: "recipeName", externalName: "House Dough", canonicalName: "Sheet Dough", context: "dough" },
    ] satisfies SpecImportAlias[]);

    const prepared = await prepareSpecImport(goodBuffer());
    expect(prepared.parsed.profiles[0].doughName).toBe("Sheet Dough");
  });
});
