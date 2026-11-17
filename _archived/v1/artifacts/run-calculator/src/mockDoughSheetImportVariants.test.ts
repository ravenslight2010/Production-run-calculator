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

// ---------------------------------------------------------------------------
// Mirrors the customer-tagging loop in home.tsx handleSpecImportConfirm:
// given the linked parse + a profile map, assign each profile to the variant
// whose doughball weight matches, not just the first-listed variant.
// ---------------------------------------------------------------------------

interface ProfileLike {
  brand: string;
  flavor: string;
  doughRecipeName: string;
  targetDoughballWeight: number;
}

function tagVariantCustomers(
  linkedRecipes: ParsedRecipe[],
  doughVariants: Map<string, DoughballVariant[]>,
  profiles: ProfileLike[],
): Map<string, DoughballVariant[]> {
  // Deep-clone so the original map is not mutated.
  const result = new Map<string, DoughballVariant[]>();
  for (const [k, vs] of doughVariants) result.set(k, vs.map((v) => ({ ...v })));

  for (const profile of profiles) {
    const dName = profile.doughRecipeName.trim().toLowerCase();
    if (!dName) continue;
    const familyVariants = result.get(dName);
    if (!familyVariants) continue;

    // The production logic: a stored weight must identify exactly one FULL
    // family variant (including any yield-table rows); no stored weight is
    // usable only for a single-variant family.
    const profileWeight = Number(profile.targetDoughballWeight ?? 0);
    const candidates =
      profileWeight > 0
        ? familyVariants.filter(
            (variant) =>
              Math.abs(Number(variant.weightOz ?? 0) - profileWeight) <= 0.1,
          )
        : familyVariants.length === 1
          ? [familyVariants[0]!]
          : [];
    if (candidates.length !== 1) continue;
    const variant = candidates[0]!;
    const idx = familyVariants.indexOf(variant);
    if (idx < 0) continue;
    const already = (variant.customers ?? []).some(
      (c) =>
        c.brand.trim().toLowerCase() === profile.brand.trim().toLowerCase() &&
        c.flavor.trim().toLowerCase() === profile.flavor.trim().toLowerCase(),
    );
    if (!already) {
      familyVariants[idx] = {
        ...variant,
        customers: [...(variant.customers ?? []), { brand: profile.brand, flavor: profile.flavor }],
      };
    }
  }
  return result;
}

describe("variant customer tagging — weight-based match (bug fix)", () => {
  // Three variants of one family, each a different doughball weight.
  const linkedRecipes: ParsedRecipe[] = [
    {
      kind: "dough",
      name: FAMILY,
      rows: [{ ingredient: "Flour", lbs: 50 }],
      doughballOz: 10,
      doughballsPerTray: 24,
      variantLabel: `11" CRB Recipe`,
    },
    {
      kind: "dough",
      name: FAMILY,
      rows: [{ ingredient: "Flour", lbs: 50 }],
      doughballOz: 16,
      doughballsPerTray: 18,
      variantLabel: `14" CRB Recipe`,
    },
    {
      kind: "dough",
      name: FAMILY,
      rows: [{ ingredient: "Flour", lbs: 50 }],
      doughballOz: 22,
      doughballsPerTray: 12,
      variantLabel: `16" CRB Recipe`,
    },
  ];

  // Build the doughVariants map (mirrors home.tsx spec-commit collection loop).
  function buildVariants(): Map<string, DoughballVariant[]> {
    const dv = new Map<string, DoughballVariant[]>();
    for (const r of linkedRecipes) {
      if (r.kind !== "dough") continue;
      const key = r.name.trim().toLowerCase();
      if (!dv.has(key)) dv.set(key, []);
      const label = (r.variantLabel ?? r.name).trim();
      const v: DoughballVariant = { label };
      if ((r.doughballOz ?? 0) > 0) v.weightOz = r.doughballOz;
      if ((r.doughballsPerTray ?? 0) > 0) v.perTray = Math.round(r.doughballsPerTray!);
      if (label && (v.weightOz !== undefined || v.perTray !== undefined)) {
        dv.get(key)!.push(v);
      }
    }
    return dv;
  }

  it("each profile is tagged to its OWN weight variant, not always the first", () => {
    const profiles: ProfileLike[] = [
      { brand: "SmallBrand", flavor: "Cheese", doughRecipeName: FAMILY, targetDoughballWeight: 10 },
      { brand: "MedBrand", flavor: "Pepperoni", doughRecipeName: FAMILY, targetDoughballWeight: 16 },
      { brand: "LargeBrand", flavor: "Supreme", doughRecipeName: FAMILY, targetDoughballWeight: 22 },
    ];

    const tagged = tagVariantCustomers(linkedRecipes, buildVariants(), profiles);
    const variants = tagged.get(FAMILY.toLowerCase())!;

    const v11 = variants.find((v) => v.label === `11" CRB Recipe`)!;
    const v14 = variants.find((v) => v.label === `14" CRB Recipe`)!;
    const v16 = variants.find((v) => v.label === `16" CRB Recipe`)!;

    // Each profile must land on the variant whose weight matches.
    expect(v11.customers?.map((c) => c.brand)).toEqual(["SmallBrand"]);
    expect(v14.customers?.map((c) => c.brand)).toEqual(["MedBrand"]);
    expect(v16.customers?.map((c) => c.brand)).toEqual(["LargeBrand"]);
  });

  it("old code (first-match .find) would tag all profiles to the first variant", () => {
    // Demonstrates the regression the fix addresses: a plain .find() without
    // weight matching always returns the first recipe (oz=10) regardless of
    // the profile's actual doughball weight.
    const buggyFind = (recipes: ParsedRecipe[], dName: string) =>
      recipes.find((r) => r.kind === "dough" && r.name.trim().toLowerCase() === dName && r.variantLabel);

    const profiles: ProfileLike[] = [
      { brand: "SmallBrand", flavor: "Cheese", doughRecipeName: FAMILY, targetDoughballWeight: 10 },
      { brand: "MedBrand", flavor: "Pepperoni", doughRecipeName: FAMILY, targetDoughballWeight: 16 },
    ];

    // Collect which labels the buggy .find picks for each profile.
    const buggyLabels = profiles.map((p) => {
      const r = buggyFind(linkedRecipes, p.doughRecipeName.trim().toLowerCase());
      return r?.variantLabel ?? null;
    });

    // Both profiles end up linked to the FIRST variant — demonstrating the bug.
    expect(buggyLabels).toEqual([`11" CRB Recipe`, `11" CRB Recipe`]);
  });

  it("weight-based search with tolerance: 10.05 oz matches the 10 oz variant", () => {
    // Tolerance of ±0.1 oz handles floating-point and rounding differences.
    const profiles: ProfileLike[] = [
      { brand: "FloatBrand", flavor: "Thin", doughRecipeName: FAMILY, targetDoughballWeight: 10.05 },
    ];
    const tagged = tagVariantCustomers(linkedRecipes, buildVariants(), profiles);
    const v11 = tagged.get(FAMILY.toLowerCase())!.find((v) => v.label === `11" CRB Recipe`)!;
    expect(v11.customers?.map((c) => c.brand)).toEqual(["FloatBrand"]);
  });

  it("does not tag an AI row when a yield-table sibling has the same weight", () => {
    const variants = buildVariants();
    variants.get(FAMILY.toLowerCase())!.push({
      label: `11" CRB Table Row`,
      weightOz: 10,
      perTray: 20,
    });
    const tagged = tagVariantCustomers(linkedRecipes, variants, [
      { brand: "AmbiguousBrand", flavor: "Cheese", doughRecipeName: FAMILY, targetDoughballWeight: 10 },
    ]);
    expect(
      tagged.get(FAMILY.toLowerCase())!.every(
        (variant) => !variant.customers?.some((customer) => customer.brand === "AmbiguousBrand"),
      ),
    ).toBe(true);
  });

  it("does not infer a customer assignment when the profile has no stored weight", () => {
    // A profile with no weight has no source evidence for one of the several
    // variants, so it must stay unassigned rather than landing on the first row.
    const profiles: ProfileLike[] = [
      { brand: "NoBrand", flavor: "Cheese", doughRecipeName: FAMILY, targetDoughballWeight: 0 },
    ];
    const tagged = tagVariantCustomers(linkedRecipes, buildVariants(), profiles);
    expect(
      tagged.get(FAMILY.toLowerCase())!.every(
        (variant) => !variant.customers?.some((customer) => customer.brand === "NoBrand"),
      ),
    ).toBe(true);
  });
});

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
