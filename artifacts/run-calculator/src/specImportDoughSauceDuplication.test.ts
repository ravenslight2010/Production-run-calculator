// @vitest-environment node
//
// Pipeline-level regression (web + mobile parity): one named DOUGH recipe and
// one named SAUCE recipe that a spec sheet lists across several flavors — at
// slightly different component weights per flavor, exactly how the AI tends to
// emit them — must collapse to ONE dough pool entry and ONE sauce pool entry,
// never a per-flavor / per-weight duplicate.
//
// This is the dough/sauce sibling of specImportCheeseDuplication.test.ts. The
// spec importer seeds four server master-data pools (Cheese, Mixes, plus the
// @workspace/named-recipes Dough and Sauce pools); the cheese split is already
// guarded end-to-end, and this covers the dough/sauce pools with the same
// deterministic (no live AI) mocking approach.
//
// The two apps reach "one pool entry" by different-but-equivalent routes, so we
// assert BOTH:
//   • Web (prepareSpecImport, mocked collaborators): the app seeds the dough /
//     sauce pools from name-keyed presets that RunContext.applySpecImport writes
//     (see pushLocalDoughSauceToServer in home.tsx), so the guarantee is that the
//     prepared parse carries exactly ONE distinct dough name and ONE distinct
//     sauce name. We then drive those through the SAME shared helpers the app
//     uses (namedRecipeFromDraft → addNamedRecipesIfAbsentByName) and assert a
//     single pool entry is added for each.
//   • Mobile (commitSpecImport via the strip-imports harness): the seeding lives
//     directly in commitSpecImport, which returns doughRecipesAdded /
//     sauceRecipesAdded. We stub addNamedRecipesToServerIfAbsent with the REAL
//     dedupe against an in-memory pool and assert exactly one dough and one sauce
//     recipe reach each pool.

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as XLSX from "xlsx";
import {
  type ParsedSpecImport,
  type ParsedProfile,
  type ParsedRecipe,
  type SheetGrid,
  specImportNameMatchKey,
  stripApplicatorLabel,
  linkSpecImportNamedRecipesToExisting,
} from "@workspace/spec-import";
import * as specImportLib from "@workspace/spec-import";
import * as specReconcileLib from "@workspace/spec-reconcile";
import * as premixLib from "@workspace/premix-import";
import * as mixesLib from "@workspace/mixes";
import * as cheeseLib from "@workspace/cheese-recipes";
import * as namedLib from "@workspace/named-recipes";
import {
  namedRecipeFromDraft,
  addNamedRecipesIfAbsentByName,
  type NamedRecipe,
} from "@workspace/named-recipes";
import type { CheeseRecipe } from "@workspace/cheese-recipes";
import type { Mix } from "@workspace/mixes";

// ---------------------------------------------------------------------------
// The fixture: ONE named dough recipe + ONE named sauce recipe, each repeated
// once per flavor at a slightly different per-flavor component weight (the
// worst case: the AI emits the recipe five times instead of once with five
// targets). Names are identical across the copies — the identity a spec import
// must key on — so all five must fold into a single pool entry.
// ---------------------------------------------------------------------------

const BRAND = "Aldo's";
const DOUGH_NAME = "House Dough";
const SAUCE_NAME = "House Marinara";
const FLAVORS = ["Cheese", "Meat Lover", "S & P", "Pepperoni", "Sausage"];

function fixtureParse(): ParsedSpecImport {
  const profiles: ParsedProfile[] = FLAVORS.map((flavor) => ({
    brand: BRAND,
    flavor,
    applicators: [],
    pepperonis: [],
  }));
  const recipes: ParsedRecipe[] = FLAVORS.flatMap((flavor, i) => {
    // Slightly different weights per flavor — the "same recipe, different
    // numbers" shape that must NOT fork the recipe.
    const flourLbs = 50 + i;
    const waterLbs = 30 + i * 0.5;
    const tomatoLbs = 20 + i;
    const dough: ParsedRecipe = {
      kind: "dough",
      name: DOUGH_NAME,
      brand: BRAND,
      flavor,
      rows: [
        { ingredient: "Flour", lbs: flourLbs },
        { ingredient: "Water", lbs: waterLbs },
      ],
    };
    const sauce: ParsedRecipe = {
      kind: "sauce",
      name: SAUCE_NAME,
      brand: BRAND,
      flavor,
      rows: [{ ingredient: "Crushed Tomato", lbs: tomatoLbs }],
    };
    return [dough, sauce];
  });
  return { profiles, recipes };
}

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
// Web module mocks — same collaborator shape as specImportCheeseDuplication.
// The dough/sauce server seeding is NOT in the web commitSpecImport (it runs
// from name-keyed presets in home.tsx), so we only need the parse fixture here.
// ---------------------------------------------------------------------------

const { parseSpy } = vi.hoisted(() => ({ parseSpy: vi.fn() }));

vi.mock("./storage", () => ({
  loadSpecImportKnown: () => ({ ...EMPTY_KNOWN }),
  profileExistsForImport: () => false,
  recipeExistsForImport: () => false,
  importProfileIsTombstoned: () => false,
  recipeNameIsTombstoned: () => false,
  applySpecImport: () => {},
}));
vi.mock("./specImportAliases", () => ({
  fetchSpecImportAliases: async () => [],
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
  fetchCheeseRecipes: async () => [] as CheeseRecipe[],
  saveCheeseRecipes: async (items: CheeseRecipe[]) => items,
}));
vi.mock("./mixes", () => ({
  fetchMixes: async () => [] as Mix[],
  saveMixes: async (items: Mix[]) => items,
}));

import { prepareSpecImport, commitSpecImport } from "./specImport";

beforeEach(() => {
  parseSpy.mockReset();
  parseSpy.mockImplementation(async () => fixtureParse());
});

// Mirror the app's dough/sauce pool seeding (pushLocalDoughSauceToServer): fold
// the parsed recipes of a kind into a name-keyed map (exactly like
// applySpecImport's `doughPresets[name] = rows`), build a draft per unique
// name, then run the shared "add if absent by name" merge against an empty pool.
function seedNamedPool(
  parsed: ParsedSpecImport,
  kind: "dough" | "sauce",
): { added: number; names: string[] } {
  const byName = new Map<string, { ingredient: string; lbs: number }[]>();
  for (const r of parsed.recipes) {
    if (r.kind !== kind) continue;
    const name = r.name.trim();
    if (!name || r.rows.length === 0) continue;
    byName.set(name, r.rows.map((row) => ({ ingredient: row.ingredient, lbs: row.lbs })));
  }
  const drafts = [...byName.entries()]
    .map(([name, components]) => namedRecipeFromDraft({ name, components, idPrefix: kind }))
    .filter((r): r is NamedRecipe => r !== null);
  const { merged, added } = addNamedRecipesIfAbsentByName([], drafts);
  return { added, names: merged.map((r) => r.name) };
}

describe("web spec-import — one named dough/sauce recipe across flavors does not split", () => {
  it("prepared parse carries exactly one distinct dough name and one sauce name", async () => {
    const prepared = await prepareSpecImport(goodBuffer());

    const doughNames = new Set(
      prepared.parsed.recipes.filter((r) => r.kind === "dough").map((r) => r.name.trim()),
    );
    const sauceNames = new Set(
      prepared.parsed.recipes.filter((r) => r.kind === "sauce").map((r) => r.name.trim()),
    );
    expect([...doughNames]).toEqual([DOUGH_NAME]);
    expect([...sauceNames]).toEqual([SAUCE_NAME]);
  });

  it("seeds exactly ONE dough and ONE sauce pool entry from the prepared parse", async () => {
    const prepared = await prepareSpecImport(goodBuffer());
    // commit runs cleanly (cheese/mix pools untouched here) and never throws.
    await commitSpecImport(prepared);

    const dough = seedNamedPool(prepared.parsed, "dough");
    const sauce = seedNamedPool(prepared.parsed, "sauce");
    expect(dough.added).toBe(1);
    expect(dough.names).toEqual([DOUGH_NAME]);
    expect(sauce.added).toBe(1);
    expect(sauce.names).toEqual([SAUCE_NAME]);
  });
});

// ---------------------------------------------------------------------------
// Mobile parity — load the RN-bound commitSpecImport via the strip-imports →
// transpileModule → temp-.mjs harness (see .agents/memory/web-test-harness.md),
// injecting the REAL shared libs and a call-recording addNamedRecipesToServerIfAbsent
// stub backed by the REAL addNamedRecipesIfAbsentByName so "exactly one pool
// entry seeded" is asserted through the real commit pipeline.
// ---------------------------------------------------------------------------

const here = path.dirname(fileURLToPath(import.meta.url));
const MOBILE_FILE = path.resolve(here, "../../run-calculator-mobile/context/specImport.ts");

const MOBILE_PRELUDE = `
const {
  applyNameMatches, canonicalize, collectMatchCandidates, collectSpecAliases,
  collectSpecImportMixes, collectSpecImportCheeseRecipes,
  canonicalizeSpecImportCheeseRecipeNames, dedupeSpecImportCheeseRecipes,
  linkSpecImportCheeseToExisting, linkSpecImportNamedRecipesToExisting,
  linkSpecImportDieTypesToExisting, crossFillSpecImport, findOverflowColumnRows,
  findTruncatedCells, extractEmbeddedApplicatorBlends, formatOverflowColumnsNote,
  formatTruncatedCellsNote, gridSanityIssue, gridsToPromptText,
  mergeParsedSpecImports, recipeTargets, resolveRetriedParsePass,
  shouldRetryParsePass, splitGridsForPrompt, summarizeSpecImport,
} = globalThis.__SPEC_IMPORT_LIB__;
const { reconcileSpecWithRecipes, toReconcileRecipes } = globalThis.__SPEC_RECONCILE_LIB__;
const { specMixDraftToMix } = globalThis.__PREMIX_LIB__;
const { addSpecMixesIfAbsent } = globalThis.__MIXES_LIB__;
const { specCheeseDraftToRecipe, addCheeseRecipesIfAbsentByName } = globalThis.__CHEESE_LIB__;
const { namedRecipeFromDraft } = globalThis.__NAMED_LIB__;
const {
  requestParseSpecSheet, requestMatchImport, fetchSpecImportAliases,
  saveSpecImportAliases, saveSpecSheet, buildSpecSheetLabel, saveAiCorrections,
  fetchMixes, saveMixes, fetchCheeseRecipes, saveCheeseRecipes,
  addNamedRecipesToServerIfAbsent,
} = globalThis.__SPEC_IMPORT_STUBS__;
const XLSX = {};
`;

interface MobileStore {
  known: typeof EMPTY_KNOWN;
  currentRecipes: unknown[];
  profileExists: () => boolean;
  recipeExists: () => boolean;
  apply: (parsed: ParsedSpecImport) => void;
}

interface MobileSpecImportModule {
  prepareSpecImportMulti: (
    gridsList: SheetGrid[][],
    store: MobileStore,
    onProgress?: (done: number, total: number) => void,
    names?: string[],
  ) => Promise<{ parsed: ParsedSpecImport }>;
  commitSpecImport: (
    prepared: { parsed: ParsedSpecImport; newAliases: unknown[] },
    store: MobileStore,
  ) => Promise<{
    mixesAdded: number;
    cheeseRecipesAdded: number;
    doughRecipesAdded: number;
    sauceRecipesAdded: number;
  }>;
}

let mobileTempFile: string | null = null;
let mobile: MobileSpecImportModule;

// In-memory dough/sauce pools the addNamedRecipesToServerIfAbsent stub writes to,
// deduped by the REAL shared helper so the assertion reflects real behavior.
const namedPools: { dough: NamedRecipe[]; sauce: NamedRecipe[] } = { dough: [], sauce: [] };
const mobileParseSpy = vi.fn(async () => fixtureParse());

async function loadMobileSpecImport(): Promise<MobileSpecImportModule> {
  const ts = (await import("typescript")).default;
  const raw = fs.readFileSync(MOBILE_FILE, "utf8");
  const withoutImports = raw.replace(/import[\s\S]*?from\s*['"][^'"]*['"]\s*;?/g, "");
  const source = MOBILE_PRELUDE + withoutImports;
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2020,
      isolatedModules: true,
    },
  });
  const out = path.join(
    os.tmpdir(),
    `specImportDoughSauce.mobile.${process.pid}.${Date.now()}.mjs`,
  );
  fs.writeFileSync(out, outputText, "utf8");
  mobileTempFile = out;
  return (await import(pathToFileURL(out).href)) as MobileSpecImportModule;
}

beforeAll(async () => {
  const g = globalThis as Record<string, unknown>;
  g.__SPEC_IMPORT_LIB__ = specImportLib;
  g.__SPEC_RECONCILE_LIB__ = specReconcileLib;
  g.__PREMIX_LIB__ = premixLib;
  g.__MIXES_LIB__ = mixesLib;
  g.__CHEESE_LIB__ = cheeseLib;
  g.__NAMED_LIB__ = namedLib;
  g.__SPEC_IMPORT_STUBS__ = {
    requestParseSpecSheet: mobileParseSpy,
    requestMatchImport: async () => {
      throw new Error("no AI matcher in tests");
    },
    fetchSpecImportAliases: async () => [],
    saveSpecImportAliases: async () => {},
    saveSpecSheet: async () => {},
    buildSpecSheetLabel: () => "",
    saveAiCorrections: async () => {},
    fetchMixes: async () => [] as Mix[],
    saveMixes: async (items: Mix[]) => items,
    fetchCheeseRecipes: async () => [] as CheeseRecipe[],
    saveCheeseRecipes: async (items: CheeseRecipe[]) => items,
    // Real "add if absent by name" against the in-memory pool for the kind.
    addNamedRecipesToServerIfAbsent: async (
      kind: "dough" | "sauce",
      candidates: NamedRecipe[],
    ) => {
      const { merged, added } = addNamedRecipesIfAbsentByName(namedPools[kind], candidates);
      namedPools[kind] = merged;
      return { added, items: merged };
    },
  };
  mobile = await loadMobileSpecImport();
});

afterAll(() => {
  if (mobileTempFile && fs.existsSync(mobileTempFile)) fs.rmSync(mobileTempFile);
  const g = globalThis as Record<string, unknown>;
  delete g.__SPEC_IMPORT_LIB__;
  delete g.__SPEC_RECONCILE_LIB__;
  delete g.__PREMIX_LIB__;
  delete g.__MIXES_LIB__;
  delete g.__CHEESE_LIB__;
  delete g.__NAMED_LIB__;
  delete g.__SPEC_IMPORT_STUBS__;
});

const mobileStore = (): MobileStore => ({
  known: { ...EMPTY_KNOWN },
  currentRecipes: [],
  profileExists: () => false,
  recipeExists: () => false,
  apply: () => {},
});

const goodGrids = (): SheetGrid[] => [
  { name: "Specs", rows: [["Brand", "Flavor", "Cases"], [BRAND, "Cheese", "120"]] },
];

describe("mobile spec-import — commitSpecImport seeds one dough/sauce recipe (parity)", () => {
  beforeEach(() => {
    mobileParseSpy.mockClear();
    namedPools.dough = [];
    namedPools.sauce = [];
  });

  it("seeds exactly ONE dough and ONE sauce pool entry despite per-flavor copies", async () => {
    const prepared = await mobile.prepareSpecImportMulti(
      [goodGrids()],
      mobileStore(),
      undefined,
      ["Specs.xlsx"],
    );
    const result = await mobile.commitSpecImport(
      prepared as { parsed: ParsedSpecImport; newAliases: unknown[] },
      mobileStore(),
    );

    expect(result.doughRecipesAdded).toBe(1);
    expect(result.sauceRecipesAdded).toBe(1);
    expect(namedPools.dough.map((r) => r.name)).toEqual([DOUGH_NAME]);
    expect(namedPools.sauce.map((r) => r.name)).toEqual([SAUCE_NAME]);
  });
});

// ---------------------------------------------------------------------------
// Loose-name-keyed dedup BOUNDARY (web + mobile share these pure helpers).
//
// The tests above cover the easy case: the SAME name repeated across flavors
// collapses to one pool entry. The higher-risk real-world split is when the AI
// emits the same recipe under NEAR-identical but NOT-identical names (extra
// "Craft", reordered words, a misspelling, a stray "Applicator - " prefix, or a
// generic filler word). Dough/sauce dedup keys on the LOOSE key
// (`specImportNameMatchKey`, see import-order-dedup-keys.md), NOT a fuzzy match,
// so the collapse-vs-keep boundary is worth pinning down as a regression guard.
//
// Pipeline modeled here (the real one a spec import runs for dough/sauce):
//   1. linkSpecImportNamedRecipesToExisting(parsed, kind, existingNames) — snaps
//      an imported recipe's name onto a saved pool name when their loose keys
//      match (renames the imported recipe to the saved EXACT name).
//   2. namedRecipeFromDraft → addNamedRecipesIfAbsentByName — the pool add,
//      which dedupes by EXACT (case-insensitive) name. So a recipe the link pass
//      renamed folds in (added 0); one it left alone forks a parallel entry
//      (added 1).
// ---------------------------------------------------------------------------

const DUMMY_ROWS = [{ ingredient: "Flour", lbs: 50 }];

/**
 * Drive one imported dough/sauce recipe name through the real link + add-if-absent
 * pipeline against a pool that already holds `existingName`. Returns whether the
 * link pass snapped the imported name onto the saved one and whether the pool add
 * folded it in (added 0) or created a parallel entry (added 1).
 */
function importAgainstPool(
  existingName: string,
  importedName: string,
  kind: "dough" | "sauce",
): { linkedName: string; added: number; poolNames: string[] } {
  const existingRecipe = namedRecipeFromDraft({
    name: existingName,
    components: DUMMY_ROWS,
    idPrefix: kind,
  });
  if (!existingRecipe) throw new Error("bad fixture existing recipe");

  const parsed: ParsedSpecImport = {
    profiles: [],
    recipes: [
      { kind, name: importedName, brand: BRAND, flavor: "Cheese", rows: DUMMY_ROWS },
    ],
  };
  const linked = linkSpecImportNamedRecipesToExisting(parsed, kind, [existingName]);
  const linkedName = linked.recipes[0].name;

  const draft = namedRecipeFromDraft({
    name: linkedName,
    components: DUMMY_ROWS,
    idPrefix: kind,
  });
  const { merged, added } = addNamedRecipesIfAbsentByName(
    [existingRecipe],
    draft ? [draft] : [],
  );
  return { linkedName, added, poolNames: merged.map((r) => r.name) };
}

describe("spec-import dough/sauce loose-key dedup boundary — collapse vs keep", () => {
  // ---- COLLAPSE: loose key tolerates case / whitespace / punctuation / filler.
  // These variants must fold onto the saved recipe (no parallel pool entry).
  const collapseCases: Array<[string, string, "dough" | "sauce"]> = [
    // Case-only drift.
    ["House Dough", "HOUSE DOUGH", "dough"],
    // Collapsed internal whitespace.
    ["House Dough", "House   Dough", "dough"],
    // Apostrophe / quote punctuation folding ("Aldo's" == "Aldos").
    ["Aldo's Dough", "Aldos Dough", "dough"],
    // Filler token dropped ("standard").
    ["House Dough", "House Standard Dough", "dough"],
    // Filler token added the other direction ("regular").
    ["House Marinara", "House Regular Marinara", "sauce"],
    // Filler token "pizza" dropped from a sauce name.
    ["House Marinara", "House Pizza Marinara", "sauce"],
    // Reordered words (near-dup matcher, word-order layer).
    ["House Dough", "Dough House", "dough"],
    ["House Marinara", "Marinara House", "sauce"],
    // Single-letter misspelling (near-dup matcher, typo layer — one dropped
    // letter; a two-letter swap like "Duogh" is edit distance 2 and still forks).
    ["House Dugh", "House Dough", "dough"],
  ];

  it.each(collapseCases)(
    "collapses %j ← %j (%s): links to saved name, adds no duplicate",
    (existingName, importedName, kind) => {
      const { linkedName, added, poolNames } = importAgainstPool(
        existingName,
        importedName,
        kind,
      );
      expect(linkedName).toBe(existingName);
      expect(added).toBe(0);
      expect(poolNames).toEqual([existingName]);
    },
  );

  // ---- KEEP (sauce only): the near-dup matcher's extra-word layer stays OFF
  // in this silent auto-link path: an extra word is often a MEANINGFUL
  // qualifier ("Spicy House Sauce" is not "House Sauce"), so a sauce with an
  // extra distinctive token still forks a parallel pool entry the manager can
  // merge by hand (the sauce family matcher requires token-set EQUALITY).
  const keepCases: Array<[string, string, "dough" | "sauce"]> = [
    // Sauce: extra word.
    ["House Marinara", "House Craft Marinara", "sauce"],
  ];

  it.each(keepCases)(
    "keeps %j vs %j (%s): no link, forks a parallel pool entry",
    (existingName, importedName, kind) => {
      const { linkedName, added, poolNames } = importAgainstPool(
        existingName,
        importedName,
        kind,
      );
      expect(linkedName).toBe(importedName);
      expect(added).toBe(1);
      expect(poolNames).toEqual([existingName, importedName]);
    },
  );

  // ---- COLLAPSE (dough): one recipe per dough FAMILY — a variant-qualified
  // dough name ("House Craft Dough") whose tokens are a superset of an
  // existing family recipe's distinctive tokens folds onto the base recipe;
  // qualifiers only locate the doughball weight row, they never fork a
  // parallel dough entry.
  it("collapses a variant-qualified dough onto its base family recipe", () => {
    const { linkedName, added, poolNames } = importAgainstPool(
      "House Dough",
      "House Craft Dough",
      "dough",
    );
    expect(linkedName).toBe("House Dough");
    expect(added).toBe(0);
    expect(poolNames).toEqual(["House Dough"]);
  });

  // ---- "Applicator - " prefix boundary.
  // cleanSpecCheeseRecipeName strips this label for CHEESE recipes, but the
  // dough/sauce link pass keys on specImportNameMatchKey with NO applicator
  // strip. So a stray "Applicator - " prefix on a dough/sauce name is treated as
  // a distinguishing token and FORKS a parallel entry — a known gap, pinned here
  // so a future change that closes it (or regresses it) is caught deliberately.
  it("stripApplicatorLabel WOULD normalize the prefix, but the dough/sauce key does not", () => {
    // The pure strip helper collapses the label to the bare name...
    expect(stripApplicatorLabel("Applicator - House Dough")).toBe("House Dough");
    // ...yet the loose match key used by the dough/sauce link pass keeps
    // "applicator" as a token, so the keys differ and no snap happens.
    expect(specImportNameMatchKey("Applicator - House Dough")).not.toBe(
      specImportNameMatchKey("House Dough"),
    );
  });

  // Sauce: the stray "applicator" token makes the token sets UNEQUAL, so the
  // sauce family matcher (set equality) does not snap — forks a parallel
  // entry. Dough: the prefixed name's tokens are a SUPERSET of the base
  // family's distinctive tokens, so the dough family matcher folds it onto
  // the base recipe — the gap pinned above is closed for dough.
  it("does NOT collapse the applicator prefix for sauce: forks a parallel entry", () => {
    const { linkedName, added, poolNames } = importAgainstPool(
      "House Marinara",
      "Applicator - House Marinara",
      "sauce",
    );
    expect(linkedName).toBe("Applicator - House Marinara");
    expect(added).toBe(1);
    expect(poolNames).toEqual(["House Marinara", "Applicator - House Marinara"]);
  });

  it("collapses the applicator prefix for dough via the family matcher", () => {
    const { linkedName, added, poolNames } = importAgainstPool(
      "House Dough",
      "Applicator - House Dough",
      "dough",
    );
    expect(linkedName).toBe("House Dough");
    expect(added).toBe(0);
    expect(poolNames).toEqual(["House Dough"]);
  });
});
