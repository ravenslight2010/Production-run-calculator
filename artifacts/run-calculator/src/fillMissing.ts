// "Fill in missing data" assistant — shared detection + proposal logic.
//
// Mirrors the mobile module (artifacts/run-calculator-mobile/context/fillMissing.ts)
// field-for-field so both platforms detect the SAME blank fields, propose the
// SAME known values from the SAME sources, and send the AI the SAME request
// (replit.md parity rule). The only per-platform difference is plumbing: how the
// current values / known sources are read, and how the fetch is authenticated.
//
// This module NEVER writes anything. It detects blanks, proposes values (marking
// each source), and calls the read-only /ai/fill-missing endpoint for fields with
// no known source. The UI commits confirmed values through the existing update
// paths; there is no auto-apply.

import { SPEC_PROFILES } from "./specSeed";
import { loadProfile } from "./storage";
import { InventoryApiError, inventoryClientId, photoErrorMessage } from "./inventoryShared";

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

export type ProposalSource = "profile" | "spec" | "default" | "ai" | "none";

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
// the app's own documented defaults, NOT the all-zero DEFAULT_VALUES blank-run
// baseline. Only fields with a meaningful documented default appear here.
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

// Some fields only matter conditionally (e.g. cartons only when cartoned, an
// applicator slot only when that slot is in use). Returns false to skip a field.
function fieldApplies(spec: FieldSpec, rec: Rec): boolean {
  if (spec.key === "cartonsPerCase") return asString(rec.cartoned) !== "no";
  const appMatch = /^app([1-4])/.exec(spec.key);
  if (appMatch) return appSlotInUse(rec, Number(appMatch[1]));
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

// Resolver supplied by each platform: returns the value this run's saved profile
// and/or spec-seed hold for a field (or undefined when neither does).
export type KnownLookup = (key: string, kind: FieldKind) => {
  profile?: string | number;
  spec?: string | number;
};

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

// Mirrors the OpenAPI FillMissingInput contract (kept identical on mobile).
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

export async function requestFillMissing(input: FillMissingInput): Promise<FillMissingResult> {
  const res = await fetch("/api/ai/fill-missing", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-client-id": inventoryClientId(),
    },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const retryAfterRaw = res.headers.get("Retry-After");
    const retryAfterSec =
      retryAfterRaw != null && Number.isFinite(Number(retryAfterRaw)) ? Number(retryAfterRaw) : null;
    let serverMessage: string | null = null;
    try {
      const body = (await res.json()) as { error?: unknown };
      if (body && typeof body.error === "string") serverMessage = body.error;
    } catch {
      // non-JSON error body; ignore
    }
    throw new InventoryApiError(
      res.status,
      `Fill-missing request failed (${res.status})`,
      retryAfterSec,
      serverMessage,
    );
  }
  return (await res.json()) as FillMissingResult;
}

export const fillMissingErrorMessage = photoErrorMessage;

// ── Web known-source lookup ──────────────────────────────────────────────────
// Builds a KnownLookup from this run's saved profile + the spec seed. Mobile has
// its own equivalent reading brandProfiles + SPEC_PROFILES.
export function makeWebLookup(brand: string, flavor: string): KnownLookup {
  const profile = brand || flavor ? loadProfile(brand, flavor) : null;
  const specProfile = SPEC_PROFILES.find(
    (p) =>
      p.brand.toLowerCase() === brand.toLowerCase() &&
      p.flavor.toLowerCase() === flavor.toLowerCase(),
  );
  return (key) => {
    const profVal = profile ? (profile as unknown as Rec)[key] : undefined;
    const specVal = specProfile ? (specProfile.values as Rec)[key] : undefined;
    return {
      profile: profVal as string | number | undefined,
      spec: specVal as string | number | undefined,
    };
  };
}
