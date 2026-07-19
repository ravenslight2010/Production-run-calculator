// @vitest-environment node
//
// Scripted check for: "Make dough/sauce re-imports remember merges" — proves a
// merged-away dough/sauce recipe name on a real re-imported workbook PRE-LINKS
// onto the surviving pool recipe instead of resurrecting the deleted one.
//
// Loop under test (mirrors the Manage Lists UI):
//   1. Import real dough/sauce workbooks from attached_assets/source-library
//      (real bytes → readWorkbookGrids → prepareSpecImportMulti; only the AI
//      parse is mocked to a deterministic per-workbook read), push the recipes
//      into the in-memory server pools the way home.tsx's commit does.
//   2. Merge recipe A into recipe B the way handleApplyRecipeNameMerge does:
//      delete A's pool row, learn the SAME buildRecipeNameChangeAliases rows
//      (kind "recipeName", context "dough"/"sauce").
//   3. Re-import the SAME workbooks and assert:
//      - prepared.aliasLinkSuggestions carries recipeLinkSuggestionKey(kind, A) → B
//      - the dialog's suggestLink mirror pre-selects B (it exists in the pool)
//      - profiles referencing A were remapped to B by canonicalizeParsed
//      - confirming with the pre-link (referenceOnly, like the dialog's
//        linkExisting path) leaves the pool WITHOUT a resurrected A row.

import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { recipeLinkSuggestionKey, type SpecImportAlias } from "@workspace/spec-import";
import { normalizeNamedRecipes, type NamedRecipe } from "@workspace/named-recipes";

// ── In-memory server stores (shared across mocks) ───────────────────────────
const { aliasStore } = vi.hoisted(() => ({
  aliasStore: { rows: [] as unknown[] },
}));

function aliasKey(a: SpecImportAlias): string {
  return `${a.kind}\u0000${a.externalName.trim().toLowerCase()}\u0000${(a.context ?? "").trim().toLowerCase()}`;
}
/** Mirror the server's ci upsert by (kind, externalName, context). */
function upsertAliases(rows: SpecImportAlias[]) {
  const byKey = new Map<string, SpecImportAlias>(
    (aliasStore.rows as SpecImportAlias[]).map((a) => [aliasKey(a), a]),
  );
  for (const a of rows) byKey.set(aliasKey(a), a);
  aliasStore.rows = [...byKey.values()];
}

vi.mock("./specImportAliases", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./specImportAliases")>();
  return {
    ...actual,
    fetchSpecImportAliases: async () => [...(aliasStore.rows as SpecImportAlias[])],
    saveSpecImportAliases: async (rows: SpecImportAlias[]) => upsertAliases(rows),
  };
});
// Known lists empty + no tombstones: the alias pre-link must be the ONLY
// defense against resurrection (recipeNameIsTombstoned is always false in the
// real app too — imported dough/sauce recipes are never tombstone-skipped).
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
    doughRecipes: [],
    sauceRecipes: [],
    cheeseRecipes: [],
  }),
  profileExistsForImport: () => false,
  recipeExistsForImport: () => false,
  importProfileIsTombstoned: () => false,
  recipeNameIsTombstoned: () => false,
  isNameDeleted: () => false,
  flavorNamespace: (brand: string) => `flavors:${brand.trim().toLowerCase()}`,
  applySpecImport: () => {
    throw new Error("applySpecImport not exercised in this scripted check");
  },
}));
// No saved-sheet reuse/prune: force a fresh parse every time.
vi.mock("./savedSpecSheets", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./savedSpecSheets")>();
  return {
    ...actual,
    fetchSavedSpecSheets: async () => [],
    saveSpecSheet: async () => [],
    loadCurrentReconcileRecipes: () => [],
  };
});
// No AI in this check — the match pass is best-effort and must fail-safe.
vi.mock("./matchImport", () => ({
  requestMatchImport: async () => {
    throw new Error("no AI in scripted check");
  },
}));
vi.mock("./aiCorrections", () => ({ saveAiCorrections: async () => {} }));
vi.mock("./mixes", () => ({
  fetchMixes: async () => [],
  saveMixes: async (rows: unknown[]) => rows,
}));
vi.mock("./cheeseRecipes", () => ({
  fetchCheeseRecipes: async () => [],
  saveCheeseRecipes: async (rows: unknown[]) => rows,
}));
vi.mock("./dieLineDefaultsServer", () => ({
  fetchDieLineDefaults: async () => [],
  toOverridesMap: () => ({}),
}));

// Deterministic "AI" parse: recognize each real workbook by a distinctive
// token in its prompt text and return the recipes/profiles that sheet holds.
// Keeps the REAL byte-read → grid → prompt-text → canonicalize → link pipeline
// while pinning the one non-deterministic step.
vi.mock("./parseSpecSheet", () => ({
  requestParseSpecSheet: async ({ workbookText }: { workbookText: string }) => {
    const t = workbookText.toLowerCase();
    if (t.includes("naan")) {
      return {
        profiles: [
          {
            brand: "Aldo's",
            flavor: "Naan Special",
            doughName: "Naan Dough",
            applicators: [],
            pepperonis: [],
          },
        ],
        recipes: [
          {
            kind: "dough",
            name: "Naan Dough",
            rows: [
              { ingredient: "Flour", lbs: 100 },
              { ingredient: "Yogurt", lbs: 10 },
            ],
          },
        ],
      };
    }
    if (t.includes("masa")) {
      return {
        profiles: [],
        recipes: [
          {
            kind: "dough",
            name: "Masa Dough",
            rows: [
              { ingredient: "Masa Flour", lbs: 80 },
              { ingredient: "Water", lbs: 40 },
            ],
          },
        ],
      };
    }
    if (t.includes("asiago")) {
      return {
        profiles: [
          {
            brand: "Aldo's",
            flavor: "Asiago Bianco",
            sauceName: "Asiago Sauce",
            applicators: [],
            pepperonis: [],
          },
        ],
        recipes: [
          {
            kind: "sauce",
            name: "Asiago Sauce",
            rows: [
              { ingredient: "Asiago Cheese", lbs: 20 },
              { ingredient: "Cream", lbs: 30 },
            ],
          },
        ],
      };
    }
    if (t.includes("gravy")) {
      return {
        profiles: [],
        recipes: [
          {
            kind: "sauce",
            name: "Gravy Sauce",
            rows: [
              { ingredient: "Tomato Paste", lbs: 50 },
              { ingredient: "Water", lbs: 25 },
            ],
          },
        ],
      };
    }
    throw new Error("unrecognized workbook in scripted check");
  },
}));

// REAL ./namedRecipes module (fetchNamedRecipes / addNamedRecipesToServerIfAbsent)
// against an in-memory pool behind a fetch stub — same pattern as
// mockDoughSheetImportVariants.test.ts, so the pool add/dedupe logic runs for real.
const pools: Record<"dough" | "sauce", NamedRecipe[]> = { dough: [], sauce: [] };
const realFetch = globalThis.fetch;

beforeEach(() => {
  aliasStore.rows = [];
  pools.dough = [];
  pools.sauce = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const kind = url.includes("/api/dough-recipes")
      ? "dough"
      : url.includes("/api/sauce-recipes")
        ? "sauce"
        : null;
    if (!kind) throw new Error(`unexpected fetch ${url}`);
    if ((init?.method ?? "GET") === "POST") {
      const body = JSON.parse(String(init!.body)) as { items: unknown };
      pools[kind] = normalizeNamedRecipes(body.items);
    }
    return new Response(JSON.stringify({ items: pools[kind] }), { status: 200 });
  }) as typeof fetch;
});

afterAll(() => {
  globalThis.fetch = realFetch;
});

import { prepareSpecImportMulti, type SpecImportPrepared } from "./specImport";
import { buildRecipeNameChangeAliases } from "./specImportAliases";
import { addNamedRecipesToServerIfAbsent } from "./namedRecipes";
import { namedRecipeFromDraft } from "@workspace/named-recipes";

const LIB = resolve(__dirname, "../../../attached_assets/source-library");

function readAsArrayBuffer(path: string): ArrayBuffer {
  const buf = readFileSync(path);
  const out = new ArrayBuffer(buf.byteLength);
  new Uint8Array(out).set(buf);
  return out;
}

const DOUGH_FILES = [
  "Naan_Dough_Mixing_Procedure_-_12_1784339684591.xlsx",
  "Masa_Dough_Mixing_Procedure_-_12_1784339684313.xlsx",
].map((n) => resolve(LIB, "dough", n));
const SAUCE_FILES = [
  "Asiago_Sauce_02_1784339519196.xlsx",
  "Gravy_Sauce_-_05_1784339519678.xlsx",
].map((n) => resolve(LIB, "sauce", n));

function importOnce(paths: string[]): Promise<SpecImportPrepared> {
  return prepareSpecImportMulti(
    paths.map(readAsArrayBuffer),
    undefined,
    paths.map((p) => p.split("/").pop()!),
  );
}

/** Mirror handleApplyRecipeNameMerge's alias learning (same rows, same upsert). */
function learnMergeAliases(
  category: "dough" | "sauce",
  sources: string[],
  target: string,
) {
  upsertAliases(
    buildRecipeNameChangeAliases(category, sources, target, {
      existingAliases: aliasStore.rows as SpecImportAlias[],
    }),
  );
}

/**
 * Mirror the home.tsx commit push for dough/sauce recipes of one kind:
 * confirmed (non-referenceOnly) recipes become drafts added-if-absent to the
 * server pool. `linkedAsExisting` marks names the review pre-linked onto an
 * existing recipe — the dialog turns those referenceOnly, so they are excluded
 * from the draft add (exactly the linkExisting → referenceOnly path).
 */
async function pushRecipes(
  prepared: SpecImportPrepared,
  kind: "dough" | "sauce",
  linkedAsExisting: Set<string> = new Set(),
): Promise<void> {
  const drafts = prepared.parsed.recipes
    .filter(
      (r) =>
        r.kind === kind &&
        !r.referenceOnly &&
        !linkedAsExisting.has((r.name ?? "").trim().toLowerCase()),
    )
    .map((r) =>
      namedRecipeFromDraft({
        name: (r.name ?? "").trim(),
        components: (r.rows ?? []).map((row) => ({
          ingredient: row.ingredient,
          lbs: row.lbs ?? 0,
        })),
        idPrefix: kind,
      }),
    )
    .filter((r): r is NamedRecipe => r !== null);
  await addNamedRecipesToServerIfAbsent(kind, drafts);
}

/**
 * Mirror SpecImportDialog's suggestLink for dough/sauce rows: the kind-scoped
 * suggestion key, self-link skip, and the "must exist in the pool" guard.
 */
function suggestLinkMirror(
  prepared: SpecImportPrepared,
  kind: "dough" | "sauce",
  name: string,
): string | undefined {
  const suggestions = prepared.aliasLinkSuggestions ?? {};
  const suggested = suggestions[recipeLinkSuggestionKey(kind, name)];
  if (!suggested) return undefined;
  if (suggested.trim().toLowerCase() === name.trim().toLowerCase()) return undefined;
  return pools[kind]
    .map((r) => r.name)
    .find((n) => n.trim().toLowerCase() === suggested.trim().toLowerCase());
}

describe.each([
  {
    kind: "dough" as const,
    files: DOUGH_FILES,
    source: "Naan Dough",
    target: "Masa Dough",
    profileField: "doughName" as const,
  },
  {
    kind: "sauce" as const,
    files: SAUCE_FILES,
    source: "Asiago Sauce",
    target: "Gravy Sauce",
    profileField: "sauceName" as const,
  },
])(
  "merge → real $kind workbook re-import lands on the survivor",
  ({ kind, files, source, target, profileField }) => {
    it(`pre-links the merged-away ${kind} name onto the survivor and does not resurrect it`, async () => {
      // 1. First import of the real workbooks, confirm all into the pool.
      const first = await importOnce(files);
      const names = first.parsed.recipes
        .filter((r) => r.kind === kind)
        .map((r) => r.name);
      expect(names).toContain(source);
      expect(names).toContain(target);
      await pushRecipes(first, kind);
      expect(pools[kind].map((r) => r.name).sort()).toEqual([source, target].sort());

      // 2. Merge source → target the way handleApplyRecipeNameMerge does:
      // target pool row exists → source row deleted, aliases learned.
      pools[kind] = pools[kind].filter((r) => r.name !== source);
      learnMergeAliases(kind, [source], target);

      // 3. Re-import the SAME workbooks.
      const second = await importOnce(files);

      // The review must PRE-LINK the merged-away sheet name onto the survivor.
      expect(second.aliasLinkSuggestions?.[recipeLinkSuggestionKey(kind, source)]).toBe(
        target,
      );
      // …and the dialog's suggestLink mirror resolves it (survivor is in the pool).
      const secondNames = second.parsed.recipes
        .filter((r) => r.kind === kind)
        .map((r) => r.name);
      expect(secondNames).toContain(source); // parse still reads the old sheet name
      expect(suggestLinkMirror(second, kind, source)).toBe(target);

      // Profiles referencing the merged-away recipe follow the alias too
      // (canonicalizeParsed remaps doughName/sauceName through recipeName aliases).
      const profileRefs = second.parsed.profiles
        .map((p) => p[profileField])
        .filter(Boolean);
      expect(profileRefs).toContain(target);
      expect(profileRefs).not.toContain(source);

      // 4. Confirm the way the dialog does: the pre-linked row becomes
      // referenceOnly (linkExisting), everything else pushes normally.
      await pushRecipes(second, kind, new Set([source.toLowerCase()]));
      expect(pools[kind].some((r) => r.name === source)).toBe(false);
      expect(pools[kind].filter((r) => r.name === target)).toHaveLength(1);
    });

    it(`without the learned alias the merged-away ${kind} name WOULD resurrect (guard is the alias)`, async () => {
      const first = await importOnce(files);
      await pushRecipes(first, kind);
      pools[kind] = pools[kind].filter((r) => r.name !== source);
      // NO learnMergeAliases here — simulate the pre-fix world.
      const second = await importOnce(files);
      expect(
        second.aliasLinkSuggestions?.[recipeLinkSuggestionKey(kind, source)],
      ).toBeUndefined();
      await pushRecipes(second, kind);
      // The old name comes back — proving the alias pre-link is what prevents it.
      expect(pools[kind].some((r) => r.name === source)).toBe(true);
    });
  },
);
