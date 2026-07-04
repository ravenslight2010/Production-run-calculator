// Mix reconciliation — the pure, deterministic engine behind the Mixes section's
// AI monitoring (web + mobile parity).
//
// "Monitoring" answers two questions about the manager-defined mixes:
//   1. Which products need a NEW mix?
//   2. Which existing mixes have DRIFTED (ingredients/amounts changed)?
//
// against two import sources the user chose to watch:
//   - PREMIX sheets (the mix workbooks). A premix sheet snapshot is the full set
//     of Mix[] it declared, so a premix reconcile is a Mix-vs-Mix diff and CAN
//     flag a brand-new mix (missing-mix) as well as every kind of component drift.
//   - SPEC sheets (the recipe spec workbooks already saved server-side). A mix is
//     a subset of a product's full recipe, so a spec reconcile reports DRIFT only
//     (amount-mismatch + extra-component); it never claims a product "needs" a new
//     mix, because most products legitimately don't pre-blend anything.
//
// The diff is fully deterministic and runs on BOTH clients (instant, free); the
// AI only narrates the already-computed discrepancies (see /ai/mix-reconcile).
// Each reconcile also produces per-mix `items` carrying a `suggestedMix` so the
// UI can offer a one-tap, manager-confirmed "apply" through the existing saveMixes
// write path — nothing here mutates anything.
//
// Units: a Mix component's `perPizza` is ounces-per-pizza, the SAME unit as a spec
// recipe row's `lbs` field (which the UI shows as oz-per-pizza), so amounts
// compare directly.

import { type Mix, type MixComponent, normalizeMix } from "@workspace/mixes";
import { recipeTargets, type ParsedRecipe } from "@workspace/spec-import";

// Default amount tolerance (oz/pizza). Per-pizza weights are small, so a tiny
// absolute epsilon is enough to ignore floating-point noise while still catching
// a real recipe change.
export const DEFAULT_MIX_AMOUNT_TOLERANCE = 0.0005;

export type MixDiscrepancySource = "premix" | "spec";

export type MixDiscrepancyType =
  | "missing-mix" // premix only: the sheet declares a mix that doesn't exist yet
  | "missing-component" // the sheet lists an ingredient the current mix lacks
  | "extra-component" // the current mix has an ingredient the sheet/spec doesn't list
  | "amount-mismatch"; // a per-pizza weight (or batch size) differs from the sheet/spec

export type MixDiscrepancy = {
  source: MixDiscrepancySource;
  type: MixDiscrepancyType;
  brand: string;
  flavor: string;
  mixName: string;
  /** Ingredient this line is about (omitted for missing-mix and batch-size lines). */
  ingredient?: string;
  /** The amount the sheet/spec calls for (per-pizza oz, or batch lbs). */
  sheetPerPizza?: number;
  /** The amount currently in the mix (per-pizza oz, or batch lbs). */
  mixPerPizza?: number;
  /** Plain-language description, used for the UI list and the AI prompt. */
  message: string;
};

export type MixReconcileItemStatus = "new" | "drift";

/** A per-mix grouping of discrepancies plus the exact Mix to upsert on apply. */
export type MixReconcileItem = {
  source: MixDiscrepancySource;
  status: MixReconcileItemStatus;
  brand: string;
  flavor: string;
  /** The current mix id (drift) or the sheet mix id (new). */
  mixId: string;
  mixName: string;
  discrepancies: MixDiscrepancy[];
  /** The Mix to write through saveMixes if the manager applies this item. */
  suggestedMix: Mix;
};

export type MixReconcileOutput = {
  discrepancies: MixDiscrepancy[];
  items: MixReconcileItem[];
};

/** One ingredient + its aggregated per-pizza ounces for a product, from a spec sheet. */
export type MixSpecRow = { ingredient: string; perPizza: number };

/** A product (brand+flavor) reduced to its per-pizza ingredient ounces, from a spec sheet. */
export type MixSpecProduct = { brand: string; flavor: string; rows: MixSpecRow[] };

function productKey(brand: string, flavor: string): string {
  return `${brand.trim().toLowerCase()}|${flavor.trim().toLowerCase()}`;
}

function ci(s: string): string {
  return s.trim().toLowerCase();
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

function fmt(n: number): string {
  return Number.isFinite(n) ? String(round4(n)) : "0";
}

function productLabel(m: { brand: string; flavor: string }): string {
  const b = m.brand.trim();
  const f = m.flavor.trim();
  if (b && f) return `${b} ${f}`;
  return b || f || "(unnamed product)";
}

/**
 * Flatten a parsed spec import into per-product ingredient ounces. Each recipe is
 * tied to every product in its `recipeTargets` (a single recipe can serve many
 * brand/flavor combos), and a product's recipe rows are aggregated by ingredient
 * (summed across dough/sauce/cheese) into a single per-pizza ounces figure — the
 * canonical basis a pre-blended mix component is compared against. Pure.
 */
export function specImportToMixProducts(
  parsed: { recipes?: ParsedRecipe[] } | null | undefined,
): MixSpecProduct[] {
  const recipes = parsed?.recipes ?? [];
  const products = new Map<
    string,
    { brand: string; flavor: string; rows: Map<string, MixSpecRow> }
  >();
  for (const recipe of recipes) {
    if (!recipe || !Array.isArray(recipe.rows)) continue;
    for (const t of recipeTargets(recipe)) {
      const k = productKey(t.brand, t.flavor);
      let entry = products.get(k);
      if (!entry) {
        entry = { brand: t.brand, flavor: t.flavor, rows: new Map() };
        products.set(k, entry);
      }
      for (const row of recipe.rows) {
        const ingredient = (row?.ingredient ?? "").trim();
        if (!ingredient) continue;
        const lbs =
          typeof row.lbs === "number" && Number.isFinite(row.lbs) ? row.lbs : 0;
        const ik = ci(ingredient);
        const existing = entry.rows.get(ik);
        if (existing) existing.perPizza += lbs;
        else entry.rows.set(ik, { ingredient, perPizza: lbs });
      }
    }
  }
  return [...products.values()].map((p) => ({
    brand: p.brand,
    flavor: p.flavor,
    rows: [...p.rows.values()],
  }));
}

/**
 * Reconcile the current mixes against a saved PREMIX sheet snapshot (the Mix[] it
 * declared). Mix-vs-Mix, so it reports the full set of discrepancies:
 *   - missing-mix: a sheet mix with no current counterpart (new mix needed),
 *   - missing-component / extra-component / amount-mismatch: per-ingredient drift,
 *   - a batch-size amount-mismatch.
 * A sheet mix matches a current mix by id first (premix ids are deterministic),
 * then by product + name (case-insensitive). The premix sheet is authoritative,
 * so a drift item's suggestedMix takes the sheet's components/batchSize/daysEarly
 * (keeping the current mix's operational state: id, scope, enabled, amountAlreadyMade).
 * Pure.
 */
export function reconcileMixesWithPremixSheet(input: {
  currentMixes: Mix[];
  sheetMixes: Mix[];
  tolerance?: number;
}): MixReconcileOutput {
  const tol = input.tolerance ?? DEFAULT_MIX_AMOUNT_TOLERANCE;
  const byId = new Map<string, Mix>();
  const byProductName = new Map<string, Mix>();
  for (const m of input.currentMixes) {
    byId.set(m.id, m);
    byProductName.set(`${productKey(m.brand, m.flavor)}|${ci(m.name)}`, m);
  }

  const discrepancies: MixDiscrepancy[] = [];
  const items: MixReconcileItem[] = [];
  const seen = new Set<string>();

  for (const raw of input.sheetMixes) {
    const sheet = normalizeMix(raw);
    if (!sheet) continue;
    if (seen.has(sheet.id)) continue;
    seen.add(sheet.id);

    const current =
      byId.get(sheet.id) ??
      byProductName.get(`${productKey(sheet.brand, sheet.flavor)}|${ci(sheet.name)}`);

    if (!current) {
      const disc: MixDiscrepancy = {
        source: "premix",
        type: "missing-mix",
        brand: sheet.brand,
        flavor: sheet.flavor,
        mixName: sheet.name,
        message: `No mix exists yet for "${sheet.name}" (${productLabel(sheet)}); the premix sheet defines it with ${sheet.components.length} ingredient${sheet.components.length === 1 ? "" : "s"} and a ${fmt(sheet.batchSize)} lb batch.`,
      };
      discrepancies.push(disc);
      items.push({
        source: "premix",
        status: "new",
        brand: sheet.brand,
        flavor: sheet.flavor,
        mixId: sheet.id,
        mixName: sheet.name,
        discrepancies: [disc],
        suggestedMix: sheet,
      });
      continue;
    }

    const mixDiscs: MixDiscrepancy[] = [];
    const currentByIng = new Map<string, MixComponent>();
    for (const c of current.components) currentByIng.set(ci(c.ingredient), c);
    const sheetByIng = new Map<string, MixComponent>();
    for (const c of sheet.components) sheetByIng.set(ci(c.ingredient), c);

    for (const sc of sheet.components) {
      const cc = currentByIng.get(ci(sc.ingredient));
      if (!cc) {
        mixDiscs.push({
          source: "premix",
          type: "missing-component",
          brand: current.brand,
          flavor: current.flavor,
          mixName: current.name,
          ingredient: sc.ingredient,
          sheetPerPizza: sc.perPizza,
          message: `"${current.name}" is missing ${sc.ingredient} (${fmt(sc.perPizza)} oz/pizza) that the premix sheet lists.`,
        });
      } else if (Math.abs(cc.perPizza - sc.perPizza) > tol) {
        mixDiscs.push({
          source: "premix",
          type: "amount-mismatch",
          brand: current.brand,
          flavor: current.flavor,
          mixName: current.name,
          ingredient: sc.ingredient,
          sheetPerPizza: sc.perPizza,
          mixPerPizza: cc.perPizza,
          message: `${sc.ingredient} in "${current.name}" is ${fmt(cc.perPizza)} oz/pizza but the premix sheet lists ${fmt(sc.perPizza)}.`,
        });
      }
    }
    for (const cc of current.components) {
      if (!sheetByIng.has(ci(cc.ingredient))) {
        mixDiscs.push({
          source: "premix",
          type: "extra-component",
          brand: current.brand,
          flavor: current.flavor,
          mixName: current.name,
          ingredient: cc.ingredient,
          mixPerPizza: cc.perPizza,
          message: `"${current.name}" includes ${cc.ingredient} (${fmt(cc.perPizza)} oz/pizza) that the premix sheet doesn't list.`,
        });
      }
    }
    if (Math.abs(current.batchSize - sheet.batchSize) > tol) {
      mixDiscs.push({
        source: "premix",
        type: "amount-mismatch",
        brand: current.brand,
        flavor: current.flavor,
        mixName: current.name,
        sheetPerPizza: sheet.batchSize,
        mixPerPizza: current.batchSize,
        message: `Batch size of "${current.name}" is ${fmt(current.batchSize)} lb but the premix sheet lists ${fmt(sheet.batchSize)} lb.`,
      });
    }

    if (mixDiscs.length === 0) continue;

    const suggestedMix: Mix = {
      ...current,
      batchSize: sheet.batchSize,
      daysEarly: sheet.daysEarly,
      components: sheet.components.map((c) => ({ ...c })),
    };
    if (sheet.notes) suggestedMix.notes = sheet.notes;

    discrepancies.push(...mixDiscs);
    items.push({
      source: "premix",
      status: "drift",
      brand: current.brand,
      flavor: current.flavor,
      mixId: current.id,
      mixName: current.name,
      discrepancies: mixDiscs,
      suggestedMix,
    });
  }

  return { discrepancies, items };
}

/**
 * Reconcile the current mixes against a saved SPEC sheet's per-product recipes.
 * A mix is a subset of a product's recipe, so this reports DRIFT only:
 *   - amount-mismatch: a mix component's per-pizza ounces differs from the spec,
 *   - extra-component: a mix component the spec recipe doesn't list (renamed/dropped).
 * It never emits missing-mix or missing-component (the spec recipe is a superset;
 * a mix legitimately pre-blends only some ingredients). Only enabled mixes whose
 * product appears on the spec sheet are checked. A drift item's suggestedMix syncs
 * the matched component amounts to the spec and leaves extra components untouched
 * (advisory — the manager decides whether to drop them). Pure.
 */
export function reconcileMixesWithSpec(input: {
  currentMixes: Mix[];
  specProducts: MixSpecProduct[];
  tolerance?: number;
}): MixReconcileOutput {
  const tol = input.tolerance ?? DEFAULT_MIX_AMOUNT_TOLERANCE;
  const specByProduct = new Map<string, MixSpecProduct>();
  for (const p of input.specProducts) specByProduct.set(productKey(p.brand, p.flavor), p);

  const discrepancies: MixDiscrepancy[] = [];
  const items: MixReconcileItem[] = [];

  for (const mix of input.currentMixes) {
    if (mix.enabled === false) continue;
    const spec = specByProduct.get(productKey(mix.brand, mix.flavor));
    if (!spec) continue;
    const specByIngredient = new Map<string, MixSpecRow>();
    for (const r of spec.rows) specByIngredient.set(ci(r.ingredient), r);

    const mixDiscs: MixDiscrepancy[] = [];
    const newComponents: MixComponent[] = [];
    for (const comp of mix.components) {
      const sr = specByIngredient.get(ci(comp.ingredient));
      if (!sr) {
        mixDiscs.push({
          source: "spec",
          type: "extra-component",
          brand: mix.brand,
          flavor: mix.flavor,
          mixName: mix.name,
          ingredient: comp.ingredient,
          mixPerPizza: comp.perPizza,
          message: `"${mix.name}" includes ${comp.ingredient} (${fmt(comp.perPizza)} oz/pizza), which isn't in the spec sheet for ${productLabel(mix)}.`,
        });
        newComponents.push({ ...comp });
        continue;
      }
      if (Math.abs(comp.perPizza - sr.perPizza) > tol) {
        mixDiscs.push({
          source: "spec",
          type: "amount-mismatch",
          brand: mix.brand,
          flavor: mix.flavor,
          mixName: mix.name,
          ingredient: comp.ingredient,
          sheetPerPizza: sr.perPizza,
          mixPerPizza: comp.perPizza,
          message: `${comp.ingredient} in "${mix.name}" is ${fmt(comp.perPizza)} oz/pizza but the spec sheet calls for ${fmt(sr.perPizza)}.`,
        });
        newComponents.push({ ingredient: comp.ingredient, perPizza: sr.perPizza });
      } else {
        newComponents.push({ ...comp });
      }
    }

    if (mixDiscs.length === 0) continue;
    discrepancies.push(...mixDiscs);
    items.push({
      source: "spec",
      status: "drift",
      brand: mix.brand,
      flavor: mix.flavor,
      mixId: mix.id,
      mixName: mix.name,
      discrepancies: mixDiscs,
      suggestedMix: { ...mix, components: newComponents },
    });
  }

  return { discrepancies, items };
}

/**
 * Render discrepancies as a compact bullet list for the AI narration prompt. The
 * AI only summarizes these already-computed lines — it can't invent or miss one.
 */
export function formatMixDiscrepanciesForPrompt(discrepancies: MixDiscrepancy[]): string {
  if (discrepancies.length === 0) {
    return "No discrepancies — the current mixes match the imported sheets.";
  }
  return discrepancies.map((d) => `- [${d.source}] ${d.message}`).join("\n");
}
