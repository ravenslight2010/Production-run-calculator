// @vitest-environment node
//
// Regression guard: commitSpecImport must return aliasSaveFailed=true when the
// alias POST (/api/spec-import-aliases) throws, so the caller (handleSpecImportConfirm
// in home.tsx) can surface the "Import applied — mappings not remembered" warning
// toast instead of silently dropping the learned name mappings.
//
// Scope: unit test of commitSpecImport — we simulate the failed POST by making
// saveSpecImportAliases reject, then assert the returned flag. The import itself
// must still succeed (aliasSaveFailed is non-blocking).

import { describe, it, expect, vi, beforeEach } from "vitest";
import type {
  ParsedSpecImport,
  ParsedProfile,
  SpecImportAlias,
} from "@workspace/spec-import";
import type { CheeseRecipe } from "@workspace/cheese-recipes";
import type { Mix } from "@workspace/mixes";

// ---------------------------------------------------------------------------
// Spies — hoisted so vi.mock factories can close over them.
// ---------------------------------------------------------------------------

const { saveAliasesSpy } = vi.hoisted(() => ({
  saveAliasesSpy: vi.fn<[SpecImportAlias[]], Promise<void>>(async () => {}),
}));

// ---------------------------------------------------------------------------
// Module mocks — same collaborator shape as specImportAutoLinkAlias.test.ts
// ---------------------------------------------------------------------------

vi.mock("./storage", () => ({
  loadSpecImportKnown: () => ({}),
  profileExistsForImport: () => false,
  recipeExistsForImport: () => false,
  importProfileIsTombstoned: () => false,
  recipeNameIsTombstoned: () => false,
  applySpecImport: () => ({ touchedProfiles: [], crustProfiles: [] }),
}));
vi.mock("./specImportAliases", () => ({
  fetchSpecImportAliases: async () => [],
  saveSpecImportAliases: saveAliasesSpy,
}));
vi.mock("./savedSpecSheets", () => ({
  saveSpecSheet: async () => {},
  fetchSavedSpecSheets: async () => [],
  buildSpecSheetLabel: () => "Sheet",
  deriveSourceKey: () => "test-brand",
  selectPruneSnapshots: () => [],
  loadCurrentReconcileRecipes: () => [],
}));
vi.mock("./parseSpecSheet", () => ({
  requestParseSpecSheet: vi.fn(),
  makeParseCallPacer: () => async () => {},
  ParseSpecRateLimitError: class extends Error {},
  PARSE_RATE_WINDOW_MS: 62_000,
}));
vi.mock("./matchImport", () => ({
  requestMatchImport: async () => {
    throw new Error("no AI matcher in tests");
  },
}));
vi.mock("./aiCorrections", () => ({ saveAiCorrections: async () => {} }));
vi.mock("./namedRecipes", () => ({
  fetchNamedRecipes: async () => {
    throw new Error("no pool in tests");
  },
  saveNamedRecipes: async () => {},
  addNamedRecipesToServerIfAbsent: async () => {},
}));
vi.mock("./cheeseRecipes", () => ({
  fetchCheeseRecipes: async () => [] as CheeseRecipe[],
  saveCheeseRecipes: async (items: CheeseRecipe[]) => items,
}));
vi.mock("./mixes", () => ({
  fetchMixes: async () => [] as Mix[],
  saveMixes: async (items: Mix[]) => items,
}));
vi.mock("./dieLineDefaultsServer", () => ({
  fetchDieLineDefaults: async () => [],
  toOverridesMap: () => ({}),
}));

import { commitSpecImport } from "./specImport";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fixtureProfile(): ParsedProfile {
  return { brand: "Test Brand", flavor: "Cheese", applicators: [], pepperonis: [] };
}

function fixtureParse(): ParsedSpecImport {
  return { profiles: [fixtureProfile()], recipes: [] };
}

/**
 * A single non-poisoned brand alias — sanitizeSpecAliases passes it through,
 * so saveSpecImportAliases will be called.
 */
function oneValidAlias(): SpecImportAlias {
  return {
    kind: "brand",
    externalName: "Old Brand",
    canonicalName: "New Brand",
  };
}

function preparedOf(
  parsed: ParsedSpecImport,
  newAliases: SpecImportAlias[] = [],
) {
  return {
    parsed,
    newAliases,
    sourceNames: ["test.xlsx"],
  } as unknown as Parameters<typeof commitSpecImport>[0];
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  saveAliasesSpy.mockClear();
  saveAliasesSpy.mockResolvedValue(undefined); // default: save succeeds
});

describe("commitSpecImport aliasSaveFailed flag", () => {
  it("returns aliasSaveFailed=false when there are no new aliases to save", async () => {
    // No aliases → saveSpecImportAliases is never called → no failure possible.
    const result = await commitSpecImport(preparedOf(fixtureParse(), []));
    expect(result.aliasSaveFailed).toBe(false);
    expect(saveAliasesSpy).not.toHaveBeenCalled();
  });

  it("returns aliasSaveFailed=false when the alias POST succeeds", async () => {
    saveAliasesSpy.mockResolvedValue(undefined);
    const result = await commitSpecImport(
      preparedOf(fixtureParse(), [oneValidAlias()]),
    );
    expect(result.aliasSaveFailed).toBe(false);
    expect(saveAliasesSpy).toHaveBeenCalledOnce();
  });

  it("returns aliasSaveFailed=true when the alias POST throws a network error", async () => {
    // Simulate a failed POST to /api/spec-import-aliases.
    saveAliasesSpy.mockRejectedValue(new Error("Network error"));

    const result = await commitSpecImport(
      preparedOf(fixtureParse(), [oneValidAlias()]),
    );

    // The import itself must have applied (no throw from commitSpecImport).
    expect(result.aliasSaveFailed).toBe(true);
    // saveSpecImportAliases was attempted.
    expect(saveAliasesSpy).toHaveBeenCalledOnce();
  });

  it("still applies the import successfully when the alias POST fails", async () => {
    saveAliasesSpy.mockRejectedValue(new Error("500 Internal Server Error"));

    // Should resolve (not reject) even though alias save failed.
    await expect(
      commitSpecImport(preparedOf(fixtureParse(), [oneValidAlias()])),
    ).resolves.toMatchObject({
      aliasSaveFailed: true,
      touchedProfiles: expect.any(Array),
    });
  });

  it("returns aliasSaveFailed=false when all aliases are filtered out by sanitization", async () => {
    // A poisoned alias (externalName === canonicalName) is stripped by
    // sanitizeSpecAliases, so savableAliases.length === 0 → no POST → no failure.
    const poisonedAlias: SpecImportAlias = {
      kind: "brand",
      externalName: "Same Brand",
      canonicalName: "Same Brand", // same → filtered out
    };
    saveAliasesSpy.mockRejectedValue(new Error("should not be called"));

    const result = await commitSpecImport(
      preparedOf(fixtureParse(), [poisonedAlias]),
    );
    expect(result.aliasSaveFailed).toBe(false);
    expect(saveAliasesSpy).not.toHaveBeenCalled();
  });
});
