// @vitest-environment node
//
// Unit tests for computeProfilesRemovedFromWorkbook — the helper that diffs the
// previous saved spec-sheet snapshot against the current parse to surface
// profiles that were in the workbook last time but are gone now. If the snapshot
// selection or key-comparison logic drifts (e.g. selectPruneSnapshots stops
// intersecting per-file, or profileKey encoding changes), the "No longer in
// this workbook" section silently disappears. These tests lock the behavior so
// that silent miss is caught rather than discovered in production.

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ParsedSpecImport, ParsedProfile, SpecImportAlias } from "@workspace/spec-import";
import type { CheeseRecipe } from "@workspace/cheese-recipes";
import type { Mix } from "@workspace/mixes";

// --- Hoisted spy refs ---------------------------------------------------------

const { tombstonedSpy, fetchSheetsSpy } = vi.hoisted(() => ({
  tombstonedSpy: vi.fn((_brand: string, _flavor: string) => false),
  fetchSheetsSpy: vi.fn(async () => [] as unknown[]),
}));

// --- Module mocks -------------------------------------------------------------

vi.mock("./storage", () => ({
  loadSpecImportKnown: () => ({}),
  profileExistsForImport: () => false,
  recipeExistsForImport: () => false,
  importProfileIsTombstoned: tombstonedSpy,
  recipeNameIsTombstoned: () => false,
  applySpecImport: vi.fn(),
  isNameDeleted: () => false,
  flavorNamespace: (brand: string, flavor: string) => `${brand}|${flavor}`,
}));

vi.mock("./specImportAliases", () => ({
  fetchSpecImportAliases: async () => [],
  saveSpecImportAliases: async () => {},
}));

vi.mock("./savedSpecSheets", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./savedSpecSheets")>();
  return {
    saveSpecSheet: vi.fn(async () => {}),
    fetchSavedSpecSheets: fetchSheetsSpy,
    buildSpecSheetLabel: () => "Sheet",
    deriveSourceKey: actual.deriveSourceKey,
    selectPruneSnapshots: actual.selectPruneSnapshots,
    selectReusableSnapshot: actual.selectReusableSnapshot,
    latestSourceKeyIds: actual.latestSourceKeyIds,
    loadCurrentReconcileRecipes: () => [],
  };
});

vi.mock("./parseSpecSheet", () => ({ requestParseSpecSheet: vi.fn() ,
  makeParseCallPacer: () => async () => {},
  ParseSpecRateLimitError: class extends Error {},
  PARSE_RATE_WINDOW_MS: 62_000,
}));
vi.mock("./matchImport", () => ({
  requestMatchImport: async () => { throw new Error("no AI matcher in tests"); },
}));
vi.mock("./aiCorrections", () => ({ saveAiCorrections: async () => {} }));

const { fetchNamedRecipesSpy } = vi.hoisted(() => ({
  fetchNamedRecipesSpy: vi.fn(async () => { throw new Error("no pool in tests"); }),
}));
vi.mock("./namedRecipes", () => ({
  fetchNamedRecipes: fetchNamedRecipesSpy,
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

// Import AFTER mocks are registered.
import { computeProfilesRemovedFromWorkbook } from "./specImport";

// --- Helpers ------------------------------------------------------------------

function profile(brand: string, flavor: string): ParsedProfile {
  return { brand, flavor, applicators: [], pepperonis: [] };
}

function snapshot(
  profiles: ParsedProfile[],
  sourceKey: string,
  id = 1,
  createdAt = 100,
) {
  const data: ParsedSpecImport = { profiles, recipes: [] };
  return { id, label: "Prev", sourceKey, createdAt, data };
}

function alias(
  kind: SpecImportAlias["kind"],
  externalName: string,
  canonicalName: string,
  context: string | null = null,
): SpecImportAlias {
  return { kind, externalName, canonicalName, context };
}

// --- Tests --------------------------------------------------------------------

beforeEach(() => {
  tombstonedSpy.mockReset().mockReturnValue(false);
  fetchSheetsSpy.mockReset().mockResolvedValue([]);
  fetchNamedRecipesSpy.mockReset().mockRejectedValue(new Error("no pool"));
});

describe("computeProfilesRemovedFromWorkbook", () => {
  it("returns [] when no names are given (no sourceKey derivable)", async () => {
    const result = await computeProfilesRemovedFromWorkbook([], [], []);
    expect(result).toEqual([]);
  });

  it("returns [] when there is no previous snapshot for this file", async () => {
    fetchSheetsSpy.mockResolvedValue([]);
    const result = await computeProfilesRemovedFromWorkbook(
      ["specs.xlsx"],
      [],
      [profile("Aldo", "Cheese")],
    );
    expect(result).toEqual([]);
  });

  it("returns [] when a snapshot exists but belongs to a different file", async () => {
    fetchSheetsSpy.mockResolvedValue([
      snapshot([profile("Aldo", "Cheese")], "other-file"),
    ]);
    const result = await computeProfilesRemovedFromWorkbook(
      ["specs.xlsx"],
      [],
      [],
    );
    expect(result).toEqual([]);
  });

  it("surfaces a profile that was in the previous snapshot but is absent from the current parse", async () => {
    fetchSheetsSpy.mockResolvedValue([
      snapshot([profile("Aldo", "Cheese"), profile("Aldo", "Pepperoni")], "specs"),
    ]);
    // Current parse only has Pepperoni — Cheese was removed from the workbook.
    const result = await computeProfilesRemovedFromWorkbook(
      ["specs.xlsx"],
      [],
      [profile("Aldo", "Pepperoni")],
    );
    expect(result).toEqual([{ brand: "Aldo", flavor: "Cheese" }]);
  });

  it("excludes a profile that is still present in the current parse", async () => {
    fetchSheetsSpy.mockResolvedValue([
      snapshot([profile("Aldo", "Cheese")], "specs"),
    ]);
    const result = await computeProfilesRemovedFromWorkbook(
      ["specs.xlsx"],
      [],
      [profile("Aldo", "Cheese")],
    );
    expect(result).toEqual([]);
  });

  it("excludes an already-tombstoned profile (user already removed it)", async () => {
    fetchSheetsSpy.mockResolvedValue([
      snapshot([profile("Aldo", "Cheese")], "specs"),
    ]);
    tombstonedSpy.mockImplementation(
      (brand, flavor) => brand === "Aldo" && flavor === "Cheese",
    );
    const result = await computeProfilesRemovedFromWorkbook(
      ["specs.xlsx"],
      [],
      [], // absent from current parse
    );
    expect(result).toEqual([]);
    expect(tombstonedSpy).toHaveBeenCalledWith("Aldo", "Cheese");
  });

  it("does NOT surface a profile when a brand alias maps the old name to the current brand (alias remapping)", async () => {
    // Snapshot contains "OldBrand / House Red". A brand alias learned after
    // the import maps "OldBrand" → "NewBrand". The current parse has
    // "NewBrand / House Red". Without alias remapping the helper would wrongly
    // report "OldBrand / House Red" as removed — alias remapping must prevent
    // that false positive.
    fetchSheetsSpy.mockResolvedValue([
      snapshot([profile("OldBrand", "House Red")], "specs"),
    ]);
    const aliases: SpecImportAlias[] = [
      alias("brand", "OldBrand", "NewBrand"),
    ];
    const result = await computeProfilesRemovedFromWorkbook(
      ["specs.xlsx"],
      aliases,
      [profile("NewBrand", "House Red")],
    );
    expect(result).toEqual([]);
  });

  it("DOES surface a profile when an alias remaps the brand but the flavor is still absent", async () => {
    // Snapshot has "OldBrand / Cheese" and "OldBrand / Pepperoni".
    // After brand alias OldBrand→NewBrand, the current parse only has
    // "NewBrand / Pepperoni" — "Cheese" is genuinely absent.
    fetchSheetsSpy.mockResolvedValue([
      snapshot(
        [profile("OldBrand", "Cheese"), profile("OldBrand", "Pepperoni")],
        "specs",
      ),
    ]);
    const aliases: SpecImportAlias[] = [alias("brand", "OldBrand", "NewBrand")];
    const result = await computeProfilesRemovedFromWorkbook(
      ["specs.xlsx"],
      aliases,
      [profile("NewBrand", "Pepperoni")],
    );
    expect(result).toEqual([{ brand: "NewBrand", flavor: "Cheese" }]);
  });

  it("returns [] when the only matching snapshot is from a different-set batch import", async () => {
    // Bug: file A was last imported as part of a batch (A+B), snapshot stored
    // under "alpha|specs". Re-importing A alone must NOT report profiles from B
    // as "removed from workbook" — we can't tell which profiles belonged to A
    // vs B in the batch snapshot. Exact file-set matching returns [] here.
    fetchSheetsSpy.mockResolvedValue([
      snapshot([profile("Aldo", "Cheese"), profile("Other", "Brand")], "alpha|specs", 1, 100),
    ]);
    const result = await computeProfilesRemovedFromWorkbook(
      ["specs.xlsx"],
      [],
      [], // all absent from new parse, but we can't know which file they came from
    );
    expect(result).toEqual([]);
  });

  it("surfaces a removed profile when a previous single-file snapshot exists for the same file", async () => {
    // When file A has its own single-file snapshot AND is re-imported alone,
    // profiles genuinely absent from the new parse are correctly surfaced.
    fetchSheetsSpy.mockResolvedValue([
      // Single-file snapshot — exact match
      snapshot([profile("Aldo", "Cheese"), profile("Aldo", "Pepperoni")], "specs", 1, 100),
    ]);
    const result = await computeProfilesRemovedFromWorkbook(
      ["specs.xlsx"],
      [],
      [profile("Aldo", "Pepperoni")], // Cheese is gone from the new parse
    );
    expect(result).toEqual([{ brand: "Aldo", flavor: "Cheese" }]);
  });

  it("unions ALL matching snapshots — a profile in an older snapshot is still considered previously present", async () => {
    // mergePruneSnapshots processes snapshots newest-first; the first-seen key
    // wins (dedup), but keys ONLY in the older snapshot are still collected.
    // A profile that appeared in an older (but still matching) snapshot and is
    // absent from the current parse IS surfaced as removed — not silently
    // dropped just because it wasn't in the newest snapshot.
    fetchSheetsSpy.mockResolvedValue([
      snapshot([profile("Aldo", "Cheese"), profile("Aldo", "Pepperoni")], "specs", 1, 100),
      snapshot([profile("Aldo", "Pepperoni")], "specs", 2, 200),
    ]);
    // Current parse only has Pepperoni — Cheese (from the older snapshot) is
    // absent and should be surfaced.
    const result = await computeProfilesRemovedFromWorkbook(
      ["specs.xlsx"],
      [],
      [profile("Aldo", "Pepperoni")],
    );
    expect(result).toEqual([{ brand: "Aldo", flavor: "Cheese" }]);
  });

  it("returns [] when the snapshot fetch fails (best-effort, never throws)", async () => {
    fetchSheetsSpy.mockRejectedValue(new Error("network error"));
    const result = await computeProfilesRemovedFromWorkbook(
      ["specs.xlsx"],
      [],
      [],
    );
    expect(result).toEqual([]);
  });

  it("deduplicates profiles with the same brand+flavor from the snapshot (case-insensitive)", async () => {
    // Snapshot has two entries that normalise to the same key (e.g. trailing
    // space), absent from the current parse. Should appear only once in the
    // result.
    fetchSheetsSpy.mockResolvedValue([
      snapshot([profile("Aldo ", "Cheese"), profile("Aldo", "Cheese ")], "specs"),
    ]);
    const result = await computeProfilesRemovedFromWorkbook(
      ["specs.xlsx"],
      [],
      [],
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ brand: "Aldo", flavor: "Cheese" });
  });

  it("returns results sorted alphabetically by brand then flavor", async () => {
    fetchSheetsSpy.mockResolvedValue([
      snapshot(
        [
          profile("Zeta", "Cheese"),
          profile("Alpha", "Pepperoni"),
          profile("Alpha", "Cheese"),
        ],
        "specs",
      ),
    ]);
    const result = await computeProfilesRemovedFromWorkbook(
      ["specs.xlsx"],
      [],
      [],
    );
    expect(result).toEqual([
      { brand: "Alpha", flavor: "Cheese" },
      { brand: "Alpha", flavor: "Pepperoni" },
      { brand: "Zeta", flavor: "Cheese" },
    ]);
  });
});
