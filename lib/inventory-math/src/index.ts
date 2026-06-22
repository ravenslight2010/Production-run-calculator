// Shared, pure consumption/summary math for the production-run calculator.
//
// This is the single source of truth for the per-run material totals and the
// inventory consumption mapping that BOTH the web app
// (artifacts/run-calculator) and the mobile app (artifacts/run-calculator-mobile)
// must compute identically (replit.md parity rule). Only platform glue
// (REST/SSE clients, storage, auth) stays per-app; the formulas live here so the
// two apps can't drift.
//
// `DEFAULT_PEP_TYPES` is deliberately NOT moved into this package: it is heavily
// entangled in each app (used as a seed list and referenced widely). It is
// injected as a parameter so each app keeps owning its own copy while the math
// stays shared.

export type RecipeRow = { ingredient: string; lbs: number };

export type InventoryCategory = "ingredient" | "packaging";

export type ConsumeLine = { itemKey: string; qty: number };
export type CandidateItem = {
  key: string;
  category: InventoryCategory;
  name: string;
  unit: string;
};
export type RunLine = CandidateItem & { qty: number };

// Fields consumed by `computeSummaryStats`. Both the web `FormValues` and the
// mobile `RunSettings` are structurally assignable to this shape; the only
// field-name difference between the two app shapes (doughball weight) is not
// used here — it lives on `RunLinesInput` below.
export interface SummaryStatsInput {
  casesNeeded: number;
  pizzasPerCase: number;
  casesPerLayer: number;
  frontlineRecipe?: RecipeRow[];
  sauceBarrelLbs: number;
  sauceOzPerPizza: number;
  app1OzPerPizza: number;
  app1BatchLbs: number;
  app1Type: string;
  app1CheeseRecipe?: RecipeRow[];
  app2OzPerPizza: number;
  app2BatchLbs: number;
  app2Type: string;
  app2CheeseRecipe?: RecipeRow[];
  app3OzPerPizza: number;
  app3BatchLbs: number;
  app3Type: string;
  app3CheeseRecipe?: RecipeRow[];
  app4OzPerPizza: number;
  app4BatchLbs: number;
  app4Type: string;
  app4CheeseRecipe?: RecipeRow[];
  pep1OzPerPizza: number;
  pep1Sticks: number;
  pep1BatchLbs: number;
  pep1Type: string;
  pep2OzPerPizza: number;
  pep2Sticks: number;
  pep2BatchLbs: number;
  pep2Type: string;
  crustsPerCycle: number;
  cycleSpeed: number;
  speedAdjustment: number;
}

// Fields consumed by `computeRunLines` (everything `computeSummaryStats` needs,
// plus dough + packaging inputs). `doughballWeightOz` is the canonical field
// name; the web app maps its `targetDoughballWeight` onto it in its wrapper.
export interface RunLinesInput extends SummaryStatsInput {
  doughRecipe?: RecipeRow[];
  doughballWeightOz: number;
  doughBatchYield: number;
  cartoned?: string;
  circles?: string;
  shipper?: string;
  cartonsPerCase: number;
}

export type SummaryStats = ReturnType<typeof computeSummaryStats>;

export function computeSummaryStats(
  vals: SummaryStatsInput,
  defaultPepTypes: readonly string[],
) {
  const totalPizzas = vals.casesNeeded * vals.pizzasPerCase;
  const totalPizzasForSauce = totalPizzas + vals.casesPerLayer * vals.pizzasPerCase;
  const frontlineRecipeLbs = (vals.frontlineRecipe ?? []).reduce((s, r) => s + Number(r.lbs ?? 0), 0);
  const sauceEffBarrel = frontlineRecipeLbs > 0 ? frontlineRecipeLbs : vals.sauceBarrelLbs;
  const sauceLbs = (totalPizzasForSauce * vals.sauceOzPerPizza) / 16 + 30;
  const sauceBatches = sauceEffBarrel > 0 ? sauceLbs / sauceEffBarrel : 0;
  const app1RecipeLbs = (vals.app1CheeseRecipe ?? []).reduce((s, r) => s + Number(r.lbs ?? 0), 0);
  const app1Lbs = (totalPizzasForSauce * vals.app1OzPerPizza) / 16 + 20;
  const app1IsMix = vals.app1Type.trim().toLowerCase().includes("mix");
  const app1EffBatch = app1RecipeLbs > 0 ? app1RecipeLbs : vals.app1BatchLbs;
  const app1Batches = !app1IsMix && app1EffBatch > 0 ? app1Lbs / app1EffBatch : 0;
  const app2RecipeLbs = (vals.app2CheeseRecipe ?? []).reduce((s, r) => s + Number(r.lbs ?? 0), 0);
  const app2Lbs = (totalPizzasForSauce * vals.app2OzPerPizza) / 16 + 20;
  const app2IsMix = vals.app2Type.trim().toLowerCase().includes("mix");
  const app2EffBatch = app2RecipeLbs > 0 ? app2RecipeLbs : vals.app2BatchLbs;
  const app2Batches = !app2IsMix && app2EffBatch > 0 ? app2Lbs / app2EffBatch : 0;
  const app3RecipeLbs = (vals.app3CheeseRecipe ?? []).reduce((s, r) => s + Number(r.lbs ?? 0), 0);
  const app3Lbs = (totalPizzasForSauce * vals.app3OzPerPizza) / 16 + 20;
  const app3IsMix = vals.app3Type.trim().toLowerCase().includes("mix");
  const app3EffBatch = app3RecipeLbs > 0 ? app3RecipeLbs : vals.app3BatchLbs;
  const app3Batches = !app3IsMix && app3EffBatch > 0 ? app3Lbs / app3EffBatch : 0;
  const app4RecipeLbs = (vals.app4CheeseRecipe ?? []).reduce((s, r) => s + Number(r.lbs ?? 0), 0);
  const app4Lbs = (totalPizzasForSauce * vals.app4OzPerPizza) / 16 + 20;
  const app4IsMix = vals.app4Type.trim().toLowerCase().includes("mix");
  const app4EffBatch = app4RecipeLbs > 0 ? app4RecipeLbs : vals.app4BatchLbs;
  const app4Batches = !app4IsMix && app4EffBatch > 0 ? app4Lbs / app4EffBatch : 0;
  const pep1Lbs = (totalPizzasForSauce * vals.pep1OzPerPizza) / 16 + vals.pep1Sticks;
  const pep1Batches =
    !defaultPepTypes.includes(vals.pep1Type ?? "") && vals.pep1BatchLbs > 0
      ? pep1Lbs / vals.pep1BatchLbs
      : 0;
  const pep2Lbs = (totalPizzasForSauce * vals.pep2OzPerPizza) / 16 + vals.pep2Sticks;
  const pep2Batches =
    !defaultPepTypes.includes(vals.pep2Type ?? "") && vals.pep2BatchLbs > 0
      ? pep2Lbs / vals.pep2BatchLbs
      : 0;
  const ppm = vals.crustsPerCycle * vals.cycleSpeed * vals.speedAdjustment;
  const estimatedTimeSec = ppm > 0 ? (totalPizzas * 60) / ppm : 0;
  return {
    totalCases: vals.casesNeeded,
    totalPizzas,
    estimatedTimeSec,
    sauceBatches,
    sauceEffBarrel,
    app1Lbs, app1Batches, app1Type: vals.app1Type,
    app2Lbs, app2Batches, app2Type: vals.app2Type,
    app3Lbs, app3Batches, app3Type: vals.app3Type,
    app4Lbs, app4Batches, app4Type: vals.app4Type,
    pep1Lbs, pep1Batches, pep1Type: vals.pep1Type ?? "",
    pep2Lbs, pep2Batches, pep2Type: vals.pep2Type ?? "",
  };
}

// ── Per-run consumption mapping ──────────────────────────────────────────────
// Mirrors the warehouse roll-up (aggregateNeedRows + aggregatePackagingNeeds in
// the web home screen) so inventory item keys line up exactly with production
// demand. Keys are stable identities; the server treats unknown keys as no-ops.
export function computeRunLines(
  vals: RunLinesInput,
  defaultPepTypes: readonly string[],
): RunLine[] {
  const map = new Map<string, RunLine>();
  const add = (key: string, category: InventoryCategory, name: string, unit: string, qty: number) => {
    if (!(qty > 0)) return;
    const ex = map.get(key);
    if (ex) ex.qty += qty;
    else map.set(key, { key, category, name, unit, qty });
  };

  const s = computeSummaryStats(vals, defaultPepTypes);

  // Dough — batches = ceil(totalPizzas / effective yield)
  const dRecipeLbs = (vals.doughRecipe ?? []).reduce((acc, r) => acc + Number(r.lbs ?? 0), 0);
  const effYield =
    dRecipeLbs > 0 && vals.doughballWeightOz > 0
      ? (dRecipeLbs * 16) / vals.doughballWeightOz
      : vals.doughBatchYield;
  if (effYield > 0 && vals.doughballWeightOz > 0) {
    const batches = Math.ceil(s.totalPizzas / effYield);
    add("ingredient:Dough:batches", "ingredient", "Dough", "batches", batches);
  }

  // Sauce
  if (s.sauceBatches > 0) {
    add("ingredient:Sauce:batches", "ingredient", "Sauce", "batches", s.sauceBatches);
  }

  // Applicators (cheese / mixes)
  const apps = [
    { type: s.app1Type, lbs: s.app1Lbs, batches: s.app1Batches },
    { type: s.app2Type, lbs: s.app2Lbs, batches: s.app2Batches },
    { type: s.app3Type, lbs: s.app3Lbs, batches: s.app3Batches },
    { type: s.app4Type, lbs: s.app4Lbs, batches: s.app4Batches },
  ];
  for (const a of apps) {
    const type = (a.type ?? "").trim();
    if (!type) continue;
    const isMix = type.toLowerCase().includes("mix");
    if (isMix && a.lbs > 0) add(`ingredient:${type}:lbs`, "ingredient", type, "lbs", a.lbs);
    else if (!isMix && a.batches > 0) add(`ingredient:${type}:batches`, "ingredient", type, "batches", a.batches);
  }

  // Pepperoni / toppings — trim type identically across apps so keys/std-vs-batch
  // classification stay in parity even when the type has stray whitespace.
  const pep1Type = (s.pep1Type ?? "").trim();
  if (pep1Type && s.pep1Lbs > 0) {
    const std = defaultPepTypes.includes(pep1Type);
    if (std) add(`ingredient:${pep1Type}:lbs`, "ingredient", pep1Type, "lbs", s.pep1Lbs);
    else add(`ingredient:${pep1Type}:batches`, "ingredient", pep1Type, "batches", s.pep1Batches);
  }
  const pep2Type = (s.pep2Type ?? "").trim();
  if (pep2Type && s.pep2Lbs > 0) {
    const std = defaultPepTypes.includes(pep2Type);
    if (std) add(`ingredient:${pep2Type}:lbs`, "ingredient", pep2Type, "lbs", s.pep2Lbs);
    else add(`ingredient:${pep2Type}:batches`, "ingredient", pep2Type, "batches", s.pep2Batches);
  }

  // Packaging — only cartoned runs consume packaging
  if ((vals.cartoned ?? "").trim().toLowerCase() === "yes") {
    const circle = (vals.circles ?? "").trim();
    if (circle && circle.toLowerCase() !== "none" && s.totalPizzas > 0) {
      add(`packaging:circles:${circle}`, "packaging", `Circles — ${circle}`, "circles", s.totalPizzas);
    }
    const shipper = (vals.shipper ?? "").trim();
    if (shipper && shipper.toLowerCase() !== "none" && s.totalCases > 0) {
      add(`packaging:shippers:${shipper}`, "packaging", `Shippers — ${shipper}`, "shippers", s.totalCases);
    }
    const perCase = Number(vals.cartonsPerCase) || 0;
    if (perCase > 0 && s.totalPizzas > 0) {
      add("packaging:cartons:cases", "packaging", "Cartons", "cases", Math.ceil(s.totalPizzas / perCase));
    }
  }

  return [...map.values()];
}

export function computeRunConsumptionLines(
  vals: RunLinesInput,
  defaultPepTypes: readonly string[],
): ConsumeLine[] {
  return computeRunLines(vals, defaultPepTypes).map((l) => ({ itemKey: l.key, qty: l.qty }));
}

// ── Temporary recipe substitutions (day-state overlay) ───────────────────────
//
// When an ingredient runs low/out, floor staff overlay today's recipes with a
// temporary substitution that applies to ALL of today's runs containing the
// affected ingredient. The overlay is PURE and SHARED so material totals and
// inventory consumption keys are computed from the substituted recipe
// identically on web and mobile (replit.md parity). Substitutions live in the
// synced day-state (not master data), so they auto-revert at the daily reset.
//
// An overlay can target two surfaces of a run's settings:
//   1. Recipe rows ({ingredient, lbs}) in doughRecipe / frontlineRecipe /
//      app1..4CheeseRecipe — matched by row ingredient name.
//   2. Applicator / pepperoni TYPE fields (app1..4Type, pep1Type, pep2Type) —
//      matched by field value. Swapping a type changes the inventory
//      consumption key so the substitute is drawn down and the short item is not.

export type SubstitutionAction = "swap" | "add" | "remove";

export type IngredientSubstitution = {
  id: string;
  /** The affected (short) ingredient name, matched case-insensitively. */
  ingredient: string;
  action: SubstitutionAction;
  /** For swap/add: the replacement / supplemental ingredient name. */
  substitute?: string;
  /** For swap/add: the substitute's amount (lbs) on a recipe row. */
  amount?: number;
};

// Plain-language description of a single substitution, shown in the manage
// panel, the recipe badge, and the activity log. Shared so web and mobile read
// identically (replit.md parity).
export function describeSubstitution(s: IngredientSubstitution): string {
  const amt = s.amount != null && s.amount > 0 ? ` (${s.amount} lbs)` : "";
  if (s.action === "remove") return `Remove ${s.ingredient}`;
  if (s.action === "add") return `Add ${s.substitute ?? ""}${amt} alongside ${s.ingredient}`;
  return `Swap ${s.ingredient} → ${s.substitute ?? ""}${amt}`;
}

// A timestamped record of a substitution being added or cleared during the day,
// for shift handoffs and end-of-day review. Lives in the synced day-state
// alongside the active substitutions and auto-clears at the daily reset. Purely
// a read-only audit trail — it never feeds the calc/consumption engine.
export type SubstitutionLogEntry = {
  id: string;
  /** Epoch ms when the action happened. */
  ts: number;
  /** Whether a substitution was added/replaced or removed/cleared. */
  kind: "added" | "cleared";
  /** Plain-language summary of the substitution (see describeSubstitution). */
  description: string;
  /** Username of whoever performed the action, when known. */
  user?: string;
};

// Applicator + pepperoni type fields an overlay can rewrite (changing the
// consumption key for that slot).
export const SUBSTITUTION_TYPE_FIELDS = [
  "app1Type",
  "app2Type",
  "app3Type",
  "app4Type",
  "pep1Type",
  "pep2Type",
] as const;

// Recipe-row arrays an overlay can rewrite.
export const SUBSTITUTION_RECIPE_FIELDS = [
  "doughRecipe",
  "frontlineRecipe",
  "app1CheeseRecipe",
  "app2CheeseRecipe",
  "app3CheeseRecipe",
  "app4CheeseRecipe",
] as const;

function normSubName(s: unknown): string {
  return typeof s === "string" ? s.trim().toLowerCase() : "";
}

/** Active substitutions whose affected ingredient matches `name` (case-insensitive). */
export function substitutionsForIngredient(
  subs: readonly IngredientSubstitution[] | undefined,
  name: string,
): IngredientSubstitution[] {
  const target = normSubName(name);
  if (!target) return [];
  return (subs ?? []).filter((s) => normSubName(s.ingredient) === target);
}

/**
 * Apply the day's substitutions to a single recipe-row array. Pure; returns the
 * effective rows plus whether anything changed (for "temporary override" labels).
 *   - swap:   matching row → { substitute, amount ?? original lbs }
 *   - add:    keep the row, append { substitute, amount }
 *   - remove: drop the row
 */
export function applyRecipeSubstitutions(
  rows: readonly RecipeRow[] | undefined,
  subs: readonly IngredientSubstitution[] | undefined,
): { rows: RecipeRow[]; changed: boolean } {
  const list = rows ?? [];
  if (!subs || subs.length === 0) return { rows: list.map((r) => ({ ...r })), changed: false };
  let changed = false;
  const out: RecipeRow[] = [];
  for (const row of list) {
    const matches = substitutionsForIngredient(subs, row.ingredient);
    if (matches.length === 0) {
      out.push({ ...row });
      continue;
    }
    // Apply each matching substitution to this row, in order. Once a swap/remove
    // rewrites the row's identity it no longer matches later subs for the
    // original name, which is the intended single-overlay behavior.
    let current: RecipeRow | null = { ...row };
    const supplements: RecipeRow[] = [];
    for (const sub of matches) {
      if (sub.action === "remove") {
        current = null;
        changed = true;
        break;
      }
      if (sub.action === "swap" && current) {
        const subName = (sub.substitute ?? "").trim();
        if (subName) {
          current = { ingredient: subName, lbs: numOr(sub.amount, current.lbs) };
          changed = true;
        }
      } else if (sub.action === "add") {
        const subName = (sub.substitute ?? "").trim();
        if (subName) {
          supplements.push({ ingredient: subName, lbs: numOr(sub.amount, 0) });
          changed = true;
        }
      }
    }
    if (current) out.push(current);
    out.push(...supplements);
  }
  return { rows: out, changed };
}

function numOr(v: unknown, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function hasName(v: unknown): boolean {
  return typeof v === "string" && v.trim().length > 0;
}

/**
 * Apply the day's substitutions to a run's settings/values object, returning a
 * shallow clone with substituted recipe arrays AND type fields. Drives BOTH the
 * material totals (computeSummaryStats) and the consumption keys (computeRunLines)
 * so the substitute is drawn down and the short item is not. Pure — never mutates
 * the input, so the overlay reverts cleanly when the substitution is cleared.
 */
export function applySubstitutions<T extends Record<string, unknown>>(
  vals: T,
  subs: readonly IngredientSubstitution[] | undefined,
): T {
  if (!subs || subs.length === 0) return vals;
  const out: Record<string, unknown> = { ...vals };
  // Recipe-row arrays
  for (const field of SUBSTITUTION_RECIPE_FIELDS) {
    const arr = out[field];
    if (!Array.isArray(arr)) continue;
    const { rows, changed } = applyRecipeSubstitutions(arr as RecipeRow[], subs);
    if (changed) out[field] = rows;
  }
  // Applicator / pepperoni type fields — swap rewrites the key, remove clears it.
  // "add" never rewrites a type slot (a single slot can't hold a supplement).
  for (const field of SUBSTITUTION_TYPE_FIELDS) {
    const cur = out[field];
    if (typeof cur !== "string" || !cur.trim()) continue;
    const matches = substitutionsForIngredient(subs, cur);
    for (const sub of matches) {
      if (sub.action === "remove") {
        out[field] = "";
        break;
      }
      if (sub.action === "swap" && hasName(sub.substitute)) {
        out[field] = sub.substitute!.trim();
      }
    }
  }
  return out as T;
}

// Distinct candidate items across the given runs, for the "add from production"
// picker. Deduped by stable key; quantities are dropped.
export function deriveCandidateItems(
  valsList: RunLinesInput[],
  defaultPepTypes: readonly string[],
): CandidateItem[] {
  const map = new Map<string, CandidateItem>();
  for (const vals of valsList) {
    for (const l of computeRunLines(vals, defaultPepTypes)) {
      if (!map.has(l.key)) map.set(l.key, { key: l.key, category: l.category, name: l.name, unit: l.unit });
    }
  }
  return [...map.values()];
}

// ── Multi-location transfer warnings ─────────────────────────────────────────
//
// Stock can live in several named locations, but production auto-deduction only
// draws from the single onsite/line location. `aggregateRunDemand` rolls the
// per-run consumption lines up into the total material demand for a set of runs
// (the planned + scheduled runs of the day), summing quantities by item key.
// `computeTransferNeeds` then compares that demand against the per-location
// on-hand and flags items where the onsite location can't cover demand while
// another location holds stock that could be transferred in. Both are PURE and
// SHARED so web and mobile raise identical warnings (replit.md parity).

// Total demand across the given runs, summed by item key. Same keys/units as
// computeRunLines (the deduction basis), so demand lines up exactly with what
// auto-consumption will draw down.
export function aggregateRunDemand(
  valsList: RunLinesInput[],
  defaultPepTypes: readonly string[],
): RunLine[] {
  const map = new Map<string, RunLine>();
  for (const vals of valsList) {
    for (const l of computeRunLines(vals, defaultPepTypes)) {
      const ex = map.get(l.key);
      if (ex) ex.qty += l.qty;
      else map.set(l.key, { ...l });
    }
  }
  return [...map.values()];
}

// On-hand for one item at one location. `isOnsite` marks the single location
// production deducts from.
export type LocationStock = {
  locationId: number;
  locationName: string;
  isOnsite: boolean;
  onHand: number;
};

// An item whose onsite stock can't cover demand while another location holds
// transferable stock. `transferable` is the amount that could actually be moved
// in (capped at the shortfall). `sources` lists the offsite locations holding
// stock, largest first.
export type TransferNeed = {
  key: string;
  name: string;
  unit: string;
  category: InventoryCategory;
  needed: number;
  onsite: number;
  shortfall: number;
  offsiteAvailable: number;
  transferable: number;
  sources: { locationId: number; locationName: string; onHand: number }[];
};

// Demand line shape accepted by computeTransferNeeds (a RunLine, but only these
// fields are read).
export type TransferDemand = {
  key: string;
  name: string;
  unit: string;
  category: InventoryCategory;
  qty: number;
};

// Compare aggregated demand against per-location stock and return the items that
// need a transfer: onsite on-hand is short of demand AND another location holds
// stock that could be moved in. Pure; quantities are compared with a tiny
// epsilon so floating-point batch math doesn't raise spurious sub-unit warnings.
export function computeTransferNeeds(input: {
  demands: TransferDemand[];
  stockByKey: Record<string, LocationStock[]>;
}): TransferNeed[] {
  const EPS = 1e-6;
  const out: TransferNeed[] = [];
  for (const d of input.demands) {
    const needed = Number(d.qty) || 0;
    if (!(needed > 0)) continue;
    const stock = input.stockByKey[d.key] ?? [];
    let onsite = 0;
    const sources: { locationId: number; locationName: string; onHand: number }[] = [];
    for (const s of stock) {
      const onHand = Number(s.onHand) || 0;
      if (s.isOnsite) {
        onsite += onHand;
      } else if (onHand > 0) {
        sources.push({ locationId: s.locationId, locationName: s.locationName, onHand });
      }
    }
    const offsiteAvailable = sources.reduce((acc, s) => acc + s.onHand, 0);
    const shortfall = needed - onsite;
    if (shortfall > EPS && offsiteAvailable > EPS) {
      sources.sort((a, b) => b.onHand - a.onHand);
      out.push({
        key: d.key,
        name: d.name,
        unit: d.unit,
        category: d.category,
        needed,
        onsite,
        shortfall,
        offsiteAvailable,
        transferable: Math.min(shortfall, offsiteAvailable),
        sources,
      });
    }
  }
  return out;
}
