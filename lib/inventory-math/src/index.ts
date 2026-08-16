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
  /**
   * Sauce recipe name. When set WITHOUT any `frontlineRecipe` rows it marks a
   * bought/ready-made sauce used as-is (e.g. BBQ, Ranch): consumption and the
   * warehouse needs roll-up pull it by this name in LBS instead of generic
   * mixed "Sauce" batches. Optional so callers that never set it are unaffected.
   */
  frontlineRecipeName?: string;
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
  // Web-only "combine applicator 1 & 2" flag + optional additional pep type per
  // applicator. All optional so mobile (which never sets them) is unaffected:
  // combined is treated as false unless STRICTLY true, and B slots are ignored
  // unless their type is non-empty.
  pep1Combined?: boolean;
  pep1TypeB?: string;
  pep1OzPerPizzaB?: number;
  pep1SticksB?: number;
  pep1BatchLbsB?: number;
  pep2TypeB?: string;
  pep2OzPerPizzaB?: number;
  pep2SticksB?: number;
  pep2BatchLbsB?: number;
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
  // Applicator 1 & 2 combined: one pep type runs through both physical
  // applicators, so applicator 1's stick buffer is doubled and applicator 2 is
  // suppressed. STRICT === true so mobile (never sets the flag) is unaffected.
  const pepCombined = vals.pep1Combined === true;
  const pepStickMult = pepCombined ? 2 : 1;
  const pep1Lbs = (totalPizzasForSauce * vals.pep1OzPerPizza) / 16 + vals.pep1Sticks * pepStickMult;
  const pep1Batches =
    !defaultPepTypes.includes(vals.pep1Type ?? "") && vals.pep1BatchLbs > 0
      ? pep1Lbs / vals.pep1BatchLbs
      : 0;
  // Additional pep type on applicator 1 (only when its type is set). Its stick
  // buffer also doubles when combined (both physical applicators run it too).
  const pep1TypeBTrim = (vals.pep1TypeB ?? "").trim();
  const pep1LbsB = pep1TypeBTrim
    ? (totalPizzasForSauce * (vals.pep1OzPerPizzaB ?? 0)) / 16 + (vals.pep1SticksB ?? 0) * pepStickMult
    : 0;
  const pep1BatchesB =
    pep1TypeBTrim && !defaultPepTypes.includes(pep1TypeBTrim) && (vals.pep1BatchLbsB ?? 0) > 0
      ? pep1LbsB / (vals.pep1BatchLbsB ?? 1)
      : 0;
  // Applicator 2 (and its additional type) are suppressed entirely when combined.
  const pep2Lbs = pepCombined ? 0 : (totalPizzasForSauce * vals.pep2OzPerPizza) / 16 + vals.pep2Sticks;
  const pep2Batches =
    !pepCombined && !defaultPepTypes.includes(vals.pep2Type ?? "") && vals.pep2BatchLbs > 0
      ? pep2Lbs / vals.pep2BatchLbs
      : 0;
  const pep2TypeBTrim = (vals.pep2TypeB ?? "").trim();
  const pep2LbsB =
    !pepCombined && pep2TypeBTrim
      ? (totalPizzasForSauce * (vals.pep2OzPerPizzaB ?? 0)) / 16 + (vals.pep2SticksB ?? 0)
      : 0;
  const pep2BatchesB =
    !pepCombined && pep2TypeBTrim && !defaultPepTypes.includes(pep2TypeBTrim) && (vals.pep2BatchLbsB ?? 0) > 0
      ? pep2LbsB / (vals.pep2BatchLbsB ?? 1)
      : 0;
  const ppm = vals.crustsPerCycle * vals.cycleSpeed * vals.speedAdjustment;
  const estimatedTimeSec = ppm > 0 ? (totalPizzas * 60) / ppm : 0;
  return {
    totalCases: vals.casesNeeded,
    totalPizzas,
    totalPizzasForSauce,
    estimatedTimeSec,
    sauceLbs,
    sauceBatches,
    sauceEffBarrel,
    app1Lbs, app1Batches, app1Type: vals.app1Type,
    app2Lbs, app2Batches, app2Type: vals.app2Type,
    app3Lbs, app3Batches, app3Type: vals.app3Type,
    app4Lbs, app4Batches, app4Type: vals.app4Type,
    pep1Lbs, pep1Batches, pep1Type: vals.pep1Type ?? "",
    pep2Lbs, pep2Batches, pep2Type: vals.pep2Type ?? "",
    pep1LbsB, pep1BatchesB, pep1TypeB: vals.pep1TypeB ?? "",
    pep2LbsB, pep2BatchesB, pep2TypeB: vals.pep2TypeB ?? "",
  };
}

// ── Cheese blend "pull for this run" ─────────────────────────────────────────
// A cheese blend recipe stores each component's PER-BATCH pounds (the "LBS"
// column on the Cheese Mix Recipe Specs sheet). The run card already shows how
// many BATCHES of the blend to make (SummaryStats.appNBatches, derived from the
// spec's oz/pizza). This scales every component up to the pounds the floor must
// actually weigh out and mix for the run, plus the blend total — connecting the
// per-pizza spec to the blend recipe so the floor sees pounds of each cheese.
//
// Both apps call this so the per-cheese numbers can never drift from the run
// card's batch/total-lbs figures. At least one batch is assumed
// (Math.max(1, batches)) so a small run still shows a full batch's worth, which
// matches the run card's existing "Total Lbs" column exactly. Rows are returned
// index-aligned with the input recipe (blank rows kept) so callers can render
// them alongside the per-batch recipe table.
export interface CheesePullRow {
  ingredient: string;
  lbs: number;
}
export interface CheesePull {
  rows: CheesePullRow[];
  totalLbs: number;
}
export function computeCheesePull(
  recipe: readonly RecipeRow[] | undefined,
  batches: number,
): CheesePull {
  const mult = Math.max(1, Number.isFinite(batches) ? batches : 0);
  const rows: CheesePullRow[] = (recipe ?? []).map((r) => ({
    ingredient: (r.ingredient ?? "").toString(),
    lbs: Number(r.lbs ?? 0) * mult,
  }));
  const totalLbs = rows.reduce((s, r) => s + r.lbs, 0);
  return { rows, totalLbs };
}

// Per-pizza ounces of each blend component, so a recipe card can show how the
// applicator's set Oz/Pizza is split across ingredients. Each component's share
// of the batch pounds (rowLbs / totalBatchLbs) is applied to the applicator's
// oz/pizza; the returned rows are index-aligned with the input recipe and their
// sum equals ozPerPizza (when the batch has weight), so the card total lines up
// with the operator's "Oz Per Pizza" field. Shared so web + mobile can't drift.
export interface CheesePerPizzaOz {
  rows: number[];
  totalOz: number;
}
export function computeCheesePerPizzaOz(
  recipe: readonly RecipeRow[] | undefined,
  ozPerPizza: number,
): CheesePerPizzaOz {
  const lbs = (recipe ?? []).map((r) => Number(r.lbs ?? 0));
  const totalLbs = lbs.reduce((s, l) => s + l, 0);
  const oz = Number.isFinite(ozPerPizza) ? Math.max(0, ozPerPizza) : 0;
  const rows = lbs.map((l) => (totalLbs > 0 ? (l / totalLbs) * oz : 0));
  const totalOz = rows.reduce((s, v) => s + v, 0);
  return { rows, totalOz };
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

  // Sauce — a profile with a sauce NAME but no mixed recipe rows uses a
  // bought/ready-made sauce (e.g. BBQ, Ranch): it isn't made in-house, so pull
  // it as-is by name in LBS (spec-sheet oz/pizza drives the total). Otherwise
  // keep the mixed-sauce behavior (generic "Sauce" in batches). The oz/pizza
  // guard keeps the flat +30 lbs buffer from charging a sauce that isn't used.
  const sauceName = (vals.frontlineRecipeName ?? "").trim();
  const hasSauceRecipe = (vals.frontlineRecipe ?? []).some(r => Number(r.lbs ?? 0) > 0);
  if (sauceName && !hasSauceRecipe && vals.sauceOzPerPizza > 0) {
    add(`ingredient:${sauceName}:lbs`, "ingredient", sauceName, "lbs", s.sauceLbs);
  } else if (s.sauceBatches > 0) {
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
    if (isMix && a.lbs > 0) {
      add(`ingredient:${type}:lbs`, "ingredient", type, "lbs", a.lbs);
    } else if (!isMix && a.batches > 0) {
      add(`ingredient:${type}:batches`, "ingredient", type, "batches", a.batches);
    } else if (!isMix && a.lbs > 0) {
      // No batch size configured — track by lbs so ingredients like Hamburger
      // still appear in inventory consumption and the warehouse pull list.
      add(`ingredient:${type}:lbs`, "ingredient", type, "lbs", a.lbs);
    }
  }

  // Pepperoni / toppings — trim type identically across apps so keys/std-vs-batch
  // classification stay in parity even when the type has stray whitespace.
  const pep1Type = (s.pep1Type ?? "").trim();
  if (pep1Type && s.pep1Lbs > 0) {
    const std = defaultPepTypes.includes(pep1Type);
    if (std) add(`ingredient:${pep1Type}:lbs`, "ingredient", pep1Type, "lbs", s.pep1Lbs);
    else if (s.pep1Batches > 0) add(`ingredient:${pep1Type}:batches`, "ingredient", pep1Type, "batches", s.pep1Batches);
    else add(`ingredient:${pep1Type}:lbs`, "ingredient", pep1Type, "lbs", s.pep1Lbs); // no batch size configured — track by lbs
  }
  const pep2Type = (s.pep2Type ?? "").trim();
  if (pep2Type && s.pep2Lbs > 0) {
    const std = defaultPepTypes.includes(pep2Type);
    if (std) add(`ingredient:${pep2Type}:lbs`, "ingredient", pep2Type, "lbs", s.pep2Lbs);
    else if (s.pep2Batches > 0) add(`ingredient:${pep2Type}:batches`, "ingredient", pep2Type, "batches", s.pep2Batches);
    else add(`ingredient:${pep2Type}:lbs`, "ingredient", pep2Type, "lbs", s.pep2Lbs);
  }
  // Additional pep type per applicator — same keys as the primary types so a
  // repeated pep name folds into one inventory line. Suppressed automatically
  // when combined (s.pep2LbsB is 0 in that case).
  const pep1TypeB = (s.pep1TypeB ?? "").trim();
  if (pep1TypeB && s.pep1LbsB > 0) {
    const std = defaultPepTypes.includes(pep1TypeB);
    if (std) add(`ingredient:${pep1TypeB}:lbs`, "ingredient", pep1TypeB, "lbs", s.pep1LbsB);
    else if (s.pep1BatchesB > 0) add(`ingredient:${pep1TypeB}:batches`, "ingredient", pep1TypeB, "batches", s.pep1BatchesB);
    else add(`ingredient:${pep1TypeB}:lbs`, "ingredient", pep1TypeB, "lbs", s.pep1LbsB);
  }
  const pep2TypeB = (s.pep2TypeB ?? "").trim();
  if (pep2TypeB && s.pep2LbsB > 0) {
    const std = defaultPepTypes.includes(pep2TypeB);
    if (std) add(`ingredient:${pep2TypeB}:lbs`, "ingredient", pep2TypeB, "lbs", s.pep2LbsB);
    else if (s.pep2BatchesB > 0) add(`ingredient:${pep2TypeB}:batches`, "ingredient", pep2TypeB, "batches", s.pep2BatchesB);
    else add(`ingredient:${pep2TypeB}:lbs`, "ingredient", pep2TypeB, "lbs", s.pep2LbsB);
  }

  // Packaging — only cartoned runs consume packaging. Accepts the web app's new
  // "cartoned" value and the legacy/mobile "yes"; "labeled"/"n-a"/"no" consume none.
  const cartonedVal = (vals.cartoned ?? "").trim().toLowerCase();
  if (cartonedVal === "cartoned" || cartonedVal === "yes") {
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

// ── Low-stock reorder list (shared, pure) ────────────────────────────────────
// Powers the warehouse "Reorder Now" card on BOTH web and mobile. PURE and
// SHARED so the two apps flag the exact same items with the exact same suggested
// quantities (replit.md parity). Advisory only: it never writes stock or places
// an order — it just produces a shopping list.

// One inventory item fed into the reorder check. `onHand` is the cross-location
// total (what the server's GET /inventory returns); `reorderThreshold` is the
// user-set minimum (0 means the item is untracked and is never flagged).
export type ReorderInput = {
  key: string;
  name: string;
  unit: string;
  category: InventoryCategory;
  onHand: number;
  reorderThreshold: number;
};

// A flagged item that is at/below its reorder threshold once optional upcoming
// scheduled-run demand is subtracted. `projectedOnHand = onHand - demand`;
// `suggestedQty` is the whole-unit amount to order to bring projected on-hand
// back up to the threshold.
export type ReorderItem = {
  key: string;
  name: string;
  unit: string;
  category: InventoryCategory;
  onHand: number;
  reorderThreshold: number;
  demand: number;
  projectedOnHand: number;
  suggestedQty: number;
};

// Flag inventory items that need reordering: cross-location on-hand — minus any
// demand from upcoming scheduled runs (`demandByKey`, optional) — has dropped to
// or below the item's reorder threshold. Items with a threshold of 0 are
// untracked and never flagged (matches `isLowStock`). When `demandByKey` is
// empty this reduces to exactly `onHand <= reorderThreshold`, so the card and
// the per-item LOW badge agree. Subtracting demand first means an item that is
// fine today but will be consumed by scheduled runs still surfaces.
//
// `suggestedQty` brings projected on-hand back up to the threshold (the safe
// minimum), rounded UP to a whole unit since you order whole bags/cases, with a
// floor of 1 so a flagged item always has an actionable amount. Because demand
// is already subtracted, the suggestion automatically covers the coming usage.
//
// Result is sorted most-urgent first (largest shortfall below threshold), then
// by name for a stable order. Pure.
export function computeReorderList(
  items: ReorderInput[],
  demandByKey: Record<string, number> = {},
): ReorderItem[] {
  const EPS = 1e-6;
  const out: ReorderItem[] = [];
  for (const it of items) {
    const threshold = Number(it.reorderThreshold) || 0;
    if (!(threshold > 0)) continue;
    const onHand = Number(it.onHand) || 0;
    const demand = Math.max(0, Number(demandByKey[it.key]) || 0);
    const projectedOnHand = onHand - demand;
    if (projectedOnHand > threshold + EPS) continue;
    const suggestedQty = Math.max(
      1,
      Math.ceil(threshold - projectedOnHand - EPS),
    );
    out.push({
      key: it.key,
      name: it.name,
      unit: it.unit,
      category: it.category,
      onHand,
      reorderThreshold: threshold,
      demand,
      projectedOnHand,
      suggestedQty,
    });
  }
  out.sort((a, b) => {
    const da = a.reorderThreshold - a.projectedOnHand;
    const db = b.reorderThreshold - b.projectedOnHand;
    if (Math.abs(db - da) > EPS) return db - da;
    return a.name.localeCompare(b.name);
  });
  return out;
}

// ── Use-first staging / FEFO (shared, pure) ──────────────────────────────────
// Powers the warehouse "Use First" card on BOTH web and mobile. PURE and SHARED
// so the two apps list the exact same lots in the exact same order (replit.md
// parity). Advisory only: it never writes stock — it just tells warehouse staff
// which lots to pull first so the oldest stock is consumed before it expires.

// Whole-day calendar difference in days between an ISO date string and `today`.
// Matches the clients' `daysUntil` and the server's `daysUntilExpiry` exactly
// (date-only, local-midnight anchored). Returns null for a missing/invalid date.
function daysUntilDate(dateStr: string | null, today: Date): number | null {
  if (!dateStr) return null;
  const d = new Date(dateStr + "T00:00:00");
  if (isNaN(d.getTime())) return null;
  const t = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((d.getTime() - t.getTime()) / 86_400_000);
}

// One stock lot fed into the use-first check. `locationId` null means onsite
// (the implicit default location).
export type UseFirstLotInput = {
  qtyRemaining: number;
  expirationDate: string | null;
  locationId: number | null;
};

// One inventory item with its lots, fed into the use-first check.
export type UseFirstItemInput = {
  key: string;
  name: string;
  unit: string;
  category: InventoryCategory;
  lots: UseFirstLotInput[];
};

// A named storage location used to resolve a lot's `locationId` to a name.
export type UseFirstLocation = {
  id: number;
  name: string;
  isOnsite: boolean;
};

// A single at-risk lot to stage and use first. `daysUntilExpiry` is whole days
// (negative = already expired); `usedToday` marks lots whose item is consumed by
// a run active/scheduled today, so they sort to the top.
export type UseFirstEntry = {
  key: string;
  name: string;
  unit: string;
  category: InventoryCategory;
  qtyRemaining: number;
  locationId: number | null;
  locationName: string;
  expirationDate: string | null;
  daysUntilExpiry: number;
  expired: boolean;
  usedToday: boolean;
};

// Flag stock lots that should be used first: any lot with stock remaining whose
// expiration is within the configured "expiring soon" window (`soonDays`) OR is
// already past (negative days are <= soonDays, so they're always included).
// Lots with no expiration date are never at risk and are skipped.
//
// Ordering is first-expired-first-out (FEFO): soonest/most-overdue expiration
// first. Lots whose item is consumed by a run active or scheduled today
// (`todayItemKeys`) sort ahead of everything else so staff stage what the floor
// needs now before the rest. Ties break by item name then expiration date for a
// stable order. Pure.
export function computeUseFirstList(input: {
  items: UseFirstItemInput[];
  locations?: UseFirstLocation[];
  soonDays: number;
  today?: Date;
  todayItemKeys?: Iterable<string>;
}): UseFirstEntry[] {
  const today = input.today ?? new Date();
  const soonDays = Math.max(0, Number(input.soonDays) || 0);
  const todayKeys = new Set(input.todayItemKeys ?? []);
  const locById = new Map<number, UseFirstLocation>();
  for (const l of input.locations ?? []) locById.set(l.id, l);
  const onsite = (input.locations ?? []).find((l) => l.isOnsite);
  const out: UseFirstEntry[] = [];
  for (const item of input.items) {
    for (const lot of item.lots ?? []) {
      const qty = Number(lot.qtyRemaining) || 0;
      if (!(qty > 0)) continue;
      const days = daysUntilDate(lot.expirationDate, today);
      if (days == null) continue;
      if (days > soonDays) continue;
      const loc = lot.locationId != null ? locById.get(lot.locationId) : onsite;
      const locationName = loc?.name ?? onsite?.name ?? "Onsite";
      out.push({
        key: item.key,
        name: item.name,
        unit: item.unit,
        category: item.category,
        qtyRemaining: qty,
        locationId: lot.locationId,
        locationName,
        expirationDate: lot.expirationDate,
        daysUntilExpiry: days,
        expired: days < 0,
        usedToday: todayKeys.has(item.key),
      });
    }
  }
  out.sort((a, b) => {
    if (a.usedToday !== b.usedToday) return a.usedToday ? -1 : 1;
    if (a.daysUntilExpiry !== b.daysUntilExpiry)
      return a.daysUntilExpiry - b.daysUntilExpiry;
    const n = a.name.localeCompare(b.name);
    if (n !== 0) return n;
    return (a.expirationDate ?? "").localeCompare(b.expirationDate ?? "");
  });
  return out;
}

// ── Freezer-tunnel work-in-progress (cases in freezer / on the line) ────────
//
// Live count of cases pressed but not yet cased: product travelling through
// the spiral-freezer tunnel (and on the line feeding it). Used by the run
// completion displays so "% complete" reflects work already in flight.
//
// Model (matches the app's live `casesOnLine` freezer model):
// - Not started → 0.
// - Running: the tunnel fills over `freezerTimeMin`, then holds steady:
//   floor(ppm * min(elapsedMin, freezerTimeMin) / pizzasPerCase).
// - Paused: frozen at the moment of pause (`pausedAt`). Closed pauses shift
//   `startedAt` forward on resume (resumeRun), so plain elapsed time already
//   excludes them.
// - Ended: the line stops feeding, the tunnel keeps moving — content drains
//   to zero over `freezerTimeMin`, starting from however full the tunnel was
//   at end. A pause still OPEN at end (run ended while paused) is subtracted
//   because endRun never shifted `startedAt` for it. Non-pause stoppage
//   downtime is deliberately NOT subtracted — the live model ignores it too,
//   and subtracting it only after end would make the number jump at "End Run".
export interface FreezerWipStoppage {
  type?: string;
  startedAt: number;
  endedAt?: number | null;
}

export interface FreezerWipInput {
  startedAt?: number | null;
  endedAt?: number | null;
  pausedAt?: number | null;
  stoppages?: FreezerWipStoppage[];
  /** Current wall-clock time (ms). */
  now: number;
  /** Pizzas per minute (already includes any speed adjustment). */
  ppm: number;
  pizzasPerCase: number;
  /** Freezer tunnel transit time in minutes. */
  freezerTimeMin: number;
}

export function computeCasesInFreezer(input: FreezerWipInput): number {
  const { startedAt, endedAt, pausedAt, now, ppm, pizzasPerCase, freezerTimeMin } = input;
  if (!startedAt || ppm <= 0 || pizzasPerCase <= 0 || freezerTimeMin <= 0) return 0;

  if (!endedAt) {
    const refTime = pausedAt ?? now;
    const elapsedMin = Math.max(0, (refTime - startedAt) / 60000);
    return Math.floor((ppm * Math.min(elapsedMin, freezerTimeMin)) / pizzasPerCase);
  }

  // Pause that was still open when the run ended (endRun clears pausedAt
  // without shifting startedAt, so it is NOT already excluded from elapsed).
  const openPauseMs = (input.stoppages ?? [])
    .filter(s => s.type === "pause" && s.startedAt < endedAt && (s.endedAt == null || s.endedAt >= endedAt))
    .reduce((acc, s) => acc + (endedAt - s.startedAt), 0);

  const atEndMin = Math.min(
    Math.max(0, endedAt - startedAt - openPauseMs) / 60000,
    freezerTimeMin
  );
  const sinceEndMin = Math.max(0, (now - endedAt) / 60000);
  const remainMin = Math.max(0, Math.min(atEndMin, freezerTimeMin - sinceEndMin));
  return Math.floor((ppm * remainMin) / pizzasPerCase);
}
