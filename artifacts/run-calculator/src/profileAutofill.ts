// Auto-fill setup profiles from the latest saved spec-sheet snapshots.
//
// A saved spec sheet (see savedSpecSheets.ts) carries the parsed profiles the
// last imports produced. This module compares one brand+flavor's CURRENT saved
// profile against what those latest snapshots say the spec fields should be,
// using the SAME per-field semantics as the real import apply loop
// (applySpecImport's profile loop in storage.ts):
//
// - Blank/default fields the spec states a value for become FILLS (safe to
//   apply automatically into the editor form — nothing is persisted until the
//   user presses Save).
// - Fields where the profile already holds a DIFFERENT real value become
//   MISMATCHES, surfaced for per-field review — never silently overwritten.
//
// Applicator slots go through the same station-assignment + cheese/mix slot
// resolution the import uses, so a blend name on the sheet compares against the
// profile's literal "cheese"/"Mix" slot + recipe-name link instead of flagging
// a false mismatch. Recipe-name fields compare by the import's loose name key
// ("Aldo's Cheese Mix 1.75" == "Aldo's Cheese Mix").
//
// Pure — no storage/network access; callers fetch the sheets and pass the
// current form values in. Web-only for now (parity paused per replit.md).

import {
  assignApplicatorSlots,
  resolveCheeseApplicatorSlots,
  resolveMixApplicatorSlots,
  specImportCheeseRecipeIsMix,
  specImportNameMatchKey,
  cleanSpecCheeseRecipeName,
  recipeApplyTargets,
  type ParsedProfile,
  type ParsedRecipe,
  type ParsedSpecImport,
} from "@workspace/spec-import";
import { DEFAULT_VALUES, type FormValues } from "./types";
import { latestSourceKeyIds } from "./savedSpecSheets";

export type AutofillEntry = {
  /** FormValues key this entry fills/replaces. */
  field: string;
  /** Human-readable field label ("Applicator 2 Oz Per Pizza"). */
  label: string;
  /** Value the latest imported file states. */
  specValue: string | number;
  /** Value currently on the profile (mismatches only). */
  currentValue?: string | number;
  /** Label of the saved sheet this value came from. */
  source: string;
};

export type ProfileAutofillPlan = {
  /** Blank/default fields the spec can fill — safe to auto-apply to the form. */
  fills: AutofillEntry[];
  /** Fields whose current value differs from the spec — per-field review. */
  mismatches: AutofillEntry[];
  /** How many of the latest saved sheets mention this brand+flavor. */
  matchedSheets: number;
  /**
   * Derived pep1Combined the import would set (single named pep = combined,
   * two = not). Applied only when a pep TYPE entry is actually accepted.
   */
  pepCombinedTarget?: boolean;
};

type DesiredKind = "string" | "number" | "name";
type Desired = {
  field: string;
  label: string;
  value: string | number;
  kind: DesiredKind;
  source: string;
};

/** Mirror of applySpecImport's mix-routing decision, minus local-storage reads. */
function routesToMix(r: ParsedRecipe, mixNamesLower: ReadonlySet<string>): boolean {
  if (r.kind !== "cheese") return false;
  if (r.forcedCategory === "mix") return true;
  if (r.forcedCategory === "cheese") return false;
  return specImportCheeseRecipeIsMix(r.name, mixNamesLower, r.rows.length);
}

function hasRealRows(rows: unknown): boolean {
  return Array.isArray(rows) && rows.some((r) => Number((r as { lbs?: unknown })?.lbs ?? 0) > 0);
}

/** Build the per-field desired values ONE sheet's profile implies. */
function desiredFromProfile(
  p: ParsedProfile,
  data: ParsedSpecImport,
  source: string,
  current: FormValues,
  mixNamesLower: ReadonlySet<string>,
): { desired: Desired[]; namedPepCount: number } {
  const out: Desired[] = [];
  const cur = current as Record<string, unknown>;
  const push = (field: string, label: string, value: string | number, kind: DesiredKind) => {
    out.push({ field, label, value, kind, source });
  };

  if ((p.dieType ?? "").trim()) push("dieType", "Die Type", p.dieType!.trim(), "string");
  if ((p.allergen ?? "").trim()) push("allergen", "Allergen", p.allergen!.trim(), "string");
  if (p.sauceOzPerPizza != null && p.sauceOzPerPizza > 0) {
    push("sauceOzPerPizza", "Sauce Oz Per Pizza", p.sauceOzPerPizza, "number");
  }
  if (p.pizzasPerCase != null && p.pizzasPerCase > 0) {
    push("pizzasPerCase", "Pizzas Per Case", p.pizzasPerCase, "number");
  }
  if (p.sauceBarrelLbs != null && p.sauceBarrelLbs > 0) {
    push("sauceBarrelLbs", "Sauce Barrel Weight (lbs)", p.sauceBarrelLbs, "number");
  }

  // Named ready-made sauce / named dough — the import only ever assigns these
  // when the profile has no MIXED recipe rows (a real recipe outranks a name),
  // so the autofill honors the same guard and skips the field entirely when
  // mixed rows exist.
  const specSauceName = (p.sauceName ?? "").trim();
  if (specSauceName && !hasRealRows(cur.frontlineRecipe)) {
    push("frontlineRecipeName", "Sauce Recipe", specSauceName, "name");
  }
  const specDoughName = (p.doughName ?? "").trim();
  if (specDoughName && !hasRealRows(cur.doughRecipe)) {
    push("doughRecipeName", "Dough Recipe", specDoughName, "name");
  }

  // Applicators — identical resolution pipeline to the import: physical
  // station assignment first, then cheese-blend slots re-typed to "cheese",
  // then mix slots re-typed to "Mix", each carrying a recipe-name link.
  const cheeseCandidateNames = data.recipes
    .filter((r) => r.kind === "cheese" && !routesToMix(r, mixNamesLower))
    .map((r) => r.name);
  const mixCandidateNames = data.recipes
    .filter((r) => r.kind === "cheese" && routesToMix(r, mixNamesLower))
    .map((r) => r.name);
  const { applicators: cheeseResolved, links: cheeseLinks } = resolveCheeseApplicatorSlots(
    assignApplicatorSlots(p.applicators ?? []),
    cheeseCandidateNames,
  );
  const { applicators: resolvedApps, links: mixLinks } = resolveMixApplicatorSlots(
    cheeseResolved,
    mixCandidateNames,
  );
  resolvedApps.forEach((a, i) => {
    const slot = i + 1;
    const type = (a.type ?? "").trim();
    if (!type) return;
    push(`app${slot}Type`, `Applicator ${slot} Type`, type, "string");
    if (Number(a.ozPerPizza) > 0) {
      push(`app${slot}OzPerPizza`, `Applicator ${slot} Oz Per Pizza`, a.ozPerPizza, "number");
    }
    // Offered whenever the sheet states it, exactly like the import loop.
    // (Harmless when the slot has a recipe — a recipe's row-sum outranks the
    // stored batch weight at run time, so this is a fallback value.)
    if (a.batchLbs != null && a.batchLbs > 0) {
      push(`app${slot}BatchLbs`, `Applicator ${slot} Batch Weight (lbs)`, a.batchLbs, "number");
    }
  });
  for (const link of [...cheeseLinks, ...mixLinks]) {
    push(
      `app${link.slot}CheeseRecipeName`,
      `Applicator ${link.slot} Recipe`,
      link.recipeName,
      "name",
    );
  }

  // Pepperoni applicators (A slots only — the import never writes B slots).
  const namedPeps = (p.pepperonis ?? []).slice(0, 2).filter((pp) => (pp.type ?? "").trim());
  namedPeps.forEach((pp, i) => {
    const slot = i + 1;
    push(`pep${slot}Type`, `Pepperoni ${slot} Type`, pp.type.trim(), "string");
    if (Number(pp.sticks) > 0) push(`pep${slot}Sticks`, `Pepperoni ${slot} Sticks`, pp.sticks, "number");
    if (Number(pp.ozPerPizza) > 0) {
      push(`pep${slot}OzPerPizza`, `Pepperoni ${slot} Oz Per Pizza`, pp.ozPerPizza, "number");
    }
    if (pp.batchLbs != null && pp.batchLbs > 0) {
      push(`pep${slot}BatchLbs`, `Pepperoni ${slot} Batch Weight (lbs)`, pp.batchLbs, "number");
    }
  });

  return { desired: out, namedPepCount: namedPeps.length };
}

/**
 * Mirror of applySpecImport's dough/sauce RECIPE tie (the recipe loop in
 * storage.ts): a dough or sauce recipe reaches this brand+flavor when
 * `recipeApplyTargets` says so — explicit targets, brand anchors, or the
 * same-brand fan-out over the pool (the sheet's own profiles plus the profile
 * being edited, standing in for the import's saved-profile pool) — OR when the
 * profile's CURRENT recipe name loose-matches the recipe (the import's
 * name re-link). The import overwrites the profile's name/rows/doughball
 * fields unconditionally at tie time, so these outrank the profile-level
 * doughName/sauceName within the same sheet; a later recipe in the same sheet
 * overwrites an earlier one, matching the import loop's order.
 */
function desiredFromDoughSauceRecipes(
  data: ParsedSpecImport,
  source: string,
  brand: string,
  flavor: string,
  current: FormValues,
  sheetProfile?: ParsedProfile,
): Desired[] {
  const recipes = Array.isArray(data?.recipes) ? data.recipes : [];
  const b = brand.trim().toLowerCase();
  const f = flavor.trim().toLowerCase();
  const cur = current as Record<string, unknown>;
  // The import's profile loop runs BEFORE the recipe tie, so by relink time
  // the profile may already carry the sheet's doughName/sauceName (assigned
  // only when the name is blank and no mixed rows exist). Mirror that
  // intermediate state when deciding what name the relink compares against.
  const effectiveName = (nameField: "doughRecipeName" | "frontlineRecipeName"): string => {
    const curName = String(cur[nameField] ?? "").trim();
    if (curName) return curName;
    const pName =
      nameField === "doughRecipeName"
        ? (sheetProfile?.doughName ?? "").trim()
        : (sheetProfile?.sauceName ?? "").trim();
    const rowsField = nameField === "doughRecipeName" ? "doughRecipe" : "frontlineRecipe";
    return pName && !hasRealRows(cur[rowsField]) ? pName : "";
  };
  const pool: ParsedProfile[] = [
    ...(Array.isArray(data?.profiles) ? data.profiles : []),
    { brand, flavor, applicators: [], pepperonis: [] },
  ];
  const byField = new Map<string, Desired>();
  const set = (field: string, label: string, value: string | number, kind: DesiredKind) => {
    byField.set(field, { field, label, value, kind, source });
  };
  for (const r of recipes) {
    if (r.kind !== "dough" && r.kind !== "sauce") continue;
    const rName = (r.name ?? "").trim();
    if (!rName) continue;
    const nameField = r.kind === "dough" ? ("doughRecipeName" as const) : ("frontlineRecipeName" as const);
    const rKey = specImportNameMatchKey(rName);
    const curName = effectiveName(nameField);
    const targeted =
      recipeApplyTargets(r, pool).some(
        (t) => t.brand.trim().toLowerCase() === b && t.flavor.trim().toLowerCase() === f,
      ) ||
      (!!rKey && !!curName && specImportNameMatchKey(curName) === rKey);
    if (!targeted) continue;
    if (r.kind === "dough") {
      set("doughRecipeName", "Dough Recipe", rName, "name");
      // Import parity: storage writes targetDoughballWeight whenever the sheet
      // states doughballOz at all (`!= null`), including an explicit 0.
      if (r.doughballOz != null) {
        set("targetDoughballWeight", "Doughball Weight (oz)", r.doughballOz, "number");
      }
      if (r.doughBatchYield != null && r.doughBatchYield > 0) {
        set("doughBatchYield", "Dough Batch Yield (crusts)", r.doughBatchYield, "number");
      }
      if (r.doughballsPerTray != null && r.doughballsPerTray > 0) {
        set("doughballsPerTray", "Doughballs Per Tray", r.doughballsPerTray, "number");
      }
    } else {
      set("frontlineRecipeName", "Sauce Recipe", rName, "name");
    }
  }
  return [...byField.values()];
}

function nameKey(v: string): string {
  return specImportNameMatchKey(cleanSpecCheeseRecipeName(v));
}

function stringsEqual(a: string, b: string, kind: DesiredKind): boolean {
  if (kind === "name") {
    const ka = nameKey(a);
    const kb = nameKey(b);
    if (ka && kb) return ka === kb;
  }
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * A current numeric value counts as "blank" (fillable) when it is not a real
 * positive number OR still sits at its non-zero schema default (e.g. batch
 * weights default to 25 lbs without anyone ever having set them).
 */
function numberIsBlank(field: string, value: number): boolean {
  if (!(value > 0)) return true;
  const def = Number((DEFAULT_VALUES as Record<string, unknown>)[field] ?? 0);
  return def > 0 && value === def;
}

function stringIsBlank(field: string, value: string): boolean {
  const t = value.trim();
  if (!t) return true;
  // Allergen's schema default is the explicit token "none".
  return field === "allergen" && t.toLowerCase() === "none";
}

/**
 * Compare one brand+flavor's current profile values against the LATEST saved
 * spec-sheet snapshots and plan what an auto-fill could do. Only the newest
 * snapshot per distinct imported file is consulted (same rule as the spec
 * cross-reference); when several latest files mention the same profile, the
 * newest file wins per FIELD, so a die-only sheet and an applicator sheet
 * combine instead of shadowing each other.
 */
export function buildProfileAutofillPlan(opts: {
  sheets: ReadonlyArray<{
    id: number;
    label: string;
    sourceKey?: string | null;
    createdAt: number;
    data: ParsedSpecImport;
  }>;
  brand: string;
  flavor: string;
  current: FormValues;
  /** Lower-cased mix-recipe names (server Mixes pool) for the mix-routing heuristic. */
  mixNamesLower: ReadonlySet<string>;
}): ProfileAutofillPlan {
  const { sheets, brand, flavor, current, mixNamesLower } = opts;
  const b = brand.trim().toLowerCase();
  const f = flavor.trim().toLowerCase();
  const plan: ProfileAutofillPlan = { fills: [], mismatches: [], matchedSheets: 0 };
  if (!b || !f) return plan;

  const latest = latestSourceKeyIds(sheets);
  const ordered = sheets
    .filter((s) => latest.has(s.id))
    .sort((x, y) => y.createdAt - x.createdAt || y.id - x.id);

  const decided = new Map<string, Desired>();
  for (const sheet of ordered) {
    const profiles = Array.isArray(sheet.data?.profiles) ? sheet.data.profiles : [];
    const p = profiles.find(
      (pp) => (pp.brand ?? "").trim().toLowerCase() === b && (pp.flavor ?? "").trim().toLowerCase() === f,
    );
    // Dough/sauce recipes tie onto profiles independently of the sheet's
    // profile blocks (a dough workbook usually has none), so scan them even
    // when this sheet has no matching profile.
    const recipeDesired = desiredFromDoughSauceRecipes(
      sheet.data,
      sheet.label,
      brand,
      flavor,
      current,
      p,
    );
    if (!p && recipeDesired.length === 0) continue;
    plan.matchedSheets += 1;
    const { desired, namedPepCount } = p
      ? desiredFromProfile(p, sheet.data, sheet.label, current, mixNamesLower)
      : { desired: [] as Desired[], namedPepCount: 0 };
    // Recipe-derived fields first: at import time the recipe tie runs AFTER
    // the profile loop and overwrites it, so within one sheet it wins.
    for (const d of [...recipeDesired, ...desired]) {
      if (!decided.has(d.field)) decided.set(d.field, d);
    }
    if (plan.pepCombinedTarget === undefined && namedPepCount > 0) {
      plan.pepCombinedTarget = namedPepCount < 2;
    }
  }

  const cur = current as Record<string, unknown>;
  for (const d of decided.values()) {
    if (typeof d.value === "number") {
      const curN = Number(cur[d.field] ?? 0);
      const specN = d.value;
      if (numberIsBlank(d.field, curN)) {
        if (Math.abs(curN - specN) > 0.005) {
          plan.fills.push({ field: d.field, label: d.label, specValue: specN, source: d.source });
        }
      } else if (Math.abs(curN - specN) > 0.005) {
        plan.mismatches.push({
          field: d.field,
          label: d.label,
          specValue: specN,
          currentValue: curN,
          source: d.source,
        });
      }
    } else {
      const curS = String(cur[d.field] ?? "");
      const specS = d.value;
      if (stringIsBlank(d.field, curS)) {
        plan.fills.push({ field: d.field, label: d.label, specValue: specS, source: d.source });
      } else if (!stringsEqual(curS, specS, d.kind)) {
        plan.mismatches.push({
          field: d.field,
          label: d.label,
          specValue: specS,
          currentValue: curS.trim(),
          source: d.source,
        });
      }
    }
  }

  return plan;
}

/**
 * Apply accepted entries onto a copy of the form values. When any pepperoni
 * TYPE entry is applied and the plan derived a combined/uncombined target, the
 * pep1Combined flag follows — same derivation the real import performs.
 */
export function applyAutofillEntries(
  current: FormValues,
  entries: ReadonlyArray<AutofillEntry>,
  pepCombinedTarget?: boolean,
): FormValues {
  const out = { ...current } as Record<string, unknown>;
  let pepTypeTouched = false;
  for (const e of entries) {
    out[e.field] = e.specValue;
    if (/^pep[12]Type$/.test(e.field)) pepTypeTouched = true;
  }
  if (pepTypeTouched && pepCombinedTarget !== undefined) {
    out.pep1Combined = pepCombinedTarget;
  }
  return out as FormValues;
}
