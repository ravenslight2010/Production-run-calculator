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
