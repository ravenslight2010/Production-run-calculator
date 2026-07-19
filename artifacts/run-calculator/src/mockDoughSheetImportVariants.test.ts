// @vitest-environment node
//
// Mock dough-sheet import → ONE family recipe carrying ALL doughball variants.
//
// A dough mixing-procedure sheet lists the same family recipe once per die
// size ("11\" CRB Recipe", "14\" CRB Recipe", "16\" CRB Recipe"), each with its
// own doughball weight / per-tray. The import must NOT mint one pool recipe
// per die size: the link pass snaps every variant name onto the existing
// family recipe (stamping the original sheet name as variantLabel), and the
// server push folds every variant's numbers into that ONE recipe's
// doughballVariants list.
//
// This drives the REAL pipeline pieces end-to-end, deterministically (no AI):
//   1. linkSpecImportNamedRecipesToExisting (@workspace/spec-import) — the
//      commit-time relink against the live pool that renames variants onto
//      the family recipe and stamps variantLabel.
//   2. The home.tsx variant-collection loop (mirrored verbatim below) that
//      builds variantsByName from the linked parse.
//   3. The REAL web addNamedRecipesToServerIfAbsent (./namedRecipes) against a
//      fetch stub backed by an in-memory pool, so the family guard, weight
//      remap, and mergeNamedRecipeDoughballVariants all run for real.

import { describe, it, expect, beforeEach, afterAll } from "vitest";
import {
  linkSpecImportNamedRecipesToExisting,
  type ParsedSpecImport,
  type ParsedRecipe,
} from "@workspace/spec-import";
import {
  namedRecipeFromDraft,
  normalizeNamedRecipes,
  normalizeDoughballVariants,
  matchDoughballVariant,
  type DoughballVariant,
  type NamedRecipe,
} from "@workspace/named-recipes";
import { addNamedRecipesToServerIfAbsent } from "./namedRecipes";

// ---------------------------------------------------------------------------
// In-memory dough pool behind a fetch stub — GET returns it, POST replaces it
// (the real endpoint upserts the full list and echoes it back).
// ---------------------------------------------------------------------------

let pool: NamedRecipe[] = [];
const realFetch = globalThis.fetch;

beforeEach(() => {
  pool = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (!url.includes("/api/dough-recipes")) throw new Error(`unexpected fetch ${url}`);
    if ((init?.method ?? "GET") === "POST") {
      const body = JSON.parse(String(init!.body)) as { items: unknown };
      pool = normalizeNamedRecipes(body.items);
    }
    return new Response(JSON.stringify({ items: pool }), { status: 200 });
  }) as typeof fetch;
});

afterAll(() => {
  globalThis.fetch = realFetch;
});

// ---------------------------------------------------------------------------
// The mock dough sheet: one CRB family, three die sizes, each parsed as its
// own dough recipe with the same components and per-die doughball numbers.
// ---------------------------------------------------------------------------

const FAMILY = "CRB Dough";
const SHEET_VARIANTS = [
  { name: `11" CRB Recipe`, oz: 10, perTray: 24 },
  { name: `14" CRB Recipe`, oz: 16, perTray: 18 },
  { name: `16" CRB Recipe`, oz: 22, perTray: 12 },
];

function mockSheetParse(): ParsedSpecImport {
  const recipes: ParsedRecipe[] = SHEET_VARIANTS.map((s) => ({
    kind: "dough",
    name: s.name,
    rows: [
      { ingredient: "Flour", lbs: 50 },
      { ingredient: "Water", lbs: 30 },
    ],
    doughballOz: s.oz,
    doughballsPerTray: s.perTray,
  }));
  return { profiles: [], recipes };
}

// Mirrors the home.tsx spec-commit collection loop (doughVariants map keyed by
// FAMILY name, one entry per variantLabel) and its candidate/draft build, then
// runs the real server push.
async function runImportPush(parsed: ParsedSpecImport): Promise<void> {
  const doughVariants = new Map<string, DoughballVariant[]>();
  const byName = new Map<string, { ingredient: string; lbs: number }[]>();
  const weights = new Map<string, number>();
  const trays = new Map<string, number>();
  for (const r of parsed.recipes) {
    if (r.kind !== "dough") continue;
    const name = r.name.trim();
    if (!name) continue;
    byName.set(name, r.rows.map((row) => ({ ...row })));
    if ((r.doughballOz ?? 0) > 0) weights.set(name.toLowerCase(), r.doughballOz!);
    if ((r.doughballsPerTray ?? 0) > 0) trays.set(name.toLowerCase(), r.doughballsPerTray!);
    const label = (r.variantLabel ?? r.name).trim();
    const v: DoughballVariant = { label };
    if ((r.doughballOz ?? 0) > 0) v.weightOz = r.doughballOz;
    if ((r.doughballsPerTray ?? 0) > 0) v.perTray = Math.round(r.doughballsPerTray!);
    if (label && (v.weightOz !== undefined || v.perTray !== undefined)) {
      const key = name.toLowerCase();
      const list = doughVariants.get(key) ?? [];
      list.push(v);
      doughVariants.set(key, list);
    }
  }
  const drafts = [...byName.entries()]
    .map(([name, components]) => namedRecipeFromDraft({ name, components, idPrefix: "dough" }))
    .filter((r): r is NamedRecipe => r !== null);
  await addNamedRecipesToServerIfAbsent("dough", drafts, undefined, weights, trays, doughVariants);
}

describe("mock dough sheet import — one family recipe carries all variants", () => {
  it("snaps all die-size variants onto the family recipe and saves ONE recipe with ALL variants", async () => {
    // The factory already keeps ONE recipe per dough family in the pool.
    pool = normalizeNamedRecipes([
      { id: "dough-crb", name: FAMILY, components: [{ ingredient: "Flour", lbs: 50 }] },
    ]);

    // Commit-time relink against the live pool (real lib): the workbook's
    // file-name family hint (passed by prepare, e.g. "CRB Dough Mixing
    // Procedure - 38.xlsx") anchors the sibling collapse — every variant name
    // snaps onto the family recipe, keeping its sheet name as variantLabel.
    // (Without the hint the fold is only a review suggestion now — beyond-
    // exact matches never apply silently.)
    const linked = linkSpecImportNamedRecipesToExisting(mockSheetParse(), "dough", pool.map((r) => r.name), { doughFamilyHint: FAMILY });
    const doughRecipes = linked.recipes.filter((r) => r.kind === "dough");
    expect(new Set(doughRecipes.map((r) => r.name))).toEqual(new Set([FAMILY]));
    expect(doughRecipes.map((r) => r.variantLabel)).toEqual(SHEET_VARIANTS.map((s) => s.name));

    await runImportPush(linked);

    // Exactly ONE dough recipe in the pool — no per-die duplicates minted.
    expect(pool).toHaveLength(1);
    expect(pool[0].name).toBe(FAMILY);

    // …and that one recipe carries ALL three variants' numbers.
    const variants = normalizeDoughballVariants(pool[0].doughballVariants);
    expect(variants).toHaveLength(SHEET_VARIANTS.length);
    for (const s of SHEET_VARIANTS) {
      const v = variants.find((x) => x.label === s.name);
      expect(v, `variant ${s.name}`).toBeDefined();
      expect(v!.weightOz).toBe(s.oz);
      expect(v!.perTray).toBe(s.perTray);
    }
  });

  it("re-import updates existing variant labels in place (no duplicates, values refreshed)", async () => {
    pool = normalizeNamedRecipes([
      { id: "dough-crb", name: FAMILY, components: [{ ingredient: "Flour", lbs: 50 }] },
    ]);
    const first = linkSpecImportNamedRecipesToExisting(mockSheetParse(), "dough", pool.map((r) => r.name), { doughFamilyHint: FAMILY });
    await runImportPush(first);
    expect(normalizeDoughballVariants(pool[0].doughballVariants)).toHaveLength(3);

    // The sheet is corrected: the 14" doughball is now 17 oz.
    const corrected = mockSheetParse();
    for (const r of corrected.recipes) {
      if (r.kind === "dough" && r.name.startsWith(`14"`)) r.doughballOz = 17;
    }
    const relinked = linkSpecImportNamedRecipesToExisting(corrected, "dough", pool.map((r) => r.name), { doughFamilyHint: FAMILY });
    await runImportPush(relinked);

    expect(pool).toHaveLength(1);
    const variants = normalizeDoughballVariants(pool[0].doughballVariants);
    expect(variants).toHaveLength(3); // same labels — updated, not duplicated
    expect(variants.find((v) => v.label === `14" CRB Recipe`)!.weightOz).toBe(17);
  });

  it("saved variants resolve at pick time: die size auto-matches, ambiguity falls back to manual", async () => {
    pool = normalizeNamedRecipes([
      { id: "dough-crb", name: FAMILY, components: [{ ingredient: "Flour", lbs: 50 }] },
    ]);
    const linked = linkSpecImportNamedRecipesToExisting(mockSheetParse(), "dough", pool.map((r) => r.name), { doughFamilyHint: FAMILY });
    await runImportPush(linked);
    const variants = normalizeDoughballVariants(pool[0].doughballVariants);

    // Die size resolves the variant — this is what the run form AND the Setup
    // Profiles editor call on dough pick.
    const m14 = matchDoughballVariant(variants, { dieType: `14" Round` });
    expect(m14?.label).toBe(`14" CRB Recipe`);
    expect(m14?.weightOz).toBe(16);

    // No die size → ambiguous across 3 variants → manual pick path (null).
    expect(matchDoughballVariant(variants, { dieType: "" })).toBeNull();
  });
});
