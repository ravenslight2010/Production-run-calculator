// @vitest-environment node
//
// End-to-end scripted check for: "Cheese/premix re-imports must not undo
// customer renames" — exercises the FULL client import pipeline (real workbook
// bytes → readWorkbookGrids → deterministic parse → grounding → link pass)
// with only the network glue mocked to in-memory stores.
//
// Loop under test (mirrors the pool managers' rename control exactly):
//   1. Import the real cheese / premix workbook from
//      attached_assets/source-library, confirm-all into the pool.
//   2. Rename a customer group the way renameBrandGroup does: rewrite the
//      brand on every pool row (ids kept), learn the SAME kind:"brand" alias
//      rows maybeLearnBrandRename persists (buildBrandRenameAliases).
//   3. Re-import the SAME workbook and assert the old tab brand lands on the
//      RENAMED group: candidates carry the new brand, the review pre-links
//      them onto the renamed rows (cheese: linkTo; premix: redirect
//      suggestion), and confirming does NOT resurrect the old brand group.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Mix } from "@workspace/mixes";
import { renameMixesBrand } from "@workspace/mixes";
import type { CheeseRecipe } from "@workspace/cheese-recipes";
import { renameCheeseRecipesBrand } from "@workspace/cheese-recipes";
import { redirectPremixCandidate, mergePremixIntoMixes } from "@workspace/premix-import";
import { mergeCheeseRecipes } from "@workspace/cheese-import";
import type { SpecImportAlias } from "@workspace/spec-import";

// ── In-memory server stores (shared across mocks) ───────────────────────────
const { aliasStore, mixPool, cheesePool, knownStore } = vi.hoisted(() => ({
  aliasStore: { rows: [] as unknown[] },
  mixPool: { rows: [] as unknown[] },
  cheesePool: { rows: [] as unknown[] },
  // Mutable known lists: the premix brand guess (splitPremixName) only fires
  // for brands the app knows about, so the harness seeds the workbook's real
  // customers here.
  knownStore: { brands: [] as string[] },
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
vi.mock("./mixes", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/mixes")>();
  return {
    ...actual,
    fetchMixes: async () => [...(mixPool.rows as Mix[])],
    saveMixes: async (rows: Mix[]) => {
      mixPool.rows = rows;
      return rows;
    },
  };
});
vi.mock("./cheeseRecipes", () => ({
  fetchCheeseRecipes: async () => [...(cheesePool.rows as CheeseRecipe[])],
  saveCheeseRecipes: async (rows: CheeseRecipe[]) => {
    cheesePool.rows = rows;
    return rows;
  },
}));
vi.mock("./storage", () => ({
  loadSpecImportKnown: () => ({
    brands: [...knownStore.brands],
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
import { buildBrandRenameAliases } from "./specImportAliases";

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

/** Simulate maybeLearnBrandRename's fire-and-forget alias write. */
function learnBrandRename(from: string, to: string) {
  upsertAliases(buildBrandRenameAliases([from], to, aliasStore.rows as SpecImportAlias[]));
}

const brandLc = (b: string | undefined) => (b ?? "").trim().toLowerCase();

beforeEach(() => {
  aliasStore.rows = [];
  mixPool.rows = [];
  cheesePool.rows = [];
  knownStore.brands = [];
});

describe("brand rename → real cheese workbook re-import lands on the renamed group", () => {
  it("remaps the old tab brand, pre-links onto renamed rows, and does not resurrect the old group", async () => {
    // 1. First import of the real workbook, confirm all.
    const first = await prepareCheeseImport([cheeseBuf()]);
    expect(first.recipes.length).toBeGreaterThan(5);
    cheesePool.rows = first.recipes;

    // Pick a real customer group from the workbook.
    const oldBrand = first.recipes.find((r) => brandLc(r.brand))!.brand;
    const newBrand = `${oldBrand} Foods LLC`;
    const groupIds = first.recipes.filter((r) => brandLc(r.brand) === brandLc(oldBrand)).map((r) => r.id);
    expect(groupIds.length).toBeGreaterThan(0);

    // 2. Rename the group the way renameBrandGroup does (ids kept) + learn.
    const changed = renameCheeseRecipesBrand(cheesePool.rows as CheeseRecipe[], oldBrand, newBrand);
    expect(changed.length).toBe(groupIds.length);
    const changedIds = new Set(changed.map((r) => r.id));
    cheesePool.rows = (cheesePool.rows as CheeseRecipe[]).map(
      (r) => (changedIds.has(r.id) ? changed.find((c) => c.id === r.id)! : r),
    );
    learnBrandRename(oldBrand, newBrand);

    // 3. Re-import the same workbook.
    const second = await prepareCheeseImport([cheeseBuf()]);
    const groupCands = second.candidates.filter(
      (c) => brandLc(c.recipe.brand) === brandLc(newBrand) || brandLc(c.recipe.brand) === brandLc(oldBrand),
    );
    expect(groupCands.length).toBe(groupIds.length);
    for (const c of groupCands) {
      // The learned brand alias must remap every candidate to the new brand...
      expect(c.recipe.brand).toBe(newBrand);
      // ...and each must land on its renamed pool row: either a clean exact-id
      // update or a pre-proposed link onto a row of the renamed group.
      const exact = second.existingIds.includes(c.recipe.id);
      const linked = !!c.linkTo && groupIds.includes(c.linkTo.id);
      expect(exact || linked).toBe(true);
    }

    // 4. Confirm-all the way the dialog does (accepted link takes the target id).
    const applied = second.candidates.map((c) =>
      c.linkTo ? { ...c.recipe, id: c.linkTo.id, name: c.linkTo.name } : c.recipe,
    );
    const merged = mergeCheeseRecipes(cheesePool.rows as CheeseRecipe[], applied);
    // No resurrected old-brand group, no duplicated rows in the renamed group.
    expect(merged.some((r) => brandLc(r.brand) === brandLc(oldBrand))).toBe(false);
    const renamedGroup = merged.filter((r) => brandLc(r.brand) === brandLc(newBrand));
    expect(renamedGroup.length).toBe(groupIds.length);
    const names = renamedGroup.map((r) => r.name.trim().toLowerCase());
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("brand rename → real premix workbook re-import lands on the renamed group", () => {
  it("remaps the old tab brand, redirects onto renamed rows, and does not resurrect the old group", async () => {
    // The premix brand guess only fires for known brands — seed the workbook's
    // real customer the way profiles would in the app.
    knownStore.brands = ["Bobo's"];

    // 1. First import of the real workbook, confirm all.
    const first = await preparePremixImport([premixBuf()]);
    expect(first.mixes.length).toBeGreaterThan(10);
    mixPool.rows = first.mixes;

    const oldBrand = "Bobo's";
    const newBrand = "Bobo Pizza Co";
    const group = first.mixes.filter((m) => brandLc(m.brand) === brandLc(oldBrand));
    expect(group.length).toBeGreaterThan(0);
    const groupIds = group.map((m) => m.id);

    // 2. Rename the group the way renameBrandGroup does (ids kept) + learn.
    const changed = renameMixesBrand(mixPool.rows as Mix[], oldBrand, newBrand);
    expect(changed.length).toBe(groupIds.length);
    const changedById = new Map(changed.map((m) => [m.id, m]));
    mixPool.rows = (mixPool.rows as Mix[]).map((m) => changedById.get(m.id) ?? m);
    learnBrandRename(oldBrand, newBrand);
    // The app's known list keeps BOTH names (pool rename does not edit
    // profiles) — the alias must win over the exact old-brand match.
    knownStore.brands = [oldBrand, newBrand];

    // 3. Re-import the same workbook.
    const second = await preparePremixImport([premixBuf()]);
    const groupCands = second.candidates.filter(
      (c) => brandLc(c.mix.brand) === brandLc(newBrand) || brandLc(c.mix.brand) === brandLc(oldBrand),
    );
    expect(groupCands.length).toBe(groupIds.length);
    for (const c of groupCands) {
      // The learned brand alias must remap every candidate to the new brand...
      expect(c.mix.brand).toBe(newBrand);
      // ...and each must land on its renamed pool row: either a clean exact-id
      // update or a pre-applied redirect onto a row of the renamed group.
      const exact = second.existingIds.includes(c.mix.id);
      const redirect = second.redirectSuggestions[c.mix.id];
      expect(exact || (redirect !== undefined && groupIds.includes(redirect))).toBe(true);
    }

    // 4. Confirm-all the way the dialog does: pre-applied redirects + merge.
    const existsById = (id: string) => (mixPool.rows as Mix[]).some((m) => m.id === id);
    const applied = second.candidates.map((c) => {
      const to = second.redirectSuggestions[c.mix.id];
      if (!to) return c.mix;
      const t = (mixPool.rows as Mix[]).find((m) => m.id === to)!;
      return redirectPremixCandidate(c, { id: t.id, name: t.name, brand: t.brand, flavor: t.flavor }, existsById).mix;
    });
    const merged = mergePremixIntoMixes(mixPool.rows as Mix[], applied);
    // No resurrected old-brand group, no duplicated rows in the renamed group.
    expect(merged.some((m) => brandLc(m.brand) === brandLc(oldBrand))).toBe(false);
    const renamedGroup = merged.filter((m) => brandLc(m.brand) === brandLc(newBrand));
    const keys = renamedGroup.map(
      (m) => `${m.name.trim().toLowerCase()}\u0000${(m.flavor ?? "").trim().toLowerCase()}`,
    );
    expect(new Set(keys).size).toBe(keys.length);
  });
});
