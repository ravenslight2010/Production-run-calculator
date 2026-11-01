// @vitest-environment node
//
// Regression for exact-file parse reuse: re-importing a byte-identical file
// (same sourceKey + same SHA-256 sourceHash) must REUSE the previously saved
// snapshot's parse instead of re-running the AI. The AI's read of the same
// workbook can drift between calls (values swapping rows, a misread weight),
// and the re-import prune would treat that drift as real spec changes and
// clobber the user's data with it. Also locks:
//   • hashSpecImportSource determinism + multi-file order independence;
//   • selectReusableSnapshot exact-match-only selection (newest wins);
//   • commitSpecImport persisting the sourceHash with the new snapshot.

import { describe, it, expect, vi, beforeEach } from "vitest";
import * as XLSX from "xlsx";
import type { ParsedSpecImport, ParsedProfile } from "@workspace/spec-import";
import type { CheeseRecipe } from "@workspace/cheese-recipes";
import type { Mix } from "@workspace/mixes";
import {
  SYNTHETIC_REVIEW_FLAVORS,
  SYNTHETIC_REVIEW_BRAND,
  syntheticReviewParse,
  syntheticReviewWorkbook,
} from "../e2e/syntheticWorkbookReview";

function fixtureProfile(over: Partial<ParsedProfile> = {}): ParsedProfile {
  return {
    brand: "Aldo's",
    flavor: "Cheese",
    dieType: "12 inch",
    sauceOzPerPizza: 4,
    applicators: [{ type: "Mozzarella", ozPerPizza: 5 }],
    pepperonis: [],
    ...over,
  };
}

function fixtureParse(): ParsedSpecImport {
  return { profiles: [fixtureProfile()], recipes: [] };
}

const { parseSpy, matchSpy, saveSheetSpy, fetchSheetsSpy, applySpy, aliasesRef } = vi.hoisted(() => ({
  parseSpy: vi.fn(async () => {
    throw new Error("AI parse must not run on exact re-import");
  }),
  saveSheetSpy: vi.fn(async () => {}),
  matchSpy: vi.fn(async () => ({
    brandMatches: [],
    flavorMatches: [],
    ingredientMatches: [],
    appTypeMatches: [],
    pepTypeMatches: [],
  })),
  fetchSheetsSpy: vi.fn(async () => [] as unknown[]),
  applySpy: vi.fn(() => ({ touchedProfiles: [], crustProfiles: [] })),
  aliasesRef: { current: [] as unknown[] },
}));

vi.mock("./storage", () => ({
  loadSpecImportKnown: () => ({
    brands: [],
    flavorsByBrand: {},
    appTypes: [],
    pepTypes: [],
    cheeseIngredients: [],
    doughIngredients: [],
    sauceIngredients: [],
    sauceNames: [],
    dieTypes: [],
    doughNames: [],
    doughRecipes: [],
    sauceRecipes: [],
    cheeseRecipes: [],
  }),
  profileExistsForImport: () => false,
  recipeExistsForImport: () => false,
  importProfileIsTombstoned: () => false,
  recipeNameIsTombstoned: () => false,
  isNameDeleted: () => false,
  flavorNamespace: (brand: string) => `flavors:${brand}`,
  applySpecImport: applySpy,
}));
vi.mock("./specImportAliases", () => ({
  fetchSpecImportAliases: async () => aliasesRef.current,
  saveSpecImportAliases: async () => {},
}));
vi.mock("./savedSpecSheets", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./savedSpecSheets")>();
  return {
    ...actual,
    saveSpecSheet: saveSheetSpy,
    fetchSavedSpecSheets: fetchSheetsSpy,
    buildSpecSheetLabel: () => "Sheet",
    loadCurrentReconcileRecipes: () => [],
  };
});
vi.mock("./parseSpecSheet", () => ({
  requestParseSpecSheet: parseSpy,
  makeParseCallPacer: () => async () => {},
  ParseSpecRateLimitError: class extends Error {},
  ParseSpecAuthorizationError: class ParseSpecAuthorizationError extends Error {
    constructor() {
      super("AI parsing is not authorized");
      this.name = "ParseSpecAuthorizationError";
    }
  },
  PARSE_RATE_WINDOW_MS: 62_000,
}));
vi.mock("./matchImport", () => ({
  requestMatchImport: matchSpy,
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

import {
  prepareSpecImportWithAi,
  prepareSpecImportMultiWithAi,
  commitSpecImport,
  hashSpecImportSource,
} from "./specImport";
import { selectReusableSnapshot } from "./savedSpecSheets";

function bufOf(text: string): ArrayBuffer {
  const bytes = new TextEncoder().encode(text);
  const out = new ArrayBuffer(bytes.length);
  new Uint8Array(out).set(bytes);
  return out;
}

function workbookBytes(sheets: Record<string, unknown[][]>): ArrayBuffer {
  const workbook = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), name);
  }
  return XLSX.write(workbook, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
}

function aiProfile(brand: string, flavor: string, over: Partial<ParsedProfile> = {}): ParsedProfile {
  return { brand, flavor, applicators: [], pepperonis: [], ...over };
}

beforeEach(() => {
  parseSpy.mockReset();
  parseSpy.mockImplementation(async () => {
    throw new Error("AI parse must not run unless this test enables it");
  });
  matchSpy.mockReset();
  matchSpy.mockImplementation(async () => ({
    brandMatches: [],
    flavorMatches: [],
    ingredientMatches: [],
    appTypeMatches: [],
    pepTypeMatches: [],
  }));
  saveSheetSpy.mockClear();
  applySpy.mockReset();
  fetchSheetsSpy.mockReset();
  fetchSheetsSpy.mockResolvedValue([]);
  aliasesRef.current = [];
});

describe("synthetic browser workbook fallback eligibility", () => {
  it("enters actual AI preparation and returns all three invented profiles", async () => {
    parseSpy.mockImplementation(async () => syntheticReviewParse());
    const buffer = Uint8Array.from(syntheticReviewWorkbook()).buffer;
    const prepared = await prepareSpecImportWithAi(buffer, "synthetic-local-review.xlsx");
    expect(prepared.aiFallbackUnsupported).not.toBe(true);
    expect(parseSpy).toHaveBeenCalledTimes(1);
    expect(prepared.parsed.profiles.map((profile) => profile.flavor))
      .toEqual([...SYNTHETIC_REVIEW_FLAVORS]);
    expect(prepared.parsed.profiles.every((profile) => profile.brand === SYNTHETIC_REVIEW_BRAND))
      .toBe(true);
    expect(applySpy).not.toHaveBeenCalled();
    expect(saveSheetSpy).not.toHaveBeenCalled();
  });

  it("retains an eligible unresolved review without sending an AI request", async () => {
    const { prepareSpecImport } = await import("./specImport");
    const buffer = Uint8Array.from(syntheticReviewWorkbook()).buffer;
    const prepared = await prepareSpecImport(buffer, "synthetic-no-permission.xlsx", undefined, {
      allowAi: false,
    });
    expect(prepared.aiFallbackUnsupported).not.toBe(true);
    expect(prepared.aiFallbackGrids?.length).toBeGreaterThan(0);
    expect(parseSpy).not.toHaveBeenCalled();
    expect(applySpy).not.toHaveBeenCalled();
    expect(saveSheetSpy).not.toHaveBeenCalled();
  });
});

describe("hashSpecImportSource", () => {
  it("is deterministic and 64-char hex for a single file", async () => {
    const a1 = await hashSpecImportSource([bufOf("hello")]);
    const a2 = await hashSpecImportSource([bufOf("hello")]);
    expect(a1).toBe(a2);
    expect(a1).toMatch(/^[0-9a-f]{64}$/);
    expect(await hashSpecImportSource([bufOf("other")])).not.toBe(a1);
  });

  it("is order-independent for multi-file imports and distinct from singles", async () => {
    const ab = await hashSpecImportSource([bufOf("a"), bufOf("b")]);
    const ba = await hashSpecImportSource([bufOf("b"), bufOf("a")]);
    expect(ab).toBe(ba);
    expect(ab).not.toBe(await hashSpecImportSource([bufOf("a")]));
  });

  it("returns undefined for an empty file list", async () => {
    expect(await hashSpecImportSource([])).toBeUndefined();
  });

  // The fingerprint must be salted with the parse-pipeline version: when the
  // AI prompt/parse pipeline improves, old snapshots' hashes stop matching so
  // a re-import of the SAME bytes re-runs the improved parse instead of
  // resurrecting a stale parse. Without the salt, a single file's fingerprint
  // would equal its raw SHA-256 and prompt fixes would never reach re-imports.
  it("salts the fingerprint with the parse version (single-file hash != raw file hash)", async () => {
    const { createHash } = await import("node:crypto");
    const raw = createHash("sha256").update(Buffer.from("hello")).digest("hex");
    expect(await hashSpecImportSource([bufOf("hello")])).not.toBe(raw);
  });
});

describe("selectReusableSnapshot", () => {
  const snap = (id: number, sourceKey: string | null, sourceHash: string | null, createdAt: number) =>
    ({ id, sourceKey, sourceHash, createdAt });

  it("matches only exact sourceKey + sourceHash, newest first", () => {
    const sheets = [
      snap(1, "specs", "h1", 100),
      snap(2, "specs", "h1", 200),
      snap(3, "specs", "h2", 300), // same key, different bytes
      snap(4, "other", "h1", 400), // different file set
      snap(5, null, "h1", 500), // legacy, no key
      snap(6, "specs", null, 600), // legacy, no hash
    ];
    expect(selectReusableSnapshot(sheets, "specs", "h1")?.id).toBe(2);
    expect(selectReusableSnapshot(sheets, "specs", "h3")).toBeUndefined();
    expect(selectReusableSnapshot(sheets, "missing", "h1")).toBeUndefined();
  });

  it("never matches on blank key or hash (legacy snapshots stay unreusable)", () => {
    const sheets = [snap(1, "", "", 100), snap(2, null, null, 200)];
    expect(selectReusableSnapshot(sheets, "", "")).toBeUndefined();
    expect(selectReusableSnapshot(sheets, "specs", "")).toBeUndefined();
    expect(selectReusableSnapshot(sheets, "", "h1")).toBeUndefined();
  });
});

describe("exact re-import parse reuse", () => {
  it("single file: reuses the stored parse and never calls the AI", async () => {
    const data = bufOf("workbook-bytes");
    const hash = await hashSpecImportSource([bufOf("workbook-bytes")]);
    fetchSheetsSpy.mockResolvedValue([
      { id: 1, label: "Prev", sourceKey: "specs", sourceHash: hash, createdAt: 100, data: fixtureParse() },
    ]);

    const prepared = await prepareSpecImportWithAi(data, "Specs.xlsx");

    expect(parseSpy).not.toHaveBeenCalled();
    expect(prepared.parsed.profiles).toHaveLength(1);
    expect(prepared.parsed.profiles[0].sauceOzPerPizza).toBe(4);
    expect(prepared.sourceHash).toBe(hash);
    expect(prepared.newAliases).toEqual([]);
    expect(prepared.note).toMatch(/imported before/i);
  });

  it("remaps merged/renamed-away brands in the reused parse instead of resurrecting them", async () => {
    // Regression: reused snapshots skipped brand/flavor alias canonicalization,
    // so a re-import after a brand merge/rename resurrected the old brand (or
    // the tombstone partition silently dropped the profile).
    const data = bufOf("workbook-bytes");
    const hash = await hashSpecImportSource([bufOf("workbook-bytes")]);
    fetchSheetsSpy.mockResolvedValue([
      { id: 1, label: "Prev", sourceKey: "specs", sourceHash: hash, createdAt: 100, data: fixtureParse() },
    ]);
    aliasesRef.current = [
      { kind: "brand", externalName: "Aldo's", canonicalName: "Aldo Brothers", context: null },
    ];

    const prepared = await prepareSpecImportWithAi(data, "Specs.xlsx");

    expect(parseSpy).not.toHaveBeenCalled();
    expect(prepared.parsed.profiles).toHaveLength(1);
    expect(prepared.parsed.profiles[0].brand).toBe("Aldo Brothers");
    expect(prepared.parsed.profiles[0].flavor).toBe("Cheese");
  });

  it("single file: changed invalid bytes do not trigger a paid parse", async () => {
    const hash = await hashSpecImportSource([bufOf("old-bytes")]);
    fetchSheetsSpy.mockResolvedValue([
      { id: 1, label: "Prev", sourceKey: "specs", sourceHash: hash, createdAt: 100, data: fixtureParse() },
    ]);

    // Bytes differ → no reuse. The invalid workbook is not an AI candidate and
    // must return an actionable incomplete review without a provider request.
    const prepared = await prepareSpecImportWithAi(bufOf("new-bytes"), "Specs.xlsx");
    expect(parseSpy).not.toHaveBeenCalled();
    expect(prepared.unresolved).toHaveLength(1);
    expect(prepared.aiFallbackUnsupported).toBe(true);
  });

  it("multi file: reuses only for the SAME file set, before buffers are consumed", async () => {
    const bufs = [bufOf("file-a"), bufOf("file-b")];
    const hash = await hashSpecImportSource([bufOf("file-a"), bufOf("file-b")]);
    fetchSheetsSpy.mockResolvedValue([
      { id: 1, label: "Prev", sourceKey: "a|b", sourceHash: hash, createdAt: 100, data: fixtureParse() },
    ]);

    const seen: Array<[number, number]> = [];
    const prepared = await prepareSpecImportMultiWithAi(bufs, (d, t) => seen.push([d, t]), [
      "b.xlsx",
      "a.xlsx",
    ]);

    expect(parseSpy).not.toHaveBeenCalled();
    expect(prepared.sourceHash).toBe(hash);
    expect(seen).toEqual([[2, 2]]);

    // A single-file re-import from that batch must NOT reuse the batch
    // snapshot (its data is the merged whole-batch parse).
    const singleFile = await prepareSpecImportWithAi(bufOf("file-a"), "a.xlsx");
    expect(singleFile.unresolved).toHaveLength(1);
    expect(parseSpy).not.toHaveBeenCalled();
  });
});

describe("conditional automatic AI fallback", () => {
  it("keeps a complete deterministic workbook model-free for AI-authorized users", async () => {
    const data = workbookBytes({
      Products: [["Brand", "Flavor", "Die Type"], ["Fixture Brand", "Classic", "12 inch"]],
    });
    const prepared = await (await import("./specImport")).prepareSpecImport(
      data,
      "deterministic.xlsx",
      undefined,
      { allowAi: true },
    );

    expect(prepared.parsed.profiles).toMatchObject([
      { brand: "Fixture Brand", flavor: "Classic", dieType: "12 inch" },
    ]);
    expect(parseSpy).not.toHaveBeenCalled();
    expect(matchSpy).not.toHaveBeenCalled();
  });

  it("automatically interprets unresolved content with its workbook context", async () => {
    parseSpy.mockImplementation(async () => ({
      profiles: [
        aiProfile("Mauro's Pinsa", "PEPPERONI HONEY G"),
        aiProfile("Mauro's Pinsa", "TOMATO BASIL"),
        aiProfile("Mauro's Pinsa", "ITALIAN BEEF & GIARDINIERA"),
      ],
      recipes: [],
      generatedAt: 1,
    }) as never);
    const data = workbookBytes({
      "Native OZ": [["OZ PIZZA"], ["PEPPERONI HONEY G"], ["TOMATO BASIL"], ["ITALIAN BEEF & GIARDINIERA"]],
    });

    const prepared = await (await import("./specImport")).prepareSpecImport(
      data,
      "native.xlsx",
      undefined,
      { allowAi: true },
    );

    expect(parseSpy).toHaveBeenCalledTimes(1);
    expect((parseSpy.mock.calls[0][0] as { workbookText: string }).workbookText)
      .toContain("OZ PIZZA");
    expect(prepared.parsed.profiles.map((profile) => profile.flavor)).toEqual([
      "PEPPERONI HONEY G",
      "TOMATO BASIL",
      "ITALIAN BEEF & GIARDINIERA",
    ]);
    expect(prepared.unresolved).toBeUndefined();
  });

  it("preserves deterministic profile fields while adding AI-only products", async () => {
    parseSpy.mockImplementation(async () => ({
      profiles: [
        aiProfile("Fixture Brand", "Classic", { dieType: "10 inch" }),
        aiProfile("Fixture Brand", "Native Pizza"),
      ],
      recipes: [],
      generatedAt: 1,
    }) as never);
    const data = workbookBytes({
      Products: [["Brand", "Flavor", "Die Type"], ["Fixture Brand", "Classic", "12 inch"]],
      "Native OZ": [["OZ PIZZA"], ["Native Pizza"]],
    });

    const prepared = await (await import("./specImport")).prepareSpecImport(
      data,
      "mixed.xlsx",
      undefined,
      { allowAi: true },
    );

    expect(prepared.parsed.profiles).toHaveLength(2);
    const deterministic = prepared.parsed.profiles.find((profile) => profile.flavor === "Classic");
    expect(deterministic?.dieType).toBe("12 inch");
    expect(deterministic?.sourceLocations?.brand)
      .toEqual([{ sheet: "Products", cell: "A2" }]);
    expect(prepared.parsed.profiles.some((profile) => profile.flavor === "Native Pizza")).toBe(true);
  });

  it("keeps deterministic recipe values and source units while supplementing AI-only rows", async () => {
    parseSpy.mockImplementation(async () => ({
      profiles: [],
      recipes: [{
        kind: "dough",
        name: "House Dough",
        doughballOz: 99,
        doughballsPerTray: 99,
        rowsUnit: "oz",
        rows: [
          { ingredient: "Flour", lbs: 999 },
          { ingredient: "Water", lbs: 888 },
          { ingredient: "Supplemental", lbs: 2 },
        ],
      }],
      generatedAt: 1,
    }) as never);
    const data = workbookBytes({
      "Dough Recipes": [
        ["Recipe: House Dough"],
        ["Aldo Foods: Classic"],
        ["Target Doughball Weight (oz)", "8.25"],
        ["Doughballs Per Tray", "24"],
        ["Ingredient", "Lbs"],
        ["Flour", "10"],
        ["Water", "6.5"],
        [],
        ["Unsupported note", "manager should review"],
      ],
      "Native OZ": [["OZ PIZZA"], ["Native product"]],
    });

    const prepared = await (await import("./specImport")).prepareSpecImport(
      data,
      "mixed-recipe.xlsx",
      undefined,
      { allowAi: true },
    );

    const recipe = prepared.parsed.recipes.find((item) => item.name === "House Dough");
    expect(recipe?.doughballOz).toBe(8.25);
    expect(recipe?.doughballsPerTray).toBe(24);
    expect(recipe?.rowsUnit).toBe("Lbs");
    expect(recipe?.rows.map((row) => [row.ingredient, row.lbs])).toEqual([
      ["Flour", 10],
      ["Water", 6.5],
      ["Supplemental", 2],
    ]);
    expect(recipe?.sourceLocations?.rowsUnit).toEqual([
      { sheet: "Dough Recipes", cell: "B5" },
    ]);
  });

  it("does not call AI without permission and retains unresolved guidance", async () => {
    const data = workbookBytes({ "Native OZ": [["OZ PIZZA"], ["A product"]] });
    const prepared = await (await import("./specImport")).prepareSpecImport(data, "denied.xlsx");

    expect(parseSpy).not.toHaveBeenCalled();
    expect(prepared.unresolved?.length).toBeGreaterThan(0);
    expect(prepared.parsed.profiles).toHaveLength(0);
  });

  it("does not send a dedicated-importer workbook through spec AI", async () => {
    const data = workbookBytes({ Guide: [["PIZZA/BOX"], ["Shipping box"]] });
    const prepared = await (await import("./specImport")).prepareSpecImport(
      data,
      "Shipping_and_Palletizing_Guide.xlsx",
      undefined,
      { allowAi: true },
    );

    expect(parseSpy).not.toHaveBeenCalled();
    expect(prepared.aiFallbackUnsupported).toBe(true);
    expect(prepared.note).toMatch(/dedicated importer/i);
  });

  it("keeps multi-file AI context and results scoped to each selected workbook", async () => {
    parseSpy.mockImplementation(async ({ workbookText }: { workbookText: string }) => {
      const item = workbookText.includes("PRODUCT ALPHA") ? "PRODUCT ALPHA" : "PRODUCT BETA";
      return {
        profiles: [aiProfile(item.includes("ALPHA") ? "Brand Alpha" : "Brand Beta", item)],
        recipes: [],
        generatedAt: 1,
      } as never;
    });
    const first = workbookBytes({ Native: [["OZ PIZZA"], ["PRODUCT ALPHA"]] });
    const second = workbookBytes({ Native: [["OZ PIZZA"], ["PRODUCT BETA"]] });

    const prepared = await (await import("./specImport")).prepareSpecImportMulti(
      [first, second],
      undefined,
      ["same-revision-name.xlsx", "same-revision-name.xlsx"],
      undefined,
      { allowAi: true },
    );

    expect(parseSpy).toHaveBeenCalledTimes(2);
    expect((parseSpy.mock.calls[0][0] as { workbookText: string }).workbookText)
      .toContain("PRODUCT ALPHA");
    expect((parseSpy.mock.calls[1][0] as { workbookText: string }).workbookText)
      .toContain("PRODUCT BETA");
    expect(prepared.parsed.profiles.map((profile) => profile.flavor).sort())
      .toEqual(["PRODUCT ALPHA", "PRODUCT BETA"]);
  });

  it("retains an explicitly incomplete result for provider failure and empty output", async () => {
    const data = workbookBytes({ "Native OZ": [["OZ PIZZA"], ["A product"]] });
    parseSpy.mockRejectedValueOnce(new Error("AI provider unavailable"));
    const providerFailure = await (await import("./specImport")).prepareSpecImport(
      data,
      "provider-failure.xlsx",
      undefined,
      { allowAi: true },
    );
    expect(providerFailure.unresolved?.length).toBeGreaterThan(0);
    expect(providerFailure.note).toMatch(/did not complete/i);
    expect(providerFailure.note).toContain("AI provider unavailable");

    parseSpy.mockImplementationOnce(async () => ({
      profiles: [],
      recipes: [],
      generatedAt: 1,
    }) as never);
    const emptyResult = await (await import("./specImport")).prepareSpecImport(
      data,
      "empty-output.xlsx",
      undefined,
      { allowAi: true },
    );
    expect(emptyResult.unresolved?.length).toBeGreaterThan(0);
    expect(emptyResult.note).toMatch(/incomplete/i);
    expect(emptyResult.parsed.profiles).toHaveLength(0);
  });

  it("does not offer another AI retry after authorization is rejected", async () => {
    const { ParseSpecAuthorizationError } = await import("./parseSpecSheet");
    const data = workbookBytes({ "Native OZ": [["OZ PIZZA"], ["A product"]] });
    parseSpy.mockRejectedValueOnce(new ParseSpecAuthorizationError());

    const prepared = await (await import("./specImport")).prepareSpecImport(
      data,
      "authorization-denied.xlsx",
      undefined,
      { allowAi: true },
    );

    expect(prepared.aiRetryBlocked).toBe(true);
    expect(prepared.unresolved?.length).toBeGreaterThan(0);
    expect(prepared.note).toMatch(/did not complete/i);
    expect(parseSpy).toHaveBeenCalledTimes(1);
  });
});

describe("commitSpecImport snapshot hash persistence", () => {
  it("passes the prepared sourceHash to saveSpecSheet", async () => {
    const prepared = {
      parsed: fixtureParse(),
      newAliases: [],
      sourceNames: ["specs.xlsx"],
      sourceHash: "abc123",
    } as unknown as Parameters<typeof commitSpecImport>[0];

    await commitSpecImport(prepared);

    expect(saveSheetSpy).toHaveBeenCalledTimes(1);
    expect(saveSheetSpy.mock.calls[0][2]).toBe("specs");
    expect(saveSheetSpy.mock.calls[0][3]).toBe("abc123");
  });

  it("saves manager-confirmed recipe unit provenance without changing row values", async () => {
    const rows = [{ ingredient: "Flour", lbs: 41.625 }];
    const prepared = {
      parsed: {
        profiles: [],
        recipes: [{
          kind: "dough",
          name: "Confirmed Dough",
          rowsUnit: "unclear",
          confirmedRowsUnit: "lbs",
          rows,
        }],
      },
      newAliases: [],
      sourceNames: ["dough.xlsx"],
    } as unknown as Parameters<typeof commitSpecImport>[0];

    await commitSpecImport(prepared);

    const saved = saveSheetSpy.mock.calls[0]?.[1] as ParsedSpecImport;
    expect(saved.recipes[0]?.confirmedRowsUnit).toBe("lbs");
    expect(saved.recipes[0]?.rows).toEqual(rows);
  });
});
