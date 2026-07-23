// "Fill in missing data" assistant — pure detection + proposal logic.
//
// This is the single source of truth shared by the web app
// (artifacts/run-calculator) and the mobile app
// (artifacts/run-calculator-mobile) so both platforms detect the SAME blank
// fields, propose the SAME known values from the SAME sources, and send the AI
// the SAME request (replit.md parity rule). Each app keeps only its own
// platform glue (how current values / known sources are read, and how the
// read-only /ai/fill-missing fetch is authenticated).
//
// This module NEVER writes anything. It detects blanks, proposes values
// (marking each source), and shapes the read-only AI request for fields with no
// known source. The UI commits confirmed values through the existing update
// paths; there is no auto-apply.

export type FieldCategory =
  | "identity"
  | "line"
  | "packaging"
  | "sauce"
  | "applicator"
  | "pepperoni"
  | "dough";
export type FieldKind = "number" | "text" | "select";

// One field a valid run needs. `fillable: false` marks run identity (brand/flavor)
// which the panel surfaces as "needs to be set on the run" but cannot apply here.
// `aiEligible` fields fall through to the AI endpoint when no known source exists.
export type FieldSpec = {
  key: string;
  label: string;
  category: FieldCategory;
  kind: FieldKind;
  options?: string[];
  documentedDefault?: string | number;
  aiEligible: boolean;
  fillable: boolean;
};

export type ProposalSource = "learned" | "profile" | "spec" | "default" | "ai" | "none";

export type FieldProposal = {
  key: string;
  label: string;
  category: FieldCategory;
  kind: FieldKind;
  options?: string[];
  fillable: boolean;
  currentValue: string | number;
  value: string | number | null; // proposed value; null when awaiting AI / no source
  source: ProposalSource;
  rationale?: string; // present for source === "ai"
};

// Documented defaults — the .default() values from the web formSchema. These are
// the app's own documented defaults, NOT the all-zero blank-run baseline. Only
// fields with a meaningful documented default appear here.
export const DOCUMENTED_DEFAULTS: Record<string, number> = {
  casesNeeded: 384,
  crustsPerCycle: 5,
  cycleSpeed: 7.8,
  speedAdjustment: 1.0,
  freezerTime: 15,
  pizzasPerCase: 12,
  casesPerSkid: 48,
  casesPerLayer: 6,
  cartonsPerCase: 1,
  doughballsPerTray: 24,
  crustsPerStack: 24,
  doughBatchYield: 620,
  crustsPerCase: 12,
  sauceOzPerPizza: 4,
  sauceBarrelLbs: 450,
  app1BatchLbs: 30,
  app2BatchLbs: 55,
  app3BatchLbs: 45,
  app4BatchLbs: 55,
  pep1BatchLbs: 25,
  pep2BatchLbs: 25,
};

const SHIPPER_OPTIONS = ["costco", "12in", "11in", "7in", "edwardos"];
const SKID_STACKING_OPTIONS = ["lucia", "hannaford", "column"];

function num(def?: number): Pick<FieldSpec, "kind" | "documentedDefault" | "aiEligible" | "fillable"> {
  return { kind: "number", documentedDefault: def, aiEligible: def === undefined, fillable: true };
}

// Canonical field list, shared by both platforms. Recipes are intentionally NOT
// included: a run is computable from the flat batch-lbs / oz figures, so recipes
// are an enhancement rather than a field "needed for a valid run".
export const FIELD_SPECS: FieldSpec[] = [
  // Identity
  { key: "brand", label: "Brand", category: "identity", kind: "text", aiEligible: false, fillable: false },
  { key: "flavor", label: "Flavor", category: "identity", kind: "text", aiEligible: false, fillable: false },
  { key: "dieType", label: "Die / Size", category: "identity", kind: "text", aiEligible: true, fillable: true },

  // Line / speed
  { key: "casesNeeded", label: "Cases Needed", category: "line", ...num(DOCUMENTED_DEFAULTS.casesNeeded) },
  { key: "crustsPerCycle", label: "Crusts / Cycle", category: "line", ...num(DOCUMENTED_DEFAULTS.crustsPerCycle) },
  { key: "cycleSpeed", label: "Cycle Speed", category: "line", ...num(DOCUMENTED_DEFAULTS.cycleSpeed) },
  { key: "speedAdjustment", label: "Speed Adjustment", category: "line", ...num(DOCUMENTED_DEFAULTS.speedAdjustment) },
  { key: "freezerTime", label: "Freezer Time (min)", category: "line", ...num(DOCUMENTED_DEFAULTS.freezerTime) },

  // Packaging counts + selects
  { key: "pizzasPerCase", label: "Pizzas / Case", category: "packaging", ...num(DOCUMENTED_DEFAULTS.pizzasPerCase) },
  { key: "casesPerSkid", label: "Cases / Skid", category: "packaging", ...num(DOCUMENTED_DEFAULTS.casesPerSkid) },
  { key: "casesPerLayer", label: "Cases / Layer", category: "packaging", ...num(DOCUMENTED_DEFAULTS.casesPerLayer) },
  { key: "cartonsPerCase", label: "Cartons / Case", category: "packaging", ...num(DOCUMENTED_DEFAULTS.cartonsPerCase) },
  { key: "shipper", label: "Shipper", category: "packaging", kind: "select", options: SHIPPER_OPTIONS, aiEligible: true, fillable: true },
  { key: "skidStacking", label: "Skid Stacking Style", category: "packaging", kind: "select", options: SKID_STACKING_OPTIONS, aiEligible: true, fillable: true },

  // Dough supply
  { key: "doughballsPerTray", label: "Doughballs / Tray", category: "dough", ...num(DOCUMENTED_DEFAULTS.doughballsPerTray) },
  { key: "crustsPerStack", label: "Crusts / Stack", category: "dough", ...num(DOCUMENTED_DEFAULTS.crustsPerStack) },
  { key: "doughBatchYield", label: "Dough Batch Yield", category: "dough", ...num(DOCUMENTED_DEFAULTS.doughBatchYield) },
  { key: "crustsPerCase", label: "Crusts / Case", category: "dough", ...num(DOCUMENTED_DEFAULTS.crustsPerCase) },

  // Sauce (always needed)
  { key: "sauceOzPerPizza", label: "Sauce oz / Pizza", category: "sauce", ...num(DOCUMENTED_DEFAULTS.sauceOzPerPizza) },
  { key: "sauceBarrelLbs", label: "Sauce Barrel (lbs)", category: "sauce", ...num(DOCUMENTED_DEFAULTS.sauceBarrelLbs) },

  // Applicators 1–4 (slot-gated: only flagged when the slot is in use)
  ...applicatorSpecs(),

  // Pepperoni 1–2 (slot-gated)
  ...pepperoniSpecs(),
];

function applicatorSpecs(): FieldSpec[] {
  const out: FieldSpec[] = [];
  for (const n of [1, 2, 3, 4]) {
    out.push({ key: `app${n}Type`, label: `App ${n} Type`, category: "applicator", kind: "text", aiEligible: true, fillable: true });
    out.push({ key: `app${n}OzPerPizza`, label: `App ${n} oz / Pizza`, category: "applicator", ...num(undefined) });
    out.push({ key: `app${n}BatchLbs`, label: `App ${n} Batch (lbs)`, category: "applicator", ...num(DOCUMENTED_DEFAULTS[`app${n}BatchLbs`]) });
  }
  return out;
}

function pepperoniSpecs(): FieldSpec[] {
  const out: FieldSpec[] = [];
  for (const n of [1, 2]) {
    out.push({ key: `pep${n}Type`, label: `Pep ${n} Type`, category: "pepperoni", kind: "text", aiEligible: true, fillable: true });
    out.push({ key: `pep${n}OzPerPizza`, label: `Pep ${n} oz / Pizza`, category: "pepperoni", ...num(undefined) });
    out.push({ key: `pep${n}BatchLbs`, label: `Pep ${n} Batch (lbs)`, category: "pepperoni", ...num(DOCUMENTED_DEFAULTS[`pep${n}BatchLbs`]) });
  }
  return out;
}

// ── Blank detection ──────────────────────────────────────────────────────────

type Rec = Record<string, unknown>;

function asNumber(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}
function asString(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}
function rowsLen(v: unknown): number {
  return Array.isArray(v) ? v.length : 0;
}

export function isBlankValue(kind: FieldKind, v: unknown): boolean {
  return kind === "number" ? asNumber(v) <= 0 : asString(v) === "";
}

function appSlotInUse(rec: Rec, n: number): boolean {
  return (
    asString(rec[`app${n}Type`]) !== "" ||
    asNumber(rec[`app${n}OzPerPizza`]) > 0 ||
    rowsLen(rec[`app${n}CheeseRecipe`]) > 0
  );
}
function pepSlotInUse(rec: Rec, n: number): boolean {
  return (
    asString(rec[`pep${n}Type`]) !== "" ||
    asNumber(rec[`pep${n}OzPerPizza`]) > 0 ||
    asNumber(rec[`pep${n}Sticks`]) > 0
  );
}

// Dough-supply mode: the record carries the run's dough sub-tab ("dough" mixes
// dough in-house; "crusts" opens pre-made crusts). Web passes the run's
// doughSubTab, mobile the run's progress.subTab. Absent/unknown defaults to
// dough mode (the app default).
function isCrustMode(rec: Rec): boolean {
  return asString(rec.subTab) === "crusts";
}

// When a dough recipe is selected AND a doughball weight is set, the batch
// yield is derived from the recipe (recipeLbs * 16 / weightOz) and the manual
// doughBatchYield field is ignored by the calc — so it must not be flagged as
// missing. Web names the weight targetDoughballWeight, mobile doughballWeightOz.
function doughYieldDerivedFromRecipe(rec: Rec): boolean {
  const rows = Array.isArray(rec.doughRecipe) ? (rec.doughRecipe as Rec[]) : [];
  const recipeLbs = rows.reduce((s, r) => s + asNumber(r && (r as Rec).lbs), 0);
  const weightOz = Math.max(
    asNumber(rec.targetDoughballWeight),
    asNumber(rec.doughballWeightOz),
  );
  return recipeLbs > 0 && weightOz > 0;
}

// Sum the lbs values from a recipe row array.
function sumRecipeLbs(rows: unknown): number {
  if (!Array.isArray(rows)) return 0;
  return (rows as Rec[]).reduce((s, r) => s + asNumber(r && (r as Rec).lbs), 0);
}

// When a sauce (frontline) recipe has ingredient rows with lbs > 0, the calc
// uses the row sum as the effective barrel size and ignores sauceBarrelLbs
// entirely. Matches: sauceEffBarrel = frontlineRecipeLbs > 0 ? frontlineRecipeLbs : sauceBarrelLbs
function sauceBarrelDerivedFromRecipe(rec: Rec): boolean {
  return sumRecipeLbs(rec.frontlineRecipe) > 0;
}

// When an applicator slot has a cheese/topping recipe with lbs > 0, the calc
// uses the row sum as the effective batch size and ignores app${n}BatchLbs.
// Matches: sumRecipe(app${n}CheeseRecipe) > 0 ? sum : app${n}BatchLbs
function appBatchLbsDerivedFromRecipe(rec: Rec, n: number): boolean {
  return sumRecipeLbs(rec[`app${n}CheeseRecipe`]) > 0;
}

// Some fields only matter conditionally (e.g. cartons only when cartoned, an
// applicator slot only when that slot is in use, dough vs crust supply fields
// only in their own mode). Returns false to skip a field.
function fieldApplies(spec: FieldSpec, rec: Rec): boolean {
  if (spec.key === "cartonsPerCase") {
    // Cartons only matter for cartoned runs. Excludes legacy "no" and the web
    // app's new non-cartoned "labeled"/"n-a" packaging types.
    const c = asString(rec.cartoned);
    return c !== "no" && c !== "labeled" && c !== "n-a";
  }
  // Dough-mode-only supply fields: irrelevant when the run opens pre-made crusts.
  if (spec.key === "doughballsPerTray") return !isCrustMode(rec);
  if (spec.key === "doughBatchYield") {
    return !isCrustMode(rec) && !doughYieldDerivedFromRecipe(rec);
  }
  // Crust-mode-only supply fields: irrelevant when the run mixes dough in-house.
  if (spec.key === "crustsPerStack" || spec.key === "crustsPerCase") {
    return isCrustMode(rec);
  }
  // sauceBarrelLbs: irrelevant when a mixed sauce recipe provides the barrel size.
  if (spec.key === "sauceBarrelLbs") {
    return !sauceBarrelDerivedFromRecipe(rec);
  }
  const appMatch = /^app([1-4])/.exec(spec.key);
  if (appMatch) {
    const n = Number(appMatch[1]);
    if (!appSlotInUse(rec, n)) return false;
    // app${n}BatchLbs: irrelevant when the cheese/topping recipe provides the batch size.
    if (spec.key === `app${n}BatchLbs`) return !appBatchLbsDerivedFromRecipe(rec, n);
    return true;
  }
  const pepMatch = /^pep([1-2])/.exec(spec.key);
  if (pepMatch) return pepSlotInUse(rec, Number(pepMatch[1]));
  return true;
}

export type MissingField = { spec: FieldSpec; currentValue: string | number };

// Given a flat record of the run's current values (web: { ...formValues, brand,
// flavor }; mobile: the RunSettings object), return every applicable field that
// is still blank/zero.
export function detectMissingFields(rec: Rec): MissingField[] {
  const out: MissingField[] = [];
  for (const spec of FIELD_SPECS) {
    if (!fieldApplies(spec, rec)) continue;
    const raw = rec[spec.key];
    if (!isBlankValue(spec.kind, raw)) continue;
    out.push({
      spec,
      currentValue: spec.kind === "number" ? asNumber(raw) : asString(raw),
    });
  }
  return out;
}

// ── Known-source proposals ───────────────────────────────────────────────────

// Resolver supplied by each platform: returns the value this run's learned
// memory, saved profile, and/or spec-seed hold for a field (or undefined when
// none does). `learned` is the factory-wide value a user previously confirmed in
// the Fill Missing panel for this exact product (brand + flavor); it wins over
// everything else because it is the most direct "what we actually used" memory.
export type KnownLookup = (key: string, kind: FieldKind) => {
  learned?: string | number;
  profile?: string | number;
  spec?: string | number;
};

// A flat record of learned values for ONE product, keyed by field key. Values
// are stored/transmitted as strings (the same shape the AI endpoint returns).
export type LearnedValueRow = {
  brand: string;
  flavor: string;
  fieldKey: string;
  value: string;
};

// Pure helper shared by both platforms: collapse the full learned-value list
// into a { fieldKey -> value } map for one product, matching brand + flavor
// case-insensitively. Empty brand/flavor never matches (no product key).
export function pickLearnedForProduct(
  values: ReadonlyArray<LearnedValueRow>,
  brand: string,
  flavor: string,
): Record<string, string> {
  const b = brand.trim().toLowerCase();
  const f = flavor.trim().toLowerCase();
  const out: Record<string, string> = {};
  if (!b || !f) return out;
  for (const v of values) {
    if (v.brand.trim().toLowerCase() === b && v.flavor.trim().toLowerCase() === f) {
      out[v.fieldKey] = v.value;
    }
  }
  return out;
}

export function buildProposals(missing: MissingField[], lookup: KnownLookup): FieldProposal[] {
  return missing.map(({ spec, currentValue }): FieldProposal => {
    const base = {
      key: spec.key,
      label: spec.label,
      category: spec.category,
      kind: spec.kind,
      options: spec.options,
      fillable: spec.fillable,
      currentValue,
    };
    const known = lookup(spec.key, spec.kind);
    if (known.learned !== undefined && !isBlankValue(spec.kind, known.learned)) {
      return { ...base, value: known.learned, source: "learned" };
    }
    if (known.profile !== undefined && !isBlankValue(spec.kind, known.profile)) {
      return { ...base, value: known.profile, source: "profile" };
    }
    if (known.spec !== undefined && !isBlankValue(spec.kind, known.spec)) {
      return { ...base, value: known.spec, source: "spec" };
    }
    if (spec.documentedDefault !== undefined) {
      return { ...base, value: spec.documentedDefault, source: "default" };
    }
    return { ...base, value: null, source: "none" };
  });
}

// Fields with no known source AND eligible for AI suggestion. The panel sends
// these to /ai/fill-missing, then merges suggestions back by key.
export function aiCandidates(proposals: FieldProposal[]): FieldProposal[] {
  return proposals.filter((p) => {
    if (p.source !== "none" || !p.fillable) return false;
    const spec = FIELD_SPECS.find((s) => s.key === p.key);
    return !!spec?.aiEligible;
  });
}

// ── AI request ───────────────────────────────────────────────────────────────

// Mirrors the OpenAPI FillMissingInput contract.
export type FillMissingRequestField = {
  key: string;
  label: string;
  category: FieldCategory;
  kind: FieldKind;
  options?: string[];
};
export type FillMissingContextItem = { key: string; label: string; value: string };
export type FillMissingInput = {
  brand: string;
  flavor: string;
  dieType?: string;
  context?: FillMissingContextItem[];
  fields: FillMissingRequestField[];
};
export type FillMissingSuggestion = { key: string; value: string; rationale: string };
export type FillMissingResult = {
  suggestions: FillMissingSuggestion[];
  generatedAt: number;
  note?: string;
};

// Build the read-only AI request: the blank fields needing a value, plus the
// already-known context fields for grounding.
export function buildFillMissingInput(
  brand: string,
  flavor: string,
  dieType: string,
  candidates: FieldProposal[],
  contextRec: Rec,
): FillMissingInput {
  const context = FIELD_SPECS.filter(
    (s) => s.key !== "brand" && s.key !== "flavor" && !isBlankValue(s.kind, contextRec[s.key]),
  ).map((s) => ({
    key: s.key,
    label: s.label,
    value: String(contextRec[s.key]),
  }));

  return {
    brand,
    flavor,
    dieType,
    context,
    fields: candidates.map((c) => ({
      key: c.key,
      label: c.label,
      category: c.category,
      kind: c.kind,
      ...(c.options ? { options: c.options } : {}),
    })),
  };
}
