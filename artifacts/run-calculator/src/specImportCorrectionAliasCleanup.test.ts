// @vitest-environment jsdom
//
// Bad-alias cleanup after a CORRECTING re-import (task: clean up spec-import
// aliases that keep re-applying a wrong name).
//
// Two layers under test:
//   1. applySpecImport DETECTION — when the sheet overwrites a DIFFERENT
//      previously stored name (profile sauce/dough link, mix/cheese slot
//      link, recipe ingredient row), the correction is reported through
//      out.nameCorrections.
//   2. commitSpecImport CLEANUP — for each correction, the bad alias
//      (spec raw label -> old wrong name) is DELETED via the alias API
//      unless the old name is a live pool entry, and the REVERSE mapping
//      (old wrong name -> correct name) is learned as an alias AND mirrored
//      into the AI corrections pool.

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SpecImportAlias } from "@workspace/spec-import";

// ── Spies / in-memory stores shared by the module mocks ─────────────────────
const {
  saveAliasSpy,
  deleteAliasSpy,
  saveAiCorrectionsSpy,
  applySpecImportMock,
  namedPools,
  namedPoolsFail,
  mixesStore,
  cheeseStore,
} = vi.hoisted(() => ({
  saveAliasSpy: vi.fn(async (_rows: unknown[]) => {}),
  deleteAliasSpy: vi.fn(async (_rows: unknown[]) => {}),
  saveAiCorrectionsSpy: vi.fn(async (_rows: unknown[]) => {}),
  applySpecImportMock: vi.fn(),
  namedPools: { dough: [] as unknown[], sauce: [] as unknown[] },
  namedPoolsFail: { value: false },
  mixesStore: { rows: [] as Array<{ name: string }> },
  cheeseStore: { rows: [] as Array<{ name: string; components?: Array<{ ingredient: string }> }> },
}));

vi.mock("./specImportAliases", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./specImportAliases")>();
  return {
    ...actual,
    fetchSpecImportAliases: async () => [],
    saveSpecImportAliases: saveAliasSpy,
    deleteSpecImportAliases: deleteAliasSpy,
  };
});
vi.mock("./aiCorrections", () => ({ saveAiCorrections: saveAiCorrectionsSpy }));
vi.mock("./profileServerSync", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./profileServerSync")>();
  return {
    ...actual,
    markProfileEdited: () => {},
    markProfileForceEdited: () => {},
    // Never push profiles to the server from this test.
    flushProfilePushQueue: async () => {},
  };
});
vi.mock("./savedSpecSheets", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./savedSpecSheets")>();
  return {
    ...actual,
    saveSpecSheet: async () => {},
    fetchSavedSpecSheets: async () => [],
    buildSpecSheetLabel: () => "Sheet",
    loadCurrentReconcileRecipes: () => [],
  };
});
vi.mock("./mixes", () => ({
  fetchMixes: async () => [...mixesStore.rows],
  saveMixes: async (items: unknown[]) => items,
}));
vi.mock("./cheeseRecipes", () => ({
  fetchCheeseRecipes: async () => [...cheeseStore.rows],
  saveCheeseRecipes: async (items: unknown[]) => items,
}));
vi.mock("./namedRecipes", () => ({
  fetchNamedRecipes: async (kind: "dough" | "sauce") => {
    if (namedPoolsFail.value) throw new Error("offline");
    return [...(namedPools[kind] ?? [])];
  },
  saveNamedRecipes: async (_k: string, items: unknown[]) => items,
  addNamedRecipesToServerIfAbsent: async () => ({ added: 0 }),
}));
vi.mock("./dieLineDefaultsServer", () => ({
  fetchDieLineDefaults: async () => [],
  toOverridesMap: () => ({}),
}));
vi.mock("./mergeSuggest", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./mergeSuggest")>();
  return { ...actual, fetchMergeAliases: async () => [] };
});
// The commit's applySpecImport is mocked so tests can inject nameCorrections
// directly; the REAL applySpecImport detection is covered by the detection
// describe below via a direct (unmocked) import of ./storage in an isolated
// dynamic import... instead we keep detection tests on the real function by
// NOT mocking ./storage (commitSpecImport reads applySpecImport from it).
vi.mock("./storage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./storage")>();
  return { ...actual, applySpecImport: applySpecImportMock };
});

import { commitSpecImport } from "./specImport";
import type { SpecImportNameCorrection } from "./storage";

// Real detection logic, unmocked (vi.importActual bypasses the mock above).
const realStorage = await vi.importActual<typeof import("./storage")>("./storage");

beforeEach(() => {
  localStorage.clear();
  saveAliasSpy.mockClear();
  deleteAliasSpy.mockClear();
  saveAiCorrectionsSpy.mockClear();
  applySpecImportMock.mockReset();
  namedPools.dough = [];
  namedPools.sauce = [];
  mixesStore.rows = [];
  cheeseStore.rows = [];
});

// ── 1. Detection: real applySpecImport reports corrections ──────────────────
describe("applySpecImport name-correction detection", () => {
  it("reports a profile sauce/dough name overwrite as a recipeName correction", () => {
    realStorage.saveProfile("Aldo's", "Cheese", {
      frontlineRecipeName: "Wrong Sauce",
      doughRecipeName: "Wrong Dough",
    } as never);
    const out: { nameCorrections?: SpecImportNameCorrection[] } = {};
    realStorage.applySpecImport(
      {
        profiles: [
          {
            brand: "Aldo's",
            flavor: "Cheese",
            sauceName: "Aldo Pizza Sauce",
            doughName: "Aldo Dough",
            applicators: [],
            pepperonis: [],
          },
        ],
        recipes: [],
      },
      out,
    );
    const corr = out.nameCorrections ?? [];
    expect(corr).toContainEqual({
      kind: "recipeName",
      context: "sauce",
      specRawName: "Aldo Pizza Sauce",
      oldName: "Wrong Sauce",
      newName: "Aldo Pizza Sauce",
    });
    expect(corr).toContainEqual({
      kind: "recipeName",
      context: "dough",
      specRawName: "Aldo Dough",
      oldName: "Wrong Dough",
      newName: "Aldo Dough",
    });
  });

  it("does NOT report a correction when the stored name already matches (case-insensitive)", () => {
    realStorage.saveProfile("Aldo's", "Cheese", {
      frontlineRecipeName: "ALDO PIZZA SAUCE",
    } as never);
    const out: { nameCorrections?: SpecImportNameCorrection[] } = {};
    realStorage.applySpecImport(
      {
        profiles: [
          {
            brand: "Aldo's",
            flavor: "Cheese",
            sauceName: "Aldo Pizza Sauce",
            applicators: [],
            pepperonis: [],
          },
        ],
        recipes: [],
      },
      out,
    );
    expect(out.nameCorrections ?? []).toEqual([]);
  });

  it("reports a positional ingredient rename (same rows, same lbs) as an ingredient correction", () => {
    localStorage.setItem(
      "run-calc-dough-recipe-presets",
      JSON.stringify({
        "Aldo Dough": {
          rows: [
            { ingredient: "Flour", lbs: 50 },
            { ingredient: "Salt", lbs: 2 },
          ],
        },
      }),
    );
    const out: { nameCorrections?: SpecImportNameCorrection[] } = {};
    realStorage.applySpecImport(
      {
        profiles: [],
        recipes: [
          {
            kind: "dough",
            name: "Aldo Dough",
            rows: [
              { ingredient: "Flour", lbs: 50 },
              { ingredient: "Fine Sea Salt", lbs: 2 },
            ],
          },
        ],
      },
      out,
    );
    expect(out.nameCorrections ?? []).toContainEqual({
      kind: "doughIngredient",
      context: null,
      specRawName: "Fine Sea Salt",
      oldName: "Salt",
      newName: "Fine Sea Salt",
    });
  });

  it("stays silent on ingredient rows whose lbs changed too (a row edit, not a rename)", () => {
    localStorage.setItem(
      "run-calc-dough-recipe-presets",
      JSON.stringify({ "Aldo Dough": { rows: [{ ingredient: "Salt", lbs: 2 }] } }),
    );
    const out: { nameCorrections?: SpecImportNameCorrection[] } = {};
    realStorage.applySpecImport(
      {
        profiles: [],
        recipes: [
          { kind: "dough", name: "Aldo Dough", rows: [{ ingredient: "Fine Sea Salt", lbs: 5 }] },
        ],
      },
      out,
    );
    expect(out.nameCorrections ?? []).toEqual([]);
  });
});

// ── 2. Commit cleanup: delete bad alias, learn reverse mapping ───────────────
function preparedWithNoAliases() {
  return {
    parsed: { profiles: [], recipes: [] },
    summary: { profiles: 0, recipes: 0 },
    newAliases: [] as SpecImportAlias[],
    flagged: [],
    discrepancies: [],
    skipped: [],
    brands: [],
    flavorsByBrand: {},
    aliasLinkSuggestions: {},
  } as never;
}

const SAUCE_CORRECTION: SpecImportNameCorrection = {
  kind: "recipeName",
  context: "sauce",
  specRawName: "Aldo Pizza Sauce",
  oldName: "Wrong Sauce",
  newName: "Aldo Pizza Sauce",
};

function injectCorrections(corrections: SpecImportNameCorrection[]) {
  applySpecImportMock.mockImplementation(
    (_parsed: unknown, out?: { nameCorrections?: SpecImportNameCorrection[] }) => {
      if (out) out.nameCorrections = [...corrections];
      return { touchedProfiles: [], crustProfiles: [] };
    },
  );
}

describe("commitSpecImport bad-alias cleanup", () => {
  it("(a) deletes the bad alias (spec raw name -> old wrong name) when the old name has no live pool entry", async () => {
    injectCorrections([SAUCE_CORRECTION]);
    namedPools.sauce = [{ name: "Aldo Pizza Sauce", components: [] }];
    await commitSpecImport(preparedWithNoAliases());
    expect(deleteAliasSpy).toHaveBeenCalledTimes(1);
    expect(deleteAliasSpy.mock.calls[0][0]).toEqual([
      {
        kind: "recipeName",
        externalName: "Aldo Pizza Sauce",
        canonicalName: "Wrong Sauce",
        context: "sauce",
      },
    ]);
  });

  it("(b) writes the reverse alias old-wrong-name -> correct-name", async () => {
    injectCorrections([SAUCE_CORRECTION]);
    await commitSpecImport(preparedWithNoAliases());
    expect(saveAliasSpy).toHaveBeenCalledTimes(1);
    expect(saveAliasSpy.mock.calls[0][0]).toContainEqual({
      kind: "recipeName",
      externalName: "Wrong Sauce",
      canonicalName: "Aldo Pizza Sauce",
      context: "sauce",
    });
  });

  it("(c) does NOT delete the bad alias when the old name is a live pool entry — but still learns the reverse alias", async () => {
    injectCorrections([SAUCE_CORRECTION]);
    // "Wrong Sauce" is a real, different recipe in the live sauce pool.
    namedPools.sauce = [
      { name: "Wrong Sauce", components: [] },
      { name: "Aldo Pizza Sauce", components: [] },
    ];
    await commitSpecImport(preparedWithNoAliases());
    expect(deleteAliasSpy).not.toHaveBeenCalled();
    expect(saveAliasSpy).toHaveBeenCalledTimes(1);
    expect(saveAliasSpy.mock.calls[0][0]).toContainEqual({
      kind: "recipeName",
      externalName: "Wrong Sauce",
      canonicalName: "Aldo Pizza Sauce",
      context: "sauce",
    });
  });

  it("(d) mirrors the reverse mapping into the AI corrections pool", async () => {
    injectCorrections([SAUCE_CORRECTION]);
    await commitSpecImport(preparedWithNoAliases());
    expect(saveAiCorrectionsSpy).toHaveBeenCalledTimes(1);
    expect(saveAiCorrectionsSpy.mock.calls[0][0]).toContainEqual({
      domain: "item",
      fromText: "Wrong Sauce",
      toText: "Aldo Pizza Sauce",
    });
  });

  it("skips deletion when the relevant pool could not be fetched (liveness unknown)", async () => {
    injectCorrections([SAUCE_CORRECTION]);
    // Sauce pool fetch fails — commit can't prove the old name is dead.
    namedPoolsFail.value = true;
    try {
      await commitSpecImport(preparedWithNoAliases());
    } finally {
      namedPoolsFail.value = false;
    }
    expect(deleteAliasSpy).not.toHaveBeenCalled();
    // Reverse alias still learned.
    expect(saveAliasSpy).toHaveBeenCalledTimes(1);
  });

  it("does NOT delete a cheese-ingredient bad alias when the old ingredient still lives in a MIX component (cross-pool liveness)", async () => {
    const corr: SpecImportNameCorrection = {
      kind: "cheeseIngredient",
      context: null,
      specRawName: "Whole Milk Mozzarella",
      oldName: "Provolone Shred",
      newName: "Whole Milk Mozzarella",
    };
    injectCorrections([corr]);
    cheeseStore.rows = [{ name: "Blend A", components: [{ ingredient: "Whole Milk Mozzarella" }] }];
    // Old ingredient survives only inside a live MIX — deletion must be skipped.
    mixesStore.rows = [
      { name: "Topping Mix", components: [{ ingredient: "Provolone Shred" }] } as never,
    ];
    await commitSpecImport(preparedWithNoAliases());
    expect(deleteAliasSpy).not.toHaveBeenCalled();
    // Reverse alias still learned.
    expect(saveAliasSpy.mock.calls[0][0]).toContainEqual({
      kind: "cheeseIngredient",
      externalName: "Provolone Shred",
      canonicalName: "Whole Milk Mozzarella",
      context: null,
    });

    deleteAliasSpy.mockClear();
    saveAliasSpy.mockClear();
    // Gone from BOTH cheese and mix pools → deletion proceeds.
    mixesStore.rows = [{ name: "Topping Mix", components: [{ ingredient: "Whole Milk Mozzarella" }] } as never];
    await commitSpecImport(preparedWithNoAliases());
    expect(deleteAliasSpy).toHaveBeenCalledTimes(1);
  });

  it("deletes an ingredient bad alias only when the old ingredient is gone from every live pool recipe", async () => {
    const ingCorrection: SpecImportNameCorrection = {
      kind: "doughIngredient",
      context: null,
      specRawName: "Fine Sea Salt",
      oldName: "Kosher Salt Flakes",
      newName: "Fine Sea Salt",
    };
    injectCorrections([ingCorrection]);
    // Live dough pool still uses the old ingredient elsewhere → no deletion.
    namedPools.dough = [
      { name: "Other Dough", components: [{ ingredient: "Kosher Salt Flakes", lbs: 1 }] },
    ];
    await commitSpecImport(preparedWithNoAliases());
    expect(deleteAliasSpy).not.toHaveBeenCalled();

    deleteAliasSpy.mockClear();
    saveAliasSpy.mockClear();
    // Old ingredient no longer used anywhere → the bad alias is deleted.
    namedPools.dough = [{ name: "Other Dough", components: [{ ingredient: "Fine Sea Salt", lbs: 1 }] }];
    await commitSpecImport(preparedWithNoAliases());
    expect(deleteAliasSpy).toHaveBeenCalledTimes(1);
    expect(deleteAliasSpy.mock.calls[0][0]).toEqual([
      {
        kind: "doughIngredient",
        externalName: "Fine Sea Salt",
        canonicalName: "Kosher Salt Flakes",
        context: null,
      },
    ]);
  });
});
