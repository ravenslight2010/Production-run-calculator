// @vitest-environment node
//
// Orchestration regression for the re-import prune: commitSpecImport must diff
// the incoming (already canonicalized) parse against the PREVIOUS saved
// spec-sheet snapshot for the SAME source file (matched by sourceKey) and hand
// applySpecImport only what actually changed — so manual edits made since the
// last import survive a re-import. It must also:
//   • save the FULL unpruned parse as the new snapshot (never the pruned one),
//     or the next re-import would mis-diff;
//   • fall back to the previous full-apply behavior when no snapshot matches
//     the sourceKey (different file) or the snapshot fetch fails.
// The pure diff logic itself is covered in
// lib/spec-import/src/pruneAgainstSnapshot.test.ts — this locks the wiring.

import { describe, it, expect, vi, beforeEach } from "vitest";
import type {
  ParsedSpecImport,
  ParsedProfile,
  ParsedRecipe,
} from "@workspace/spec-import";
import type { CheeseRecipe } from "@workspace/cheese-recipes";
import type { Mix } from "@workspace/mixes";

const BRAND = "Aldo's";

function fixtureProfile(over: Partial<ParsedProfile> = {}): ParsedProfile {
  return {
    brand: BRAND,
    flavor: "Cheese",
    dieType: "12 inch",
    sauceOzPerPizza: 4,
    applicators: [{ type: "Mozzarella", ozPerPizza: 5 }],
    pepperonis: [],
    ...over,
  };
}

function fixtureRecipe(over: Partial<ParsedRecipe> = {}): ParsedRecipe {
  return {
    kind: "sauce",
    name: "House Marinara",
    rows: [{ ingredient: "Crushed Tomato", lbs: 20 }],
    ...over,
  };
}

function fixtureParse(): ParsedSpecImport {
  return { profiles: [fixtureProfile()], recipes: [fixtureRecipe()] };
}

const { applySpy, saveSheetSpy, fetchSheetsSpy } = vi.hoisted(() => ({
  applySpy: vi.fn(),
  saveSheetSpy: vi.fn(async () => {}),
  fetchSheetsSpy: vi.fn(async () => [] as unknown[]),
}));

vi.mock("./storage", () => ({
  loadSpecImportKnown: () => ({}),
  profileExistsForImport: () => false,
  recipeExistsForImport: () => false,
  importProfileIsTombstoned: () => false,
  recipeNameIsTombstoned: () => false,
  applySpecImport: applySpy,
}));
vi.mock("./specImportAliases", () => ({
  fetchSpecImportAliases: async () => [],
  saveSpecImportAliases: async () => {},
}));
vi.mock("./savedSpecSheets", () => ({
  saveSpecSheet: saveSheetSpy,
  fetchSavedSpecSheets: fetchSheetsSpy,
  buildSpecSheetLabel: () => "Sheet",
  // Real derivation shape doesn't matter here — commit only needs a stable,
  // non-empty key per source-name list.
  deriveSourceKey: (names: string[]) => names.join("|").toLowerCase(),
  loadCurrentReconcileRecipes: () => [],
}));
vi.mock("./parseSpecSheet", () => ({ requestParseSpecSheet: vi.fn() }));
vi.mock("./matchImport", () => ({
  requestMatchImport: async () => {
    throw new Error("no AI matcher in tests");
  },
}));
vi.mock("./aiCorrections", () => ({ saveAiCorrections: async () => {} }));
vi.mock("./cheeseRecipes", () => ({
  fetchCheeseRecipes: async () => [] as CheeseRecipe[],
  saveCheeseRecipes: async (items: CheeseRecipe[]) => items,
}));
vi.mock("./mixes", () => ({
  fetchMixes: async () => [] as Mix[],
  saveMixes: async (items: Mix[]) => items,
}));

import { commitSpecImport } from "./specImport";

function preparedOf(parsed: ParsedSpecImport, sourceNames: string[]) {
  return {
    parsed,
    newAliases: [],
    sourceNames,
  } as unknown as Parameters<typeof commitSpecImport>[0];
}

function sheetOf(data: ParsedSpecImport, sourceKey: string, createdAt: number, id = 1) {
  return { id, label: "Prev", sourceKey, createdAt, data };
}

beforeEach(() => {
  applySpy.mockReset();
  saveSheetSpy.mockClear();
  fetchSheetsSpy.mockReset();
  fetchSheetsSpy.mockResolvedValue([]);
});

describe("commitSpecImport re-import prune wiring", () => {
  it("prunes unchanged content against the matching previous snapshot", async () => {
    const names = ["specs.xlsx"];
    fetchSheetsSpy.mockResolvedValue([sheetOf(fixtureParse(), "specs.xlsx", 100)]);

    // Same file re-imported with ONE scalar changed; recipe identical.
    const reimport: ParsedSpecImport = {
      profiles: [fixtureProfile({ sauceOzPerPizza: 6 })],
      recipes: [fixtureRecipe()],
    };
    await commitSpecImport(preparedOf(reimport, names));

    expect(applySpy).toHaveBeenCalledTimes(1);
    const applied = applySpy.mock.calls[0][0] as ParsedSpecImport;
    const prof = applied.profiles[0];
    expect(prof.sauceOzPerPizza).toBe(6); // the real change survives
    expect(prof.dieType).toBeUndefined(); // unchanged scalar pruned
    expect(prof.applicators).toEqual([]); // unchanged applicators pruned
    expect(applied.recipes[0].referenceOnly).toBe(true); // unchanged recipe demoted

    // New snapshot must be the FULL unpruned parse.
    const savedParsed = saveSheetSpy.mock.calls[0][1] as ParsedSpecImport;
    expect(savedParsed.profiles[0].dieType).toBe("12 inch");
    expect(savedParsed.recipes[0].referenceOnly).toBeUndefined();
  });

  it("uses the NEWEST snapshot when several match the sourceKey", async () => {
    const names = ["specs.xlsx"];
    const older = fixtureParse(); // matches incoming → would prune everything
    const newer: ParsedSpecImport = {
      profiles: [fixtureProfile({ sauceOzPerPizza: 9 })],
      recipes: [fixtureRecipe()],
    };
    fetchSheetsSpy.mockResolvedValue([
      sheetOf(older, "specs.xlsx", 100, 1),
      sheetOf(newer, "specs.xlsx", 200, 2),
    ]);

    await commitSpecImport(preparedOf(fixtureParse(), names));
    const applied = applySpy.mock.calls[0][0] as ParsedSpecImport;
    // vs the NEWER snapshot, sauceOzPerPizza (4 vs 9) IS a change and is kept.
    expect(applied.profiles[0].sauceOzPerPizza).toBe(4);
  });

  it("applies the full parse when no snapshot matches the sourceKey (different file)", async () => {
    fetchSheetsSpy.mockResolvedValue([sheetOf(fixtureParse(), "other-file.xlsx", 100)]);

    const parsed = fixtureParse();
    await commitSpecImport(preparedOf(parsed, ["specs.xlsx"]));

    const applied = applySpy.mock.calls[0][0] as ParsedSpecImport;
    expect(applied.profiles[0].dieType).toBe("12 inch");
    expect(applied.profiles[0].applicators).toHaveLength(1);
    expect(applied.recipes[0].referenceOnly).toBeUndefined();
  });

  it("applies the full parse when the snapshot fetch fails (best-effort)", async () => {
    fetchSheetsSpy.mockRejectedValue(new Error("offline"));

    const parsed = fixtureParse();
    await commitSpecImport(preparedOf(parsed, ["specs.xlsx"]));

    const applied = applySpy.mock.calls[0][0] as ParsedSpecImport;
    expect(applied.profiles[0].dieType).toBe("12 inch");
    expect(applied.recipes[0].referenceOnly).toBeUndefined();
  });
});
