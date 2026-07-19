// @vitest-environment node
//
// End-to-end scripted check for task: "Confirm a real re-import lands on merged
// recipes end-to-end" — exercises the FULL client import pipeline (real
// workbook bytes → readWorkbookGrids → deterministic parse → grounding → link
// pass) with only the network glue mocked to in-memory stores.
//
// Loop under test (mirrors the Manage Lists UI exactly):
//   1. Import the real premix / cheese workbook from
//      attached_assets/source-library, confirm-all into the pool.
//   2. Merge recipe A into recipe B the way handleApplyRecipeNameMerge does:
//      delete A's pool row, keep B, learn aliases via the SAME
//      buildRecipeNameChangeAliases rows the merge path persists.
//   3. Re-import the SAME workbook and assert the review pre-links A's sheet
//      name onto survivor B (premix: redirectSuggestions; cheese: linkTo) so
//      confirming the import updates B instead of resurrecting A.
// Plus a dough/sauce spot-check: merge-built "recipeName" alias rows resolve
// through pickAlias exactly as the spec importer's assignment pass consults it.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Mix } from "@workspace/mixes";
import type { CheeseRecipe } from "@workspace/cheese-recipes";
import { redirectPremixCandidate, mergePremixIntoMixes } from "@workspace/premix-import";
import { mergeCheeseRecipes } from "@workspace/cheese-import";
import { pickAlias, sanitizeSpecAliases, type SpecImportAlias } from "@workspace/spec-import";

// ── In-memory server stores (shared across mocks) ───────────────────────────
const { aliasStore, mixPool, cheesePool } = vi.hoisted(() => ({
  aliasStore: { rows: [] as unknown[] },
  mixPool: { rows: [] as unknown[] },
  cheesePool: { rows: [] as unknown[] },
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
vi.mock("./mixes", () => ({
  fetchMixes: async () => [...(mixPool.rows as Mix[])],
  saveMixes: async (rows: Mix[]) => {
    mixPool.rows = rows;
    return rows;
  },
}));
vi.mock("./cheeseRecipes", () => ({
  fetchCheeseRecipes: async () => [...(cheesePool.rows as CheeseRecipe[])],
  saveCheeseRecipes: async (rows: CheeseRecipe[]) => {
    cheesePool.rows = rows;
    return rows;
  },
}));
vi.mock("./storage", () => ({
  loadSpecImportKnown: () => ({
    brands: [],
    flavorsByBrand: {},
    cheeseIngredients: [],
    doughIngredients: [],
    sauceIngredients: [],
  }),
}));
// No AI in this check — the premix product matcher is best-effort and the
// pipeline must keep the deterministic grounding when it throws.
vi.mock("./premixMatch", () => ({
  requestMatchPremix: async () => {
    throw new Error("no AI in scripted check");
  },
}));
vi.mock("./savedPremixSheets", () => ({
  savePremixSheet: async () => {},
  buildPremixSheetLabel: () => "",
  deriveSourceKey: () => "",
}));
vi.mock("./freezerPull", () => ({
  fetchFreezerPullItems: async () => [],
  saveFreezerPullItems: async () => {},
}));
vi.mock("./aiCorrections", () => ({ saveAiCorrections: async () => {} }));

import { preparePremixImport } from "./premixImport";
import { prepareCheeseImport } from "./cheeseImport";
import { buildRecipeNameChangeAliases } from "./specImportAliases";

const LIB = resolve(__dirname, "../../../attached_assets/source-library");

function readAsArrayBuffer(path: string): ArrayBuffer {
  const buf = readFileSync(path);
  const out = new ArrayBuffer(buf.byteLength);
  new Uint8Array(out).set(buf);
  return out;
}

const premixBuf = () =>
  readAsArrayBuffer(resolve(LIB, "premix/Updated_Pre_Mix_Sheets_1784339838726.xlsx"));
const cheeseBuf = () =>
  readAsArrayBuffer(
    resolve(LIB, "cheese/Cheese_Mix_Recipe_Specs_-_Tabbed_by_Customer_-_07.10.26_1784339826076.xlsx"),
  );

/**
 * Simulate handleApplyRecipeNameMerge's alias learning: build the exact rows
 * the merge path fires-and-forgets and upsert them into the store the same way
 * the server does. (The pool mutation itself is done by each test.)
 */
function learnMergeAliases(
  category: "mixes" | "cheese" | "dough" | "sauce",
  sources: string[],
  target: string,
  brandContext?: string | null,
) {
  upsertAliases(
    buildRecipeNameChangeAliases(category, sources, target, {
      brandContext,
      existingAliases: aliasStore.rows as SpecImportAlias[],
    }),
  );
}

beforeEach(() => {
  aliasStore.rows = [];
  mixPool.rows = [];
  cheesePool.rows = [];
});

describe("merge → real workbook re-import lands on the survivor (mixes)", () => {
  it("pre-links the merged-away sheet name onto the surviving mix and does not resurrect it", async () => {
    // 1. First import of the real workbook, confirm all.
    const first = await preparePremixImport([premixBuf()]);
    expect(first.mixes.length).toBeGreaterThan(10);
    mixPool.rows = first.mixes;

    // 2. Merge two mixes that BOTH come from this workbook.
    const source = first.mixes.find((m) => m.name === "Bobo's Deluxe Veggie Mix");
    const target = first.mixes.find((m) => m.name === "Bobo's Breakfast Mix");
    expect(source).toBeTruthy();
    expect(target).toBeTruthy();
    // handleApplyRecipeNameMerge: target row exists → sources deleted.
    mixPool.rows = (mixPool.rows as Mix[]).filter((m) => m.id !== source!.id);
    learnMergeAliases("mixes", [source!.name], target!.name, target!.brand);

    // 3. Re-import the same workbook.
    const second = await preparePremixImport([premixBuf()]);
    const cand = second.candidates.find((c) => c.mix.name === source!.name);
    expect(cand).toBeTruthy();
    // The merged-away id must no longer be a clean exact-id update...
    expect(second.existingIds).not.toContain(cand!.mix.id);
    // ...and the review must pre-link it onto the survivor.
    expect(second.redirectSuggestions[cand!.mix.id]).toBe(target!.id);

    // 4. Confirm-all the way the dialog does: pre-applied redirect + merge.
    const existsById = (id: string) => (mixPool.rows as Mix[]).some((m) => m.id === id);
    const applied = second.candidates.map((c) => {
      const to = second.redirectSuggestions[c.mix.id];
      if (!to) return c.mix;
      const t = (mixPool.rows as Mix[]).find((m) => m.id === to)!;
      return redirectPremixCandidate(c, { id: t.id, name: t.name, brand: t.brand, flavor: t.flavor }, existsById).mix;
    });
    const merged = mergePremixIntoMixes(mixPool.rows as Mix[], applied);
    // No resurrected pool row under the merged-away name.
    expect(merged.some((m) => m.name === source!.name)).toBe(false);
    expect(merged.filter((m) => m.id === target!.id)).toHaveLength(1);
  });

  it("pre-links after a merge into a renamed survivor whose name is NOT on the sheet", async () => {
    const first = await preparePremixImport([premixBuf()]);
    mixPool.rows = first.mixes;
    const source = first.mixes.find((m) => m.name === "Bobo's Deluxe Veggie Mix")!;
    // Merge into a typed target with no pool row: handleApplyRecipeNameMerge
    // promotes the richest source by RENAMING it in place (id kept).
    const survivor = { ...source, name: "House Veggie Blend" };
    mixPool.rows = (mixPool.rows as Mix[]).map((m) => (m.id === source.id ? survivor : m));
    learnMergeAliases("mixes", [source.name], survivor.name, survivor.brand);

    const second = await preparePremixImport([premixBuf()]);
    const cand = second.candidates.find((c) => c.mix.name === source.name)!;
    // Rename kept the deterministic id, so the sheet block is a clean exact-id
    // update onto the renamed row — no redirect needed, nothing resurrects.
    expect(second.existingIds).toContain(cand.mix.id);
    const merged = mergePremixIntoMixes(mixPool.rows as Mix[], second.mixes);
    expect(merged.filter((m) => m.id === source.id)).toHaveLength(1);
  });
});

describe("merge → real workbook re-import lands on the survivor (cheese)", () => {
  it("pre-links the merged-away blend onto the surviving recipe and does not resurrect it", async () => {
    const first = await prepareCheeseImport([cheeseBuf()]);
    expect(first.recipes.length).toBeGreaterThan(5);
    cheesePool.rows = first.recipes;

    // Merge two same-brand blends that BOTH come from this workbook.
    const source = first.recipes.find((r) => r.name === "Aldo's Parmesan / Oregano Mix");
    const target = first.recipes.find((r) => r.name === "Aldo's Standard Cheese Mix");
    expect(source).toBeTruthy();
    expect(target).toBeTruthy();
    cheesePool.rows = (cheesePool.rows as CheeseRecipe[]).filter((r) => r.id !== source!.id);
    learnMergeAliases("cheese", [source!.name], target!.name, target!.brand);

    const second = await prepareCheeseImport([cheeseBuf()]);
    const cand = second.candidates.find((c) => c.recipe.name === source!.name);
    expect(cand).toBeTruthy();
    expect(second.existingIds).not.toContain(cand!.recipe.id);
    // The review must pre-link the old sheet name onto the survivor.
    expect(cand!.linkTo).toBeTruthy();
    expect(cand!.linkTo!.id).toBe(target!.id);

    // Confirm-all the way the dialog does (accepted link takes the target id).
    const applied = second.candidates.map((c) =>
      c.linkTo ? { ...c.recipe, id: c.linkTo.id, name: c.linkTo.name } : c.recipe,
    );
    const merged = mergeCheeseRecipes(cheesePool.rows as CheeseRecipe[], applied);
    expect(merged.some((r) => r.name === source!.name)).toBe(false);
    expect(merged.filter((r) => r.id === target!.id)).toHaveLength(1);
  });
});

describe("dough/sauce merge aliases resolve through the spec importer's consult path", () => {
  it("a merge-built recipeName alias resolves the old sheet name to the survivor via pickAlias", () => {
    for (const kind of ["dough", "sauce"] as const) {
      learnMergeAliases(kind, ["Old Malted Barley"], "House Malted Barley");
      const usable = sanitizeSpecAliases(aliasStore.rows as SpecImportAlias[]);
      // Exactly how specImport.ts resolves profile dough/sauce assignments.
      expect(pickAlias(usable, "recipeName", "Old Malted Barley", kind)).toBe(
        "House Malted Barley",
      );
    }
  });
});
