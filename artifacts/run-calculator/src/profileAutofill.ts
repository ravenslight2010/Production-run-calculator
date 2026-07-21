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
  specImportBrandMatchKey,
  specImportNamedRecipeNamesEqual,
  specImportDieTypeMatchKey,
  specImportTypeNameFoldKey,
  cleanSpecCheeseRecipeName,
  recipeApplyTargets,
  type ParsedProfile,
  type ParsedRecipe,
  type ParsedSpecImport,
} from "@workspace/spec-import";
import { matchDoughballVariant, normalizeDoughballVariants } from "@workspace/named-recipes";
import { buildNearDupNameMatcher } from "@workspace/name-match";
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

/** One value a source proposes for a conflicted field. */
export type AutofillCandidate = {
  /** The value this source states. */
  value: string | number;
  /** Which saved source proposed it ("Latest spec sheet", "Palletizing guide"…). */
  source: string;
};

/**
 * A field where two or more saved sources DISAGREE. Never auto-applied — the
 * user picks which value (or keeps the current one) in the editor.
 */
export type AutofillConflict = {
  /** FormValues key in dispute. */
  field: string;
  /** Human-readable field label. */
  label: string;
  kind: DesiredKind;
  /** The current profile value, when it is already set (not blank/default). */
  currentValue?: string | number;
  /** Distinct values the sources propose (always two or more). */
  candidates: AutofillCandidate[];
};

export type ProfileAutofillPlan = {
  /** Blank/default fields the spec can fill — safe to auto-apply to the form. */
  fills: AutofillEntry[];
  /** Fields whose current value differs from the spec — per-field review. */
  mismatches: AutofillEntry[];
  /** Fields where saved sources disagree — the user picks which value to use. */
  conflicts: AutofillConflict[];
  /** How many of the latest saved sheets mention this brand+flavor. */
  matchedSheets: number;
  /**
   * Derived pep1Combined the import would set (single named pep = combined,
   * two = not). Applied only when a pep TYPE entry is actually accepted.
   */
  pepCombinedTarget?: boolean;
};

/** Minimal shape of a saved shipping/palletizing-guide snapshot (see savedShippingGuides.ts). */
export type ShippingGuideSnapshot = {
  label: string;
  sourceKey?: string | null;
  createdAt: number;
  rows: ReadonlyArray<{
    brand: string;
    flavors?: string[];
    patch: {
      shipper?: string;
      skidStacking?: string;
      pizzasPerCase?: number;
      casesPerSkid?: number;
      circles?: string;
      gripSheets?: string;
    };
  }>;
};

/** Minimal shape of a dough-pool recipe (server named-recipes, kind "dough"). */
export type DoughPoolRecipe = {
  name: string;
  brand?: string;
  flavors?: string[];
  doughballWeightOz?: number | null;
  doughballVariants?: unknown;
  enabled?: boolean;
};

/** Minimal shape of a cheese-pool recipe (server cheese recipes). */
export type CheesePoolRecipe = {
  name: string;
  brand?: string;
  flavors?: string[];
  components?: ReadonlyArray<{ lbs?: number | null }>;
  enabled?: boolean;
};

/** Minimal shape of a premix-pool recipe (server Mixes). */
export type MixPoolRecipe = {
  name: string;
  brand?: string;
  flavor?: string;
  batchSize?: number | null;
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
  return specImportCheeseRecipeIsMix(
    r.name,
    mixNamesLower,
    r.rows.length,
    r.rows.map((row) => row.ingredient ?? ""),
  );
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
  poolCheeseNames: ReadonlyArray<string>,
  poolMixNames: ReadonlyArray<string>,
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
  // Union the server pools into the candidates exactly like applySpecImport
  // does: a spec sheet often names a blend the factory already has, with no
  // recipe block in the same file — sheet-only candidates would leave the raw
  // blend name as a phantom applicator type instead of a typed cheese/Mix
  // slot linked to the pool. Pool cheese names are filtered against the mix
  // name list (same reason as the import: shared preset namespace).
  const cheeseCandidateNames = [
    ...data.recipes
      .filter((r) => r.kind === "cheese" && !routesToMix(r, mixNamesLower))
      .map((r) => r.name),
    ...poolCheeseNames.filter((n) => !mixNamesLower.has(n.trim().toLowerCase())),
  ];
  const mixCandidateNames = [
    ...data.recipes
      .filter((r) => r.kind === "cheese" && routesToMix(r, mixNamesLower))
      .map((r) => r.name),
    ...poolMixNames,
  ];
  // Mirror the import's profile-link candidates: a generic-typed slot on the
  // CURRENT profile may link a recipe that exists in neither this sheet nor
  // the pools (e.g. "Hot Giardiniera Mix"); without it the resolver finds no
  // match and the planner flags a false Type mismatch (raw name vs "Mix").
  const profileLinkCandidates = (kind: "cheese" | "mix"): string[] => {
    const out: string[] = [];
    for (let slot = 1; slot <= 4; slot++) {
      const t = String(cur[`app${slot}Type`] ?? "").trim().toLowerCase();
      const link = String(cur[`app${slot}CheeseRecipeName`] ?? "").trim();
      if (link && t === kind) out.push(link);
    }
    return out;
  };
  const { applicators: cheeseResolved, links: cheeseLinks } = resolveCheeseApplicatorSlots(
    assignApplicatorSlots(p.applicators ?? []),
    [...cheeseCandidateNames, ...profileLinkCandidates("cheese")],
    p.brand,
  );
  const { applicators: resolvedApps, links: mixLinks } = resolveMixApplicatorSlots(
    cheeseResolved,
    [...mixCandidateNames, ...profileLinkCandidates("mix")],
    p.brand,
  );
  resolvedApps.forEach((a, i) => {
    const slot = i + 1;
    const type = (a.type ?? "").trim();
    if (!type) return;
    // Near-dup equivalence: a sheet blend name the slot resolvers left RAW
    // (no loose-key match anywhere) may still be the SAME blend the profile
    // already links on its generic "cheese"/"Mix" slot, just spelled with a
    // possessive/extra word ("Bobo Breakfast Cheese" vs linked "Bobo's
    // Breakfast Cheese Mix"). Suggesting the raw name over the generic type
    // would UNLINK the recipe — a strictly worse setup — so when the profile
    // slot's linked recipe near-dup-matches the raw name, the type is in
    // substance equal and no suggestion is made. Genuinely different names
    // (no near-dup match) still surface as real mismatches.
    if (rawTypeMatchesProfileLink(type, cur, slot)) return;
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
  // The stand-in for the profile being edited carries its effective linked
  // dough/sauce names so recipeApplyTargets' qualified-name narrowing can see
  // that this profile already runs a DIFFERENT recipe — mirroring the pool the
  // real import builds from saved profiles.
  const pool: ParsedProfile[] = [
    ...(Array.isArray(data?.profiles) ? data.profiles : []),
    {
      brand,
      flavor,
      doughName: effectiveName("doughRecipeName") || undefined,
      sauceName: effectiveName("frontlineRecipeName") || undefined,
      applicators: [],
      pepperonis: [],
    },
  ];
  const byField = new Map<string, Desired>();
  const set = (field: string, label: string, value: string | number, kind: DesiredKind) => {
    byField.set(field, { field, label, value, kind, source });
  };
  // A dough mixing sheet carries MANY same-named variant rows (one per
  // customer). Count them so a name-relinked tie can tell "the one CRB Dough
  // row" apart from "18 ambiguous variant rows".
  const doughNameCounts = new Map<string, number>();
  for (const r of recipes) {
    if (r.kind !== "dough") continue;
    const k = specImportNameMatchKey((r.name ?? "").trim());
    if (k) doughNameCounts.set(k, (doughNameCounts.get(k) ?? 0) + 1);
  }
  for (const r of recipes) {
    if (r.kind !== "dough" && r.kind !== "sauce") continue;
    const rName = (r.name ?? "").trim();
    if (!rName) continue;
    const nameField = r.kind === "dough" ? ("doughRecipeName" as const) : ("frontlineRecipeName" as const);
    const rKey = specImportNameMatchKey(rName);
    const curName = effectiveName(nameField);
    // The import distinguishes HOW a recipe ties on: its own explicit spec
    // targets / brand anchors take doughball values verbatim, while a profile
    // tied on only by the NAME re-link is blank-fill-only for weight/per-tray
    // (one dough family serves many flavors with DIFFERENT doughball weights,
    // and a sheet can carry several same-named variant rows — without this
    // split, whichever variant is processed last wins, e.g. a Corner Booth
    // profile offered the Lowe's 7 Inch 5.7 oz instead of its own 8.25).
    const anchored = recipeApplyTargets(r, pool).some(
      (t) => brandsEqual(t.brand, brand) && t.flavor.trim().toLowerCase() === f,
    );
    // Mirror the import's typo/possessive-tolerant name re-link (see the
    // relink pass in storage.ts — "Aldo's Sauce" vs "ALDO PIZZA SAUCE").
    const relinkOnly =
      !anchored && !!rKey && !!curName && specImportNamedRecipeNamesEqual(curName, rName);
    if (!anchored && !relinkOnly) continue;
    // Effective value at tie time, mirroring the import's sequential apply:
    // an earlier recipe in this same sheet may have already written the field.
    const effectiveNum = (field: string): number => {
      const prior = byField.get(field);
      return prior ? Number(prior.value) : Number(cur[field] ?? 0);
    };
    if (r.kind === "dough") {
      set("doughRecipeName", "Dough Recipe", rName, "name");
      // Relink-only tie onto a sheet with MULTIPLE same-named variant rows:
      // the rows are per-customer variants and this profile matches by name
      // alone, so the doughball numbers are ambiguous — the first row in
      // sheet order would win (e.g. Costco's 20/tray offered to a Corner
      // Booth 24/tray profile). Only the row whose doughball weight equals
      // the profile's known weight is "ours"; with no known weight, offer
      // no doughball numbers at all.
      if (relinkOnly && (doughNameCounts.get(rKey) ?? 0) > 1) {
        const wt = effectiveNum("targetDoughballWeight");
        const rowMatches =
          wt > 0 && r.doughballOz != null && Math.abs(Number(r.doughballOz) - wt) <= 0.005;
        if (!rowMatches) continue;
      }
      // Import parity: storage writes targetDoughballWeight whenever the sheet
      // states doughballOz at all (`!= null`), including an explicit 0 — but a
      // name-relinked tie only backfills when the value is still blank.
      if (r.doughballOz != null && (anchored || !(effectiveNum("targetDoughballWeight") > 0))) {
        set("targetDoughballWeight", "Doughball Weight (oz)", r.doughballOz, "number");
      }
      if (
        r.doughBatchYield != null && r.doughBatchYield > 0 &&
        (anchored || !(effectiveNum("doughBatchYield") > 0))
      ) {
        set("doughBatchYield", "Dough Batch Yield (crusts)", r.doughBatchYield, "number");
      }
      if (
        r.doughballsPerTray != null && r.doughballsPerTray > 0 &&
        (anchored || !(effectiveNum("doughballsPerTray") > 0))
      ) {
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

/**
 * Possessive-tolerant fold key for near-dup comparing a raw sheet applicator
 * label against a profile slot's linked recipe name: cheese-name cleanup
 * (trailing weights etc.) then the shared loose brand key (per-token
 * possessive fold — "Bobo's" == "Bobo").
 */
function possessiveFoldNameKey(v: string): string {
  return specImportBrandMatchKey(cleanSpecCheeseRecipeName(v));
}

/**
 * True when a RAW (unresolved) sheet applicator type is in substance the same
 * blend the profile's slot already carries: the slot is generic-typed
 * ("cheese"/"Mix"), links a recipe, and that linked recipe name near-dup
 * matches the raw label under the shared layered matcher (possessive fold +
 * one extra token allowed — "Bobo Breakfast Cheese" vs "Bobo's Breakfast
 * Cheese Mix"). Raw labels that already resolved to a generic type never get
 * here (they compare equal upstream); genuinely different blend names find no
 * near-dup match and still surface as real Type mismatches.
 */
function rawTypeMatchesProfileLink(
  rawType: string,
  cur: Record<string, unknown>,
  slot: number,
): boolean {
  const curType = String(cur[`app${slot}Type`] ?? "").trim().toLowerCase();
  if (curType !== "cheese" && curType !== "mix") return false;
  const link = String(cur[`app${slot}CheeseRecipeName`] ?? "").trim();
  if (!link) return false;
  const rawLower = rawType.trim().toLowerCase();
  if (rawLower === "cheese" || rawLower === "mix") return false;
  const match = buildNearDupNameMatcher([link], {
    keyOf: possessiveFoldNameKey,
    allowExtraToken: true,
  });
  return match(rawType) !== null;
}

/**
 * Possessive/punctuation-tolerant BRAND equality for matching saved-sheet rows
 * onto the open profile: exact lowercase first, then the import's shared loose
 * brand key so a parse typo (`Aldo"s` for `Aldo's`) still matches — a strict
 * compare left such a row invisible to Auto-Fill even though the import's own
 * fan-out passes would have matched it.
 */
function brandsEqual(a: string, b: string): boolean {
  const al = a.trim().toLowerCase();
  const bl = b.trim().toLowerCase();
  if (al === bl) return true;
  const ka = specImportBrandMatchKey(a);
  const kb = specImportBrandMatchKey(b);
  return !!ka && !!kb && ka === kb;
}

/**
 * Brand-token-tolerant compare for LINKED RECIPE NAMES on a profile of `brand`:
 * a cheese/premix import de-collides duplicate names by prefixing the customer
 * brand ("Lowe's BBQ Chicken Cheese Mix"), so on a Lowe's profile that name and
 * the unprefixed "BBQ Chicken Cheese Mix" are the same blend — flagging it as a
 * mismatch just nags. Strips the profile brand's own tokens from BOTH keys and
 * compares what's left; names differing beyond the brand words stay unequal.
 */
function namesEqualIgnoringOwnBrand(a: string, b: string, brand: string): boolean {
  // Union of both brand-key spellings: the loose name key keeps the
  // possessive "s" ("aldo s") while the brand match key folds it ("aldo") —
  // strip both forms or "Aldo's X" vs "X" leaves a stray "s" behind.
  const brandToks = new Set([
    ...specImportBrandMatchKey(brand).split(" "),
    ...nameKey(brand).split(" "),
  ].filter(Boolean));
  if (brandToks.size === 0) return false;
  const strip = (v: string): string =>
    nameKey(v).split(" ").filter((t) => t && !brandToks.has(t)).join(" ");
  const sa = strip(a);
  const sb = strip(b);
  return !!sa && !!sb && sa === sb;
}

function stringsEqual(a: string, b: string, kind: DesiredKind, field?: string, brand?: string): boolean {
  if (kind === "name") {
    const ka = nameKey(a);
    const kb = nameKey(b);
    if (ka && kb) {
      if (ka === kb) return true;
      if (brand && namesEqualIgnoringOwnBrand(a, b, brand)) return true;
      return false;
    }
  }
  // Applicator/pepperoni TYPE names compare by the import's neutral-descriptor
  // fold key so "Whole Milk Mozzarella" == "Whole Mozzarella" — the sheet's
  // dairy descriptor is not a different product; a raw compare flags a false
  // mismatch ("now Whole Mozzarella · import says Whole Milk Mozzarella").
  if (field && /^(?:app[1-4]|pep[12])Type$/.test(field)) {
    const ka = specImportTypeNameFoldKey(a);
    const kb = specImportTypeNameFoldKey(b);
    if (ka && kb && ka === kb) return true;
  }
  // Die types compare by the import's die key so '12"' == '12" Dies' — sheets
  // append the generic "Dies" word; a raw compare flags a false mismatch.
  if (field === "dieType") {
    const ka = specImportDieTypeMatchKey(a);
    const kb = specImportDieTypeMatchKey(b);
    if (ka && kb) return ka === kb;
  }
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * A current numeric value counts as "blank" (fillable) when it is not a real
 * positive number OR still sits at a non-zero schema default (today only
 * speedAdjustment 1.0 — all quantity defaults are 0, so a stored positive
 * value like a pep batch weight of 25 counts as real data).
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

/** Two proposed values are "the same" under the field's comparison rules. */
function valuesEqual(a: string | number, b: string | number, kind: DesiredKind, field?: string, brand?: string): boolean {
  if (kind === "number") return Math.abs(Number(a) - Number(b)) <= 0.005;
  return stringsEqual(String(a), String(b), kind, field, brand);
}

function currentIsBlank(field: string, cur: unknown, kind: DesiredKind): boolean {
  if (kind === "number") return numberIsBlank(field, Number(cur ?? 0));
  return stringIsBlank(field, String(cur ?? ""));
}

/**
 * Packaging fields a saved shipping/palletizing guide implies for this
 * brand+flavor. Newest guide wins per FIELD (same rule as the spec sheets); a
 * row with empty flavors applies to every flavor of the brand, and a
 * flavor-specific row outranks a brand-wide one within the same guide. Only the
 * fields the guide actually mapped to app packaging values are considered —
 * `circles`/`gripSheets` have no FormValues home and are ignored.
 */
function desiredFromShipping(
  guides: ReadonlyArray<ShippingGuideSnapshot>,
  brand: string,
  flavor: string,
): Map<string, Desired> {
  const b = brand.trim().toLowerCase();
  const f = flavor.trim().toLowerCase();
  const out = new Map<string, Desired>();
  const ordered = [...guides].sort((x, y) => y.createdAt - x.createdAt);
  for (const guide of ordered) {
    const source = (guide.label ?? "").trim() || "Palletizing guide";
    // Within one guide, prefer a flavor-specific row over a brand-wide one.
    let brandWide: ShippingGuideSnapshot["rows"][number] | undefined;
    let flavorRow: ShippingGuideSnapshot["rows"][number] | undefined;
    for (const row of guide.rows ?? []) {
      if ((row.brand ?? "").trim().toLowerCase() !== b) continue;
      const flavors = (row.flavors ?? []).map((x) => x.trim().toLowerCase()).filter(Boolean);
      if (flavors.length === 0) {
        if (!brandWide) brandWide = row;
      } else if (flavors.includes(f)) {
        if (!flavorRow) flavorRow = row;
      }
    }
    const row = flavorRow ?? brandWide;
    if (!row) continue;
    const patch = row.patch ?? {};
    const setStr = (field: string, label: string, v?: string) => {
      const t = (v ?? "").trim();
      if (t && !out.has(field)) out.set(field, { field, label, value: t, kind: "string", source });
    };
    const setNum = (field: string, label: string, v?: number) => {
      if (v != null && v > 0 && !out.has(field)) {
        out.set(field, { field, label, value: v, kind: "number", source });
      }
    };
    setStr("shipper", "Shipper", patch.shipper);
    setStr("skidStacking", "Skid Stacking", patch.skidStacking);
    setNum("pizzasPerCase", "Pizzas Per Case", patch.pizzasPerCase);
    setNum("casesPerSkid", "Cases Per Skid", patch.casesPerSkid);
  }
  return out;
}

/**
 * Dough-pool fields for this brand+flavor. Prefers the pool recipe already
 * linked (by loose name) to the profile's current/spec dough name, else the
 * first enabled recipe reaching this brand+flavor. Offers the recipe name and,
 * when the pool holds a real doughball weight (>0), that weight — the two
 * scalars that overlap with what a spec sheet states.
 */
function desiredFromDoughPool(
  recipes: ReadonlyArray<DoughPoolRecipe>,
  brand: string,
  flavor: string,
  current: FormValues,
  linkedName: string,
  effectiveDieType: string,
): Map<string, Desired> {
  const b = brand.trim().toLowerCase();
  const f = flavor.trim().toLowerCase();
  const out = new Map<string, Desired>();
  const reaches = (r: DoughPoolRecipe): boolean => {
    if ((r.brand ?? "").trim().toLowerCase() !== b) return false;
    const flavors = (r.flavors ?? []).map((x) => x.trim().toLowerCase()).filter(Boolean);
    return flavors.length === 0 || flavors.includes(f);
  };
  const enabled = recipes.filter((r) => r.enabled !== false && (r.name ?? "").trim());
  const candidates = enabled.filter(reaches);
  if (candidates.length === 0) return out;
  const wantKey = linkedName.trim() ? nameKey(linkedName) : "";
  const chosen =
    (wantKey && candidates.find((r) => nameKey(r.name) === wantKey)) || candidates[0];
  const source = `Dough recipe (${chosen.name.trim()})`;
  out.set("doughRecipeName", {
    field: "doughRecipeName",
    label: "Dough Recipe",
    value: chosen.name.trim(),
    kind: "name",
    source,
  });
  // Variant-aware weight, mirroring the run form / profile editor: a family
  // recipe's variant list wins over the recipe-level number (die-size match,
  // or the only variant). With several variants and no die match the weight
  // is AMBIGUOUS — offer nothing rather than the recipe-level fallback, which
  // belongs to no particular customer (e.g. CRB Dough's 13 oz would surface
  // as a bogus mismatch on an 8.25 oz Corner Booth profile).
  const variants = normalizeDoughballVariants(chosen.doughballVariants);
  const matched = matchDoughballVariant(variants, { dieType: effectiveDieType });
  const wt = matched
    ? Number(matched.weightOz ?? 0)
    : variants.length > 1
      ? 0
      : Number(chosen.doughballWeightOz ?? 0);
  if (wt > 0) {
    out.set("targetDoughballWeight", {
      field: "targetDoughballWeight",
      label: "Doughball Weight (oz)",
      value: wt,
      kind: "number",
      source,
    });
  }
  if (matched && (matched.perTray ?? 0) > 0) {
    out.set("doughballsPerTray", {
      field: "doughballsPerTray",
      label: "Doughballs Per Tray",
      value: matched.perTray!,
      kind: "number",
      source,
    });
  }
  return out;
}

/**
 * Cheese/premix-pool batch weights, anchored to the applicator slot each recipe
 * name is assigned to (by the spec sheet, else by the current profile). A cheese
 * recipe's per-batch weight is the sum of its component lbs; a premix's is its
 * stored batchSize. These cross-check the batch weight the spec sheet states for
 * the same slot — the one scalar the pools and the sheet both carry.
 */
function desiredFromCheeseMixPools(
  cheese: ReadonlyArray<CheesePoolRecipe>,
  mixes: ReadonlyArray<MixPoolRecipe>,
  current: FormValues,
  specDecided: ReadonlyMap<string, Desired>,
): { cheese: Map<string, Desired>; mix: Map<string, Desired> } {
  const cheeseOut = new Map<string, Desired>();
  const mixOut = new Map<string, Desired>();
  const cur = current as Record<string, unknown>;
  for (let slot = 1; slot <= 4; slot++) {
    const nameField = `app${slot}CheeseRecipeName`;
    const slotName = String(
      specDecided.get(nameField)?.value ?? cur[nameField] ?? "",
    ).trim();
    if (!slotName) continue;
    const key = nameKey(slotName);
    if (!key) continue;
    const batchField = `app${slot}BatchLbs`;
    const label = `Applicator ${slot} Batch Weight (lbs)`;
    const c = cheese.find((r) => (r.name ?? "").trim() && nameKey(r.name) === key);
    if (c) {
      const lbs = Math.round(
        (c.components ?? []).reduce((s, comp) => s + Math.max(0, Number(comp.lbs ?? 0)), 0) * 10,
      ) / 10;
      if (lbs > 0) {
        cheeseOut.set(batchField, {
          field: batchField,
          label,
          value: lbs,
          kind: "number",
          source: `Cheese recipe (${c.name.trim()})`,
        });
      }
    }
    const m = mixes.find((r) => (r.name ?? "").trim() && nameKey(r.name) === key);
    if (m && Number(m.batchSize ?? 0) > 0) {
      mixOut.set(batchField, {
        field: batchField,
        label,
        value: Number(m.batchSize),
        kind: "number",
        source: `Premix (${m.name.trim()})`,
      });
    }
  }
  return { cheese: cheeseOut, mix: mixOut };
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
  /** Saved palletizing/shipping-guide snapshots (packaging values). Optional. */
  shippingGuides?: ReadonlyArray<ShippingGuideSnapshot>;
  /** Server dough-recipe pool. Optional. */
  doughRecipes?: ReadonlyArray<DoughPoolRecipe>;
  /** Server cheese-recipe pool. Optional. */
  cheeseRecipes?: ReadonlyArray<CheesePoolRecipe>;
  /** Server Mixes (premix) pool. Optional. */
  mixes?: ReadonlyArray<MixPoolRecipe>;
}): ProfileAutofillPlan {
  const { sheets, brand, flavor, current, mixNamesLower } = opts;
  const b = brand.trim().toLowerCase();
  const f = flavor.trim().toLowerCase();
  const plan: ProfileAutofillPlan = { fills: [], mismatches: [], conflicts: [], matchedSheets: 0 };
  if (!b || !f) return plan;

  // Server-pool names for the slot-resolver candidate union (see
  // desiredFromProfile). Disabled cheese recipes are excluded — the run form
  // can't hydrate them.
  const poolCheeseNames = (opts.cheeseRecipes ?? [])
    .filter((r) => r.enabled !== false && (r.name ?? "").trim())
    .map((r) => r.name.trim());
  const poolMixNames = (opts.mixes ?? [])
    .filter((r) => (r.name ?? "").trim())
    .map((r) => r.name.trim());

  const latest = latestSourceKeyIds(sheets);
  const ordered = sheets
    .filter((s) => latest.has(s.id))
    .sort((x, y) => y.createdAt - x.createdAt || y.id - x.id);

  const decided = new Map<string, Desired>();
  for (const sheet of ordered) {
    const profiles = Array.isArray(sheet.data?.profiles) ? sheet.data.profiles : [];
    // Exact brand+flavor first; fall back to the loose brand key so a saved
    // parse row stored under a punctuation-typo brand (`Aldo"s`) still feeds
    // the real profile (`Aldo's`). Exact wins when both exist on one sheet.
    const p =
      profiles.find(
        (pp) => (pp.brand ?? "").trim().toLowerCase() === b && (pp.flavor ?? "").trim().toLowerCase() === f,
      ) ??
      profiles.find(
        (pp) => brandsEqual(pp.brand ?? "", brand) && (pp.flavor ?? "").trim().toLowerCase() === f,
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
      ? desiredFromProfile(
          p,
          sheet.data,
          sheet.label,
          current,
          mixNamesLower,
          poolCheeseNames,
          poolMixNames,
        )
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

  // Additional saved sources beyond the spec sheets. Each is its own group so
  // that when a field appears in more than one group with DIFFERENT values it
  // surfaces as a conflict for the user to resolve instead of one source
  // silently winning. The spec group (`decided`) is the anchor for slot names.
  const linkedDoughName = String(
    decided.get("doughRecipeName")?.value ?? cur.doughRecipeName ?? "",
  ).trim();
  const shippingDecided = desiredFromShipping(opts.shippingGuides ?? [], brand, flavor);
  const doughDecided = desiredFromDoughPool(
    opts.doughRecipes ?? [],
    brand,
    flavor,
    current,
    linkedDoughName,
    // Effective die type for the variant match: the form's value, else the die
    // type the latest sheet states (a blank form should still match variants).
    String(cur.dieType ?? "").trim() || String(decided.get("dieType")?.value ?? "").trim(),
  );
  const { cheese: cheeseDecided, mix: mixDecided } = desiredFromCheeseMixPools(
    opts.cheeseRecipes ?? [],
    opts.mixes ?? [],
    current,
    decided,
  );

  // Priority order for which group's label is credited when a single agreed
  // value is applied, and the deterministic order candidates are listed in.
  const groups: ReadonlyArray<ReadonlyMap<string, Desired>> = [
    decided,
    doughDecided,
    shippingDecided,
    cheeseDecided,
    mixDecided,
  ];
  const allFields: string[] = [];
  const seenField = new Set<string>();
  for (const g of groups) {
    for (const field of g.keys()) {
      if (!seenField.has(field)) {
        seenField.add(field);
        allFields.push(field);
      }
    }
  }

  for (const field of allFields) {
    const entries: Desired[] = [];
    for (const g of groups) {
      const d = g.get(field);
      if (d) entries.push(d);
    }
    if (entries.length === 0) continue;
    const { kind, label } = entries[0];

    // Distinct proposed values across all sources (first source per value wins
    // the credit line).
    const distinct: Desired[] = [];
    for (const e of entries) {
      if (!distinct.some((d) => valuesEqual(d.value, e.value, kind, field, brand))) distinct.push(e);
    }

    // Sources disagree with EACH OTHER → conflict; the user picks.
    if (distinct.length >= 2) {
      const conflict: AutofillConflict = {
        field,
        label,
        kind,
        candidates: distinct.map((d) => ({ value: d.value, source: d.source })),
      };
      if (!currentIsBlank(field, cur[field], kind)) {
        conflict.currentValue =
          kind === "number" ? Number(cur[field] ?? 0) : String(cur[field] ?? "").trim();
      }
      plan.conflicts.push(conflict);
      continue;
    }

    // A single agreed value → fill a blank field or flag a mismatch, exactly as
    // the spec-only path always has.
    const d = distinct[0];
    if (kind === "number") {
      const curN = Number(cur[field] ?? 0);
      const specN = Number(d.value);
      if (numberIsBlank(field, curN)) {
        if (Math.abs(curN - specN) > 0.005) {
          plan.fills.push({ field, label, specValue: specN, source: d.source });
        }
      } else if (Math.abs(curN - specN) > 0.005) {
        plan.mismatches.push({ field, label, specValue: specN, currentValue: curN, source: d.source });
      }
    } else {
      const curS = String(cur[field] ?? "");
      const specS = String(d.value);
      if (stringIsBlank(field, curS)) {
        plan.fills.push({ field, label, specValue: specS, source: d.source });
      } else if (!stringsEqual(curS, specS, kind, field, brand)) {
        plan.mismatches.push({
          field,
          label,
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
