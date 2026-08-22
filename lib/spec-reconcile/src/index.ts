// @workspace/spec-reconcile — pure, platform-agnostic logic that cross-references
// a SAVED spec sheet against the CURRENT recipe library and reports where they
// disagree ("does the recipe still match the spec?").
//
// No platform IO (no fetch, no storage, no AI). Web, mobile, and the server all
// feed two recipe lists through `reconcileSpecWithRecipes` so the discrepancy
// math is identical everywhere (replit.md parity). The server additionally hands
// the result to an AI for a plain-language summary, but the discrepancies
// themselves are deterministic and reliable on their own.
//
// Names are already canonicalized at import time, so recipes are matched by
// kind+name (case-insensitive) and ingredients by name (case-insensitive); the
// only fuzzy dimension is the pound tolerance.

export type ReconcileKind = "dough" | "sauce" | "cheese";

export type ReconcileRow = { ingredient: string; lbs: number };

export type ReconcileRecipe = {
  kind: ReconcileKind;
  name: string;
  rows: ReconcileRow[];
};

export type DiscrepancyType =
  // The spec sheet defines this recipe but the current library has no recipe of
  // the same kind+name.
  | "missing-recipe"
  // A matched recipe is missing an ingredient the spec sheet lists.
  | "missing-ingredient"
  // A matched recipe has an ingredient the spec sheet does not list.
  | "extra-ingredient"
  // A matched recipe + ingredient where the pounds differ beyond tolerance.
  | "amount-mismatch";

export type Discrepancy = {
  kind: ReconcileKind;
  recipeName: string;
  type: DiscrepancyType;
  /** Present for ingredient-level discrepancies. */
  ingredient?: string;
  /** Pounds the spec sheet calls for (missing-ingredient / amount-mismatch). */
  specLbs?: number;
  /** Pounds in the current recipe (extra-ingredient / amount-mismatch). */
  currentLbs?: number;
  /** Plain-language, app-consistent description of the discrepancy. */
  message: string;
};

export type SpecReconcileInput = {
  /** Recipes from the saved spec sheet. */
  specRecipes: ReconcileRecipe[];
  /** Recipes currently in the app's library. */
  currentRecipes: ReconcileRecipe[];
  /**
   * Absolute pound difference at or below which an amount is treated as a match.
   * Defaults to 0.001 so floating-point noise never registers as a discrepancy.
   */
  lbsTolerance?: number;
};

/**
 * A deterministic, manager-facing change manifest for an incoming workbook.
 * Unlike reconciliation (which answers whether a current recipe matches a
 * source), this describes the concrete writes an import would make.
 */
export type ImportReviewChangeKind =
  | "added"
  | "removed"
  | "quantity-changed"
  | "formula-cleared"
  | "family-collapsed"
  | "variant-loss"
  | "customer-remapped";

export type ImportReviewChange = {
  kind: ImportReviewChangeKind;
  entity: string;
  message: string;
  before?: string;
  after?: string;
  /** Must be explicitly acknowledged before this import can be applied. */
  requiresConfirmation?: boolean;
};

export type ImportReview = {
  changes: ImportReviewChange[];
  counts: Record<ImportReviewChangeKind, number>;
  requiresExplicitConfirmation: boolean;
  confirmationReasons: string[];
};

export type ImportReviewCustomerMapping = {
  brand: string;
  qualifier?: string;
  flavors: string[];
};

export type BuildImportReviewInput = {
  incomingRecipes: ReconcileRecipe[];
  currentRecipes: ReconcileRecipe[];
  /** Profiles deliberately selected for deletion after a re-import. */
  removedProfiles?: ReadonlyArray<{ brand: string; flavor: string }>;
  /**
   * Explicit dough customer mappings extracted from a workbook. Empty flavor
   * means "all flavors" and is intentionally treated as broad, never hidden.
   */
  customerMappings?: ReadonlyArray<ImportReviewCustomerMapping>;
  /**
   * Family-collapse and variant coverage information from the canonicalized
   * parse. Both are optional so callers can use this for premix-style imports.
   */
  familyCollapses?: ReadonlyArray<{ family: string; variant: string }>;
  missingVariants?: ReadonlyArray<{ family: string; variant: string }>;
  largeChangeThreshold?: number;
};

const KINDS: ReadonlySet<string> = new Set<ReconcileKind>(["dough", "sauce", "cheese"]);

function recipeKey(kind: string, name: string): string {
  return `${kind}\u0000${name.trim().toLowerCase()}`;
}

/** Format pounds compactly: up to 3 decimals, trailing zeros stripped. */
export function fmtLbs(n: number): string {
  if (!Number.isFinite(n)) return "0";
  const r = Math.round(n * 1000) / 1000;
  return String(r);
}

/**
 * Collapse a recipe's rows into a name→{ingredient,lbs} map, summing duplicate
 * ingredient rows and dropping blank-named rows. Non-finite pounds count as 0.
 * The first-seen display spelling of an ingredient is kept.
 */
function aggregateRows(rows: ReadonlyArray<ReconcileRow>): Map<string, ReconcileRow> {
  const out = new Map<string, ReconcileRow>();
  for (const row of rows) {
    const ingredient = (row?.ingredient ?? "").trim();
    if (!ingredient) continue;
    const lbs = Number.isFinite(row.lbs) ? row.lbs : 0;
    const key = ingredient.toLowerCase();
    const prior = out.get(key);
    if (prior) prior.lbs += lbs;
    else out.set(key, { ingredient, lbs });
  }
  return out;
}

/**
 * Build a precise, bounded-risk manifest for an import. This function is pure
 * so the same result can be used in the web review, import history, and a
 * future server-side commit boundary.
 */
export function buildImportReview(input: BuildImportReviewInput): ImportReview {
  const changes: ImportReviewChange[] = [];
  const currentByKey = new Map<string, ReconcileRecipe>();
  for (const recipe of input.currentRecipes) {
    currentByKey.set(recipeKey(recipe.kind, recipe.name), recipe);
  }

  for (const incoming of input.incomingRecipes) {
    const current = currentByKey.get(recipeKey(incoming.kind, incoming.name));
    const label = `${incoming.kind} recipe "${incoming.name}"`;
    if (!current) {
      changes.push({ kind: "added", entity: label, message: `Adds ${label}.` });
      continue;
    }

    const before = aggregateRows(current.rows);
    const after = aggregateRows(incoming.rows);
    if (before.size > 0 && after.size === 0) {
      changes.push({
        kind: "formula-cleared",
        entity: label,
        before: `${before.size} ingredient rows`,
        after: "no ingredient rows",
        requiresConfirmation: true,
        message: `Would clear the nonempty formula for ${label}.`,
      });
      continue;
    }

    for (const [key, oldRow] of before) {
      const nextRow = after.get(key);
      if (!nextRow) {
        changes.push({
          kind: "removed",
          entity: label,
          before: `${oldRow.ingredient}: ${fmtLbs(oldRow.lbs)} lbs`,
          requiresConfirmation: true,
          message: `Removes "${oldRow.ingredient}" from ${label}.`,
        });
      } else if (Math.abs(oldRow.lbs - nextRow.lbs) > 0.001) {
        const relativeChange = oldRow.lbs === 0
          ? (nextRow.lbs === 0 ? 0 : 1)
          : Math.abs(nextRow.lbs - oldRow.lbs) / Math.abs(oldRow.lbs);
        changes.push({
          kind: "quantity-changed",
          entity: label,
          before: `${oldRow.ingredient}: ${fmtLbs(oldRow.lbs)} lbs`,
          after: `${nextRow.ingredient}: ${fmtLbs(nextRow.lbs)} lbs`,
          requiresConfirmation: relativeChange >= 0.25,
          message: `Changes "${oldRow.ingredient}" in ${label} from ${fmtLbs(oldRow.lbs)} to ${fmtLbs(nextRow.lbs)} lbs.`,
        });
      }
    }
    for (const [key, newRow] of after) {
      if (before.has(key)) continue;
      changes.push({
        kind: "added",
        entity: label,
        after: `${newRow.ingredient}: ${fmtLbs(newRow.lbs)} lbs`,
        message: `Adds "${newRow.ingredient}" to ${label}.`,
      });
    }
  }

  for (const profile of input.removedProfiles ?? []) {
    const name = `${profile.brand} ${profile.flavor}`.trim();
    if (!name) continue;
    changes.push({
      kind: "removed",
      entity: `profile "${name}"`,
      requiresConfirmation: true,
      message: `Removes profile "${name}" because it is no longer in the workbook.`,
    });
  }

  for (const collapse of input.familyCollapses ?? []) {
    if (!collapse.family || !collapse.variant || collapse.family === collapse.variant) continue;
    changes.push({
      kind: "family-collapsed",
      entity: `dough family "${collapse.family}"`,
      before: collapse.variant,
      after: collapse.family,
      message: `Stores variant "${collapse.variant}" under dough family "${collapse.family}".`,
    });
  }

  for (const missing of input.missingVariants ?? []) {
    if (!missing.family || !missing.variant) continue;
    changes.push({
      kind: "variant-loss",
      entity: `dough family "${missing.family}"`,
      before: missing.variant,
      requiresConfirmation: true,
      message: `The prior variant "${missing.variant}" is not present for dough family "${missing.family}".`,
    });
  }

  const mappingTargets = new Map<string, Set<string>>();
  for (const mapping of input.customerMappings ?? []) {
    const brand = mapping.brand.trim();
    if (!brand) continue;
    const qualifier = (mapping.qualifier ?? "").trim() || "base";
    const flavors = mapping.flavors.length ? mapping.flavors : [""];
    for (const flavor of flavors) {
      const normalizedFlavor = flavor.trim();
      const mappingKey = `${brand.toLowerCase()}\u0000${normalizedFlavor.toLowerCase()}`;
      const qualifiers = mappingTargets.get(mappingKey) ?? new Set<string>();
      qualifiers.add(qualifier);
      mappingTargets.set(mappingKey, qualifiers);
      const broad = !normalizedFlavor;
      changes.push({
        kind: "customer-remapped",
        entity: `customer "${brand}${normalizedFlavor ? ` · ${normalizedFlavor}` : " · all flavors"}"`,
        after: qualifier,
        requiresConfirmation: broad,
        message: broad
          ? `Maps every flavor of "${brand}" to the ${qualifier} dough variant.`
          : `Maps "${brand} · ${normalizedFlavor}" to the ${qualifier} dough variant.`,
      });
    }
  }
  for (const [key, qualifiers] of mappingTargets) {
    if (qualifiers.size < 2) continue;
    const [brand, flavor] = key.split("\u0000");
    changes.push({
      kind: "customer-remapped",
      entity: `customer "${brand}${flavor ? ` · ${flavor}` : " · all flavors"}"`,
      after: [...qualifiers].join(", "),
      requiresConfirmation: true,
      message: `Customer "${brand}${flavor ? ` · ${flavor}` : " · all flavors"}" maps to multiple dough variants and is ambiguous.`,
    });
  }

  const counts = {
    added: 0,
    removed: 0,
    "quantity-changed": 0,
    "formula-cleared": 0,
    "family-collapsed": 0,
    "variant-loss": 0,
    "customer-remapped": 0,
  } satisfies Record<ImportReviewChangeKind, number>;
  for (const change of changes) counts[change.kind] += 1;

  const destructiveCount =
    counts.removed + counts["quantity-changed"] + counts["formula-cleared"] + counts["variant-loss"];
  const threshold = input.largeChangeThreshold ?? 8;
  const explicit = changes.filter((change) => change.requiresConfirmation);
  const reasons = explicit.map((change) => change.message);
  if (destructiveCount >= threshold && !reasons.some((reason) => reason.startsWith("This import changes"))) {
    reasons.push(`This import changes ${destructiveCount} existing formula rows or profiles.`);
  }
  return {
    changes,
    counts,
    requiresExplicitConfirmation: explicit.length > 0 || destructiveCount >= threshold,
    confirmationReasons: reasons,
  };
}

/**
 * Normalize a loosely-typed recipe list (e.g. a saved spec sheet's `recipes`,
 * which carries extra fields) into the minimal ReconcileRecipe shape. Drops
 * malformed entries; never throws. Shared so server and clients normalize the
 * same way.
 */
export function toReconcileRecipes(raw: unknown): ReconcileRecipe[] {
  if (!Array.isArray(raw)) return [];
  const out: ReconcileRecipe[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    const kind = String(o.kind ?? "").trim().toLowerCase();
    if (!KINDS.has(kind)) continue;
    const name = String(o.name ?? "").trim();
    if (!name) continue;
    const rawRows = Array.isArray(o.rows) ? o.rows : [];
    const rows: ReconcileRow[] = [];
    for (const row of rawRows) {
      if (!row || typeof row !== "object") continue;
      const ro = row as Record<string, unknown>;
      const ingredient = String(ro.ingredient ?? "").trim();
      if (!ingredient) continue;
      const lbs = Number(ro.lbs);
      rows.push({ ingredient, lbs: Number.isFinite(lbs) ? lbs : 0 });
    }
    out.push({ kind: kind as ReconcileKind, name, rows });
  }
  return out;
}

/**
 * Cross-reference the saved spec sheet's recipes against the current recipe
 * library and return every discrepancy. Only recipes that appear ON the spec
 * sheet are checked (a current recipe with no spec-sheet counterpart is simply
 * "not on this spec sheet", not a discrepancy). Deterministic and pure.
 */
export function reconcileSpecWithRecipes(input: SpecReconcileInput): Discrepancy[] {
  const tol = input.lbsTolerance != null && input.lbsTolerance >= 0 ? input.lbsTolerance : 0.001;
  const out: Discrepancy[] = [];

  const currentByKey = new Map<string, ReconcileRecipe>();
  for (const r of input.currentRecipes) currentByKey.set(recipeKey(r.kind, r.name), r);

  for (const spec of input.specRecipes) {
    const name = spec.name.trim();
    const current = currentByKey.get(recipeKey(spec.kind, spec.name));
    if (!current) {
      out.push({
        kind: spec.kind,
        recipeName: name,
        type: "missing-recipe",
        message: `The ${spec.kind} recipe "${name}" is on the spec sheet but isn't in your current recipes.`,
      });
      continue;
    }

    const specRows = aggregateRows(spec.rows);
    const curRows = aggregateRows(current.rows);

    for (const [key, s] of specRows) {
      const c = curRows.get(key);
      if (!c) {
        out.push({
          kind: spec.kind,
          recipeName: name,
          type: "missing-ingredient",
          ingredient: s.ingredient,
          specLbs: s.lbs,
          message: `"${name}" is missing "${s.ingredient}" — the spec sheet calls for ${fmtLbs(s.lbs)} lbs.`,
        });
      } else if (Math.abs(c.lbs - s.lbs) > tol) {
        out.push({
          kind: spec.kind,
          recipeName: name,
          type: "amount-mismatch",
          ingredient: s.ingredient,
          specLbs: s.lbs,
          currentLbs: c.lbs,
          message: `"${name}" — "${s.ingredient}" is ${fmtLbs(c.lbs)} lbs but the spec sheet calls for ${fmtLbs(s.lbs)} lbs.`,
        });
      }
    }

    for (const [key, c] of curRows) {
      if (!specRows.has(key)) {
        out.push({
          kind: spec.kind,
          recipeName: name,
          type: "extra-ingredient",
          ingredient: c.ingredient,
          currentLbs: c.lbs,
          message: `"${name}" has "${c.ingredient}" (${fmtLbs(c.lbs)} lbs) that isn't on the spec sheet.`,
        });
      }
    }
  }

  return out;
}

/**
 * Compact one-line-per-discrepancy text block for grounding an AI summary. Pure;
 * bounded by the caller. Returns "" when there are no discrepancies.
 */
export function formatDiscrepanciesForPrompt(discrepancies: ReadonlyArray<Discrepancy>): string {
  return discrepancies.map((d) => `- [${d.kind}] ${d.message}`).join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// Profile reconcile — cross-reference the spec sheet's brand+flavor PROFILE specs
// (die type, sauce oz/pizza, applicator types & oz per slot, pepperoni types /
// sticks / oz per slot) against the current profile library. This is the "include
// all things" layer on top of the recipe reconcile above: recipes cover the
// dough/sauce/cheese ingredient lists, profiles cover the run-setup spec numbers.
//
// Applicators and pepperonis are compared BY SLOT (position), because that is how
// the apps store them (app1..app4, pep1..pep2) and how a spec sheet is imported —
// the Nth applicator on the sheet becomes applicator slot N. Only slots the spec
// sheet actually fills are checked; a current profile carrying extra applicators
// the sheet doesn't mention is not a discrepancy. Pure and deterministic.
// ─────────────────────────────────────────────────────────────────────────────

export type ReconcileApplicator = { type: string; ozPerPizza: number };
export type ReconcilePepperoni = { type: string; sticks: number; ozPerPizza: number };

export type ReconcileProfile = {
  brand: string;
  flavor: string;
  dieType?: string;
  sauceOzPerPizza?: number;
  /** Applicator slots in order (index 0 === applicator 1). */
  applicators: ReconcileApplicator[];
  /** Pepperoni slots in order (index 0 === pepperoni 1). */
  pepperonis: ReconcilePepperoni[];
};

export type ProfileDiscrepancyType =
  // The spec sheet defines this brand+flavor profile but the current library has none.
  | "missing-profile"
  // The die type differs from the spec sheet.
  | "die-mismatch"
  // The sauce oz/pizza differs from the spec sheet beyond tolerance.
  | "sauce-mismatch"
  // An applicator slot's type differs (or is missing) from the spec sheet.
  | "applicator-type-mismatch"
  // An applicator slot's oz/pizza differs from the spec sheet beyond tolerance.
  | "applicator-amount-mismatch"
  // A pepperoni slot's type differs (or is missing) from the spec sheet.
  | "pepperoni-type-mismatch"
  // A pepperoni slot's sticks or oz/pizza differ from the spec sheet beyond tolerance.
  | "pepperoni-amount-mismatch";

export type ProfileDiscrepancy = {
  brand: string;
  flavor: string;
  type: ProfileDiscrepancyType;
  /** Human field label, e.g. "die type", "sauce oz/pizza", "applicator 2". */
  field?: string;
  /** What the spec sheet calls for (display string). */
  specValue?: string;
  /** What the current profile has (display string). */
  currentValue?: string;
  /** Plain-language, app-consistent description of the discrepancy. */
  message: string;
};

export type SpecProfileReconcileInput = {
  /** Profiles from the saved spec sheet. */
  specProfiles: ReconcileProfile[];
  /** Profiles currently in the app's library. */
  currentProfiles: ReconcileProfile[];
  /**
   * Absolute oz/stick difference at or below which a number is treated as a
   * match. Defaults to 0.001 so floating-point noise never registers.
   */
  numericTolerance?: number;
};

function profileKey(brand: string, flavor: string): string {
  return `${brand.trim().toLowerCase()}\u0000${flavor.trim().toLowerCase()}`;
}

function sameName(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * Normalize a loosely-typed profile list (e.g. a saved spec sheet's `profiles`,
 * which carries extra fields) into the minimal ReconcileProfile shape. Drops
 * malformed entries and blank-named applicator/pepperoni slots; never throws.
 * Shared so server and clients normalize the same way.
 */
export function toReconcileProfiles(raw: unknown): ReconcileProfile[] {
  if (!Array.isArray(raw)) return [];
  const out: ReconcileProfile[] = [];
  for (const p of raw) {
    if (!p || typeof p !== "object") continue;
    const o = p as Record<string, unknown>;
    const brand = String(o.brand ?? "").trim();
    const flavor = String(o.flavor ?? "").trim();
    if (!brand || !flavor) continue;

    const applicators: ReconcileApplicator[] = [];
    const rawApps = Array.isArray(o.applicators) ? o.applicators : [];
    for (const a of rawApps) {
      if (!a || typeof a !== "object") continue;
      const ao = a as Record<string, unknown>;
      const type = String(ao.type ?? "").trim();
      const oz = Number(ao.ozPerPizza);
      applicators.push({ type, ozPerPizza: Number.isFinite(oz) ? oz : 0 });
    }

    const pepperonis: ReconcilePepperoni[] = [];
    const rawPeps = Array.isArray(o.pepperonis) ? o.pepperonis : [];
    for (const pp of rawPeps) {
      if (!pp || typeof pp !== "object") continue;
      const po = pp as Record<string, unknown>;
      const type = String(po.type ?? "").trim();
      const sticks = Number(po.sticks);
      const oz = Number(po.ozPerPizza);
      pepperonis.push({
        type,
        sticks: Number.isFinite(sticks) ? sticks : 0,
        ozPerPizza: Number.isFinite(oz) ? oz : 0,
      });
    }

    const profile: ReconcileProfile = { brand, flavor, applicators, pepperonis };
    const die = String(o.dieType ?? "").trim();
    if (die) profile.dieType = die;
    const sauce = Number(o.sauceOzPerPizza);
    if (o.sauceOzPerPizza != null && Number.isFinite(sauce)) profile.sauceOzPerPizza = sauce;
    out.push(profile);
  }
  return out;
}

/**
 * Cross-reference the saved spec sheet's profiles against the current profile
 * library and return every discrepancy. Only profiles that appear ON the spec
 * sheet are checked; only the specific spec-sheet fields that are set are
 * compared (a blank spec field is "not specified", not a discrepancy).
 * Deterministic and pure.
 */
export function reconcileSpecProfiles(input: SpecProfileReconcileInput): ProfileDiscrepancy[] {
  const tol =
    input.numericTolerance != null && input.numericTolerance >= 0 ? input.numericTolerance : 0.001;
  const out: ProfileDiscrepancy[] = [];

  const currentByKey = new Map<string, ReconcileProfile>();
  for (const p of input.currentProfiles) currentByKey.set(profileKey(p.brand, p.flavor), p);

  for (const spec of input.specProfiles) {
    const who = `${spec.brand} ${spec.flavor}`.trim();
    const current = currentByKey.get(profileKey(spec.brand, spec.flavor));
    if (!current) {
      out.push({
        brand: spec.brand,
        flavor: spec.flavor,
        type: "missing-profile",
        message: `The profile "${who}" is on the spec sheet but isn't set up in your current profiles.`,
      });
      continue;
    }

    // Die type (string, case-insensitive) — only when the sheet specifies one.
    const specDie = (spec.dieType ?? "").trim();
    if (specDie) {
      const curDie = (current.dieType ?? "").trim();
      if (!sameName(specDie, curDie)) {
        out.push({
          brand: spec.brand,
          flavor: spec.flavor,
          type: "die-mismatch",
          field: "die type",
          specValue: specDie,
          currentValue: curDie || "(none)",
          message: `"${who}" die type is ${curDie ? `"${curDie}"` : "not set"} but the spec sheet calls for "${specDie}".`,
        });
      }
    }

    // Sauce oz/pizza (numeric) — only when the sheet specifies one.
    if (spec.sauceOzPerPizza != null) {
      const curSauce = current.sauceOzPerPizza ?? 0;
      if (Math.abs(curSauce - spec.sauceOzPerPizza) > tol) {
        out.push({
          brand: spec.brand,
          flavor: spec.flavor,
          type: "sauce-mismatch",
          field: "sauce oz/pizza",
          specValue: fmtLbs(spec.sauceOzPerPizza),
          currentValue: fmtLbs(curSauce),
          message: `"${who}" sauce is ${fmtLbs(curSauce)} oz/pizza but the spec sheet calls for ${fmtLbs(spec.sauceOzPerPizza)} oz/pizza.`,
        });
      }
    }

    // Applicators — compared by slot; only slots the sheet fills (non-blank type).
    spec.applicators.forEach((sa, i) => {
      const specType = (sa.type ?? "").trim();
      if (!specType) return;
      const slot = i + 1;
      const ca = current.applicators[i];
      const curType = (ca?.type ?? "").trim();
      if (!sameName(specType, curType)) {
        out.push({
          brand: spec.brand,
          flavor: spec.flavor,
          type: "applicator-type-mismatch",
          field: `applicator ${slot}`,
          specValue: specType,
          currentValue: curType || "(none)",
          message: `"${who}" applicator ${slot} is ${curType ? `"${curType}"` : "not set"} but the spec sheet calls for "${specType}".`,
        });
        return;
      }
      const curOz = ca?.ozPerPizza ?? 0;
      if (Math.abs(curOz - sa.ozPerPizza) > tol) {
        out.push({
          brand: spec.brand,
          flavor: spec.flavor,
          type: "applicator-amount-mismatch",
          field: `applicator ${slot} (${specType})`,
          specValue: fmtLbs(sa.ozPerPizza),
          currentValue: fmtLbs(curOz),
          message: `"${who}" applicator ${slot} "${specType}" is ${fmtLbs(curOz)} oz/pizza but the spec sheet calls for ${fmtLbs(sa.ozPerPizza)} oz/pizza.`,
        });
      }
    });

    // Pepperonis — compared by slot; only slots the sheet fills (non-blank type).
    spec.pepperonis.forEach((sp, i) => {
      const specType = (sp.type ?? "").trim();
      if (!specType) return;
      const slot = i + 1;
      const cp = current.pepperonis[i];
      const curType = (cp?.type ?? "").trim();
      if (!sameName(specType, curType)) {
        out.push({
          brand: spec.brand,
          flavor: spec.flavor,
          type: "pepperoni-type-mismatch",
          field: `pepperoni ${slot}`,
          specValue: specType,
          currentValue: curType || "(none)",
          message: `"${who}" pepperoni ${slot} is ${curType ? `"${curType}"` : "not set"} but the spec sheet calls for "${specType}".`,
        });
        return;
      }
      const curSticks = cp?.sticks ?? 0;
      const curOz = cp?.ozPerPizza ?? 0;
      const stickDiff = Math.abs(curSticks - sp.sticks) > tol;
      const ozDiff = Math.abs(curOz - sp.ozPerPizza) > tol;
      if (stickDiff || ozDiff) {
        const parts: string[] = [];
        if (stickDiff) parts.push(`${fmtLbs(curSticks)} sticks (spec ${fmtLbs(sp.sticks)})`);
        if (ozDiff) parts.push(`${fmtLbs(curOz)} oz/pizza (spec ${fmtLbs(sp.ozPerPizza)})`);
        out.push({
          brand: spec.brand,
          flavor: spec.flavor,
          type: "pepperoni-amount-mismatch",
          field: `pepperoni ${slot} (${specType})`,
          message: `"${who}" pepperoni ${slot} "${specType}" has ${parts.join(" and ")} — doesn't match the spec sheet.`,
        });
      }
    });
  }

  return out;
}

/**
 * Compact one-line-per-discrepancy text block for grounding an AI summary with
 * profile discrepancies. Pure; bounded by the caller. Returns "" when empty.
 */
export function formatProfileDiscrepanciesForPrompt(
  discrepancies: ReadonlyArray<ProfileDiscrepancy>,
): string {
  return discrepancies.map((d) => `- [profile] ${d.message}`).join("\n");
}
