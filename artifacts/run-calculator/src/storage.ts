import {
  DEFAULT_VALUES,
  MACHINE_TIME_DEFAULTS,
  CRUST_FIELDS,
  PROGRESS_FIELDS,
  RUN_KEY,
  PROFILE_KEY,
  CRUST_PROFILE_KEY,
  DAY_KEY,
  HISTORY_KEY,
  TEMPLATES_KEY,
  BRAND_FLAVORS_KEY,
  BRANDS_KEY,
  FLAVORS_KEY,
  DOUGH_RECIPE_PRESETS_KEY,
  DOUGH_RECIPE_NAMES_KEY,
  DEFAULT_DOUGH_RECIPE_NAMES,
  DOUGH_INGREDIENTS_KEY,
  DEFAULT_DOUGH_INGREDIENTS,
  FRONTLINE_RECIPE_PRESETS_KEY,
  FRONTLINE_RECIPE_NAMES_KEY,
  DEFAULT_FRONTLINE_RECIPE_NAMES,
  FRONTLINE_INGREDIENTS_KEY,
  DEFAULT_FRONTLINE_INGREDIENTS,
  MIX_INGREDIENTS_KEY,
  DEFAULT_MIX_INGREDIENTS,
  CHEESE_RECIPE_PRESETS_KEY,
  CHEESE_RECIPE_NAMES_KEY,
  MIX_RECIPE_NAMES_KEY,
  INGREDIENT_TYPES_KEY,
  DEFAULT_INGREDIENT_TYPES,
  MERGED_AWAY_KEY,
  DELETED_ITEMS_KEY,
  DELETED_STAMPS_KEY,
  UNDELETED_STAMPS_KEY,
  PEP_TYPES_KEY,
  DEFAULT_PEP_TYPES,
  PEP_TYPE_RENAMES,
  INGREDIENT_RENAMES,
  DIE_TYPE_RENAMES,
  canonicalDieTypeName,
  RETIRED_PEP_TYPES,
  CHEESE_INGREDIENTS_KEY,
  DEFAULT_CHEESE_INGREDIENTS,
  DIE_TYPES_KEY,
  DEFAULT_DIE_TYPES,
  MAX_HISTORY_DAYS,
  CHANGE_HISTORY_KEY,
  MAX_CHANGE_HISTORY,
  type MasterDataChange,
  type MasterDataChangeType,
  type FormValues,
  type DayState,
  type RunMeta,
  type HistoryDay,
  type RunTemplate,
  type DoughRecipePreset,
  type RecipeRow,
  type CrustField,
} from "./types";
import { resolveDieLineDefaults, type DieLineDefaultsOverrides } from "./dieDefaults";
import { MIX_SEED } from "./mixSeed";
import {
  canonicalProfileKey,
  markProfileEdited,
  markProfileDeleted,
} from "./profileServerSync";
import {
  type MergeMap,
  mergeList as mergeListNames,
  mergeSettingsObject,
  mergeRecipePresetMap,
} from "./mergeIngredients";
import {
  type RecipeNameMergeCategory,
  RECIPE_NAME_FIELDS_BY_CATEGORY,
  mergeRecipeNameSettingsObject,
  foldPresetKeys,
  isStrayMixName,
  buildPoolLookup,
  healApplicatorSlotValues,
} from "./mergeRecipeNames";
import { genId, todayStr } from "./utils";
import {
  hydrateRecipeRows as hydrateRecipeRowsCatalog,
  buildIngredientIndex,
  type Ingredient,
  type IngredientCategory,
} from "@workspace/ingredient-catalog";
import {
  fetchIngredients,
  saveIngredients as saveIngredientsRemote,
  findOrBuildIngredient,
} from "./ingredients";
import { mirrorSingleCheeseAcrossApplicators, assignApplicatorSlots, resolveCheeseApplicatorSlots, resolveMixApplicatorSlots, specImportNameMatchKey, specImportBrandMatchKey, specImportNamedRecipeNamesEqual, findSpecImportNamedRecipeFamilyMatch, cleanSpecCheeseRecipeName } from "@workspace/spec-import";
import { matchDoughballVariant, normalizeDoughballVariants } from "@workspace/named-recipes";
import type {
  ParsedSpecImport,
  ParsedRecipe,
  SpecImportAlias,
} from "@workspace/spec-import";
import {
  PROFILE_CLEANUP_MARKER,
  PROFILE_REBUILD_OVERLAYS,
  PROFILE_REBUILD_DOUGHBALL_OZ,
  splitProfileKey,
  planProfileCleanup,
  brandsToRemoveAfterDeletes,
} from "@workspace/profile-cleanup";

export function loadList(key: string, fallback: string[]): string[] {
  try {
    const raw = localStorage.getItem(key);
    if (raw) return JSON.parse(raw) as string[];
  } catch {}
  return fallback;
}

// ── Factory KV write-through hook ────────────────────────────────────────────
// Registered by home.tsx once on mount.  Every save function below calls
// notifyKv() so migrated factory keys are automatically synced to the server
// without touching individual call sites.
type KvMutation = { key: string; value: unknown };
let _kvMutationHook: ((m: KvMutation) => void) | null = null;
export function setKvMutationHook(fn: (m: KvMutation) => void): void {
  _kvMutationHook = fn;
}
function notifyKv(key: string, value: unknown): void {
  _kvMutationHook?.({ key, value });
}

export function saveList(key: string, list: string[]): void {
  try { localStorage.setItem(key, JSON.stringify(list)); } catch {}
  notifyKv(key, list);
}

// ── Merge tombstones ────────────────────────────────────────────────────────
// Names that an ingredient merge removed. Persisted + synced so the additive
// list-union in live-sync can't resurrect a merged-away name from a stale peer.
export function loadMergedAway(): string[] {
  return loadList(MERGED_AWAY_KEY, []);
}
export function saveMergedAway(list: string[]): void {
  saveList(MERGED_AWAY_KEY, [...new Set(list)]);
}
/** Drop names in the tombstone set (case-insensitive) from a list. */
export function dropMergedAway(list: string[], tomb: Set<string>): string[] {
  if (tomb.size === 0) return list;
  return list.filter((n) => !tomb.has(n.trim().toLowerCase()));
}
/** Remove a name from the tombstone so it can be re-added/resurrected later. */
export function clearMergedAway(name: string): void {
  const v = name.trim().toLowerCase();
  if (!v) return;
  const next = loadMergedAway().filter((n) => n.trim().toLowerCase() !== v);
  saveMergedAway(next);
}

// ── Per-list deletion tombstones ────────────────────────────────────────────
// A user-deleted master-list item removed locally would be resurrected by the
// additive list-union in live-sync from a stale peer. Record the deletion under
// the list's namespace so the union can strip it. Namespaced (unlike the flat
// mergedAway set) so deleting a flavor "Pepperoni" never strips a pep-type of the
// same name. Flavor namespace is `flavor:<brandLower>`.
export function flavorNamespace(brand: string): string {
  return `flavor:${brand.trim().toLowerCase()}`;
}
export function loadDeletedItems(): Record<string, string[]> {
  try {
    const raw = localStorage.getItem(DELETED_ITEMS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Record<string, string[]>;
      if (parsed && typeof parsed === "object") return parsed;
    }
  } catch {}
  return {};
}
export function saveDeletedItems(map: Record<string, string[]>): void {
  try { localStorage.setItem(DELETED_ITEMS_KEY, JSON.stringify(map)); } catch {}
  notifyKv(DELETED_ITEMS_KEY, map);
}
// ── Delete/un-delete stamps (namespace → lowercased name → epoch ms) ────────
// The deletedItems tombstones sync via a pure union, so a deliberate RE-ADD of
// a once-deleted name (e.g. a spec import registering a flavor) used to be
// resurrected as "deleted" by the very next sync pull. These stamp maps sync
// alongside the tombstones (merged per-name by MAX) and arbitrate: a name is
// only effectively deleted when its delete stamp (legacy tombstones count 0)
// is >= its un-delete stamp. A later re-delete stamps newer and wins again.
type StampMap = Record<string, Record<string, number>>;
function loadStampMap(key: string): StampMap {
  try {
    const raw = localStorage.getItem(key);
    if (raw) {
      const parsed = JSON.parse(raw) as StampMap;
      if (parsed && typeof parsed === "object") return parsed;
    }
  } catch {}
  return {};
}
export function loadDeletedStamps(): StampMap { return loadStampMap(DELETED_STAMPS_KEY); }
export function loadUndeletedStamps(): StampMap { return loadStampMap(UNDELETED_STAMPS_KEY); }
export function saveDeletedStamps(map: StampMap): void {
  try { localStorage.setItem(DELETED_STAMPS_KEY, JSON.stringify(map)); } catch {}
  notifyKv(DELETED_STAMPS_KEY, map);
}
export function saveUndeletedStamps(map: StampMap): void {
  try { localStorage.setItem(UNDELETED_STAMPS_KEY, JSON.stringify(map)); } catch {}
  notifyKv(UNDELETED_STAMPS_KEY, map);
}
function setStamp(key: string, namespace: string, nameLower: string, ts: number): void {
  const map = loadStampMap(key);
  const ns = map[namespace] ?? {};
  if ((ns[nameLower] ?? 0) >= ts) return;
  ns[nameLower] = ts;
  map[namespace] = ns;
  try { localStorage.setItem(key, JSON.stringify(map)); } catch {}
}
/** Per-name MAX merge of two stamp maps (sync push + receive). */
export function mergeStampMaps(a: StampMap, b: StampMap | undefined): StampMap {
  const out: StampMap = {};
  for (const [ns, names] of Object.entries(a)) out[ns] = { ...names };
  if (b && typeof b === "object") {
    for (const [ns, names] of Object.entries(b)) {
      if (!names || typeof names !== "object") continue;
      const cur = out[ns] ?? {};
      for (const [n, ts] of Object.entries(names)) {
        if (typeof ts !== "number") continue;
        if ((cur[n] ?? 0) < ts) cur[n] = ts;
      }
      out[ns] = cur;
    }
  }
  return out;
}
/** True when `nameLower`'s un-delete stamp beats its delete stamp. */
function undeleteWins(namespace: string, nameLower: string, del: StampMap, undel: StampMap): boolean {
  const u = undel[namespace]?.[nameLower] ?? 0;
  if (u <= 0) return false;
  return u > (del[namespace]?.[nameLower] ?? 0);
}
/** Record a deletion of `name` from the list `namespace`. */
export function tombstoneDeleted(namespace: string, name: string): void {
  const v = name.trim().toLowerCase();
  if (!v) return;
  // Stamp even when the tombstone already exists — a re-delete after an
  // un-delete must move the delete stamp forward to win the stamp compare.
  setStamp(DELETED_STAMPS_KEY, namespace, v, Date.now());
  const map = loadDeletedItems();
  const cur = map[namespace] ?? [];
  if (cur.includes(v)) return;
  map[namespace] = [...cur, v];
  saveDeletedItems(map);
}
/** Un-tombstone `name` in `namespace` so a re-add sticks. */
export function clearDeleted(namespace: string, name: string): void {
  const v = name.trim().toLowerCase();
  if (!v) return;
  // Always stamp the un-delete — even when this device holds no local
  // tombstone. The synced tombstone may live only on the server/peers, and
  // without a stamp the next sync union resurrects it and strips the name.
  setStamp(UNDELETED_STAMPS_KEY, namespace, v, Date.now());
  const map = loadDeletedItems();
  const cur = map[namespace];
  if (!cur || !cur.includes(v)) return;
  const next = cur.filter((n) => n !== v);
  if (next.length > 0) map[namespace] = next;
  else delete map[namespace];
  saveDeletedItems(map);
}
/** Union two deletedItems maps (case-insensitive within each namespace). */
export function unionDeletedItems(
  a: Record<string, string[]>,
  b: Record<string, string[]> | undefined,
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [ns, names] of Object.entries(a)) out[ns] = [...new Set(names.map((n) => n.trim().toLowerCase()))];
  if (b) {
    for (const [ns, names] of Object.entries(b)) {
      if (!Array.isArray(names)) continue;
      const set = new Set(out[ns] ?? []);
      for (const n of names) if (typeof n === "string") set.add(n.trim().toLowerCase());
      out[ns] = [...set];
    }
  }
  return out;
}
/**
 * Drop names tombstoned under `namespace` from a list (case-insensitive).
 * A name whose un-delete stamp beats its delete stamp is NOT dropped — a
 * deliberate re-add (spec import, manual re-add) must survive the tombstone
 * union that syncs from peers/server.
 */
/** Single-name variant of dropDeleted: true when `name` is effectively deleted. */
export function isNameDeleted(namespace: string, name: string): boolean {
  const v = name.trim().toLowerCase();
  if (!v) return false;
  const tomb = loadDeletedItems()[namespace];
  if (!tomb || !tomb.includes(v)) return false;
  return !undeleteWins(namespace, v, loadDeletedStamps(), loadUndeletedStamps());
}
export function dropDeleted(list: string[], map: Record<string, string[]>, namespace: string): string[] {
  const tomb = map[namespace];
  if (!tomb || tomb.length === 0) return list;
  const set = new Set(tomb.map((n) => n.trim().toLowerCase()));
  const del = loadDeletedStamps();
  const undel = loadUndeletedStamps();
  return list.filter((n) => {
    const v = n.trim().toLowerCase();
    return !set.has(v) || undeleteWins(namespace, v, del, undel);
  });
}

export function loadBrandFlavors(): Record<string, string[]> {
  try {
    const raw = localStorage.getItem(BRAND_FLAVORS_KEY);
    if (raw) return JSON.parse(raw) as Record<string, string[]>;
    const oldFlavors = loadList(FLAVORS_KEY, []);
    if (oldFlavors.length > 0) {
      const brands = loadList(BRANDS_KEY, []);
      const seeded: Record<string, string[]> = {};
      brands.forEach(b => { seeded[b] = [...oldFlavors]; });
      return seeded;
    }
  } catch {}
  return {};
}

export function saveBrandFlavors(bf: Record<string, string[]>): void {
  try { localStorage.setItem(BRAND_FLAVORS_KEY, JSON.stringify(bf)); } catch {}
  notifyKv(BRAND_FLAVORS_KEY, bf);
}

// Fields that are run-specific and must never carry over via a brand/flavor profile
const PER_RUN_FIELDS: (keyof FormValues)[] = [
  "casesNeeded", "carryOverDone",
  // Temporary this-run-only Setup overrides — never part of a profile
  "tempFreezerTime", "tempCrustsPerCycle", "tempCycleSpeed",
];

// Rename legacy pep-type names ("Pep - Cured"/"Pep - Natural") to the detailed
// standard names on read, so saved profiles/runs keep their pre-made calc behavior
// and never show a stale name. Idempotent and self-healing across sync.
function normalizePepFields<T extends Record<string, unknown>>(o: T): T {
  for (const k of ["pep1Type", "pep2Type", "pep1TypeB", "pep2TypeB"] as const) {
    const val = o[k];
    if (typeof val === "string" && PEP_TYPE_RENAMES[val]) {
      (o as Record<string, unknown>)[k] = PEP_TYPE_RENAMES[val];
    }
  }
  // Fold variant die-type spellings (e.g. "11" / "11" dies" → "11"") so a saved
  // run/profile still matches the single canonical option in the picker.
  const die = o.dieType;
  if (typeof die === "string") {
    const canon = canonicalDieTypeName(die);
    if (canon !== die) (o as Record<string, unknown>).dieType = canon;
  }
  normalizePackagingFields(o);
  normalizeIngredientFields(o);
  return o;
}

// ── One-time machine-time defaults heal ──────────────────────────────────────
// Machine times used to default to 0 ("not measured"); they now default to the
// factory-typical times (MACHINE_TIME_DEFAULTS). Rewrite stored profiles and
// run values ONCE, replacing a 0 with the new default, so existing data picks
// up the defaults. Marker-guarded: after the heal, a 0 the operator types
// deliberately is respected (auto-track falls back to line-speed estimates).
const MACHINE_TIME_HEAL_MARKER = "run-calc-machine-time-defaults-v1";

function foldMachineTimeZeros(o: Record<string, unknown>): boolean {
  let changed = false;
  for (const k of Object.keys(MACHINE_TIME_DEFAULTS) as (keyof typeof MACHINE_TIME_DEFAULTS)[]) {
    const n = Number(o[k]);
    if (!Number.isFinite(n) || n <= 0) {
      o[k] = MACHINE_TIME_DEFAULTS[k];
      changed = true;
    }
  }
  return changed;
}

/** Returns the ids of healed runs so the caller can refresh an open form. */
export function applyMachineTimeDefaultsHealIfNeeded(): string[] {
  const healedRunIds: string[] = [];
  try {
    if (typeof localStorage === "undefined") return healedRunIds;
    if (localStorage.getItem(MACHINE_TIME_HEAL_MARKER)) return healedRunIds;
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      // Machine times live in the main (dough) profile blob and per-run value
      // blobs; crust profiles never carry them.
      if (k && (k.startsWith("run-calc-profile-") || k.startsWith("run-calc-run-"))) keys.push(k);
    }
    for (const k of keys) {
      try {
        const obj = JSON.parse(localStorage.getItem(k) ?? "null") as Record<string, unknown> | null;
        if (!obj || typeof obj !== "object" || Array.isArray(obj)) continue;
        if (foldMachineTimeZeros(obj)) {
          localStorage.setItem(k, JSON.stringify(obj));
          if (k.startsWith("run-calc-run-")) healedRunIds.push(k.slice("run-calc-run-".length));
        }
      } catch {
        // Skip an unreadable blob — never let one bad row block the heal.
      }
    }
    localStorage.setItem(MACHINE_TIME_HEAL_MARKER, "1");
  } catch {
    // localStorage unavailable — retry next boot (marker left unset).
  }
  return healedRunIds;
}

// Migrate the legacy yes/no "Cartoned" toggle to the new "Packaging Type" field:
// yes → cartoned, no → labeled. New values (cartoned/labeled/n-a) pass through.
// Applied on every profile/run/template/history read, so old saved data shows the
// right option and the roll-up gate matches. Idempotent and self-healing.
export function normalizePackagingFields(o: Record<string, unknown>): void {
  const c = o.cartoned;
  if (typeof c === "string") {
    const lc = c.trim().toLowerCase();
    if (lc === "yes") o.cartoned = "cartoned";
    else if (lc === "no") o.cartoned = "labeled";
  }
}

// Resolve the "combine applicators 1 & 2" flag when loading a run/profile that
// was saved before the flag existed. DEFAULT_VALUES.pep1Combined is `true`, so a
// blind merge would wrongly combine a legacy run that already used TWO pep types
// (which must stay split). If the raw record did not explicitly set the flag,
// infer it: a run with a second pep type is NOT combined; a single-pep run is.
// `rawHadFlag` must be computed from the raw record(s) BEFORE the DEFAULT merge.
export function resolvePep1Combined(result: Record<string, unknown>, rawHadFlag: boolean): void {
  if (rawHadFlag) return;
  const pep2 = typeof result.pep2Type === "string" ? result.pep2Type.trim() : "";
  result.pep1Combined = !pep2;
}

const RECIPE_FIELDS = [
  "doughRecipe",
  "app1CheeseRecipe",
  "app2CheeseRecipe",
  "app3CheeseRecipe",
  "app4CheeseRecipe",
  "frontlineRecipe",
] as const;

// Rename near-duplicate applicator (app*Type) and recipe-ingredient names to
// their canonical spelling on read, so saved profiles/runs/templates/history
// stay consistent with the deduped option lists. Idempotent and self-healing.
function normalizeIngredientFields(o: Record<string, unknown>): void {
  for (const k of ["app1Type", "app2Type", "app3Type", "app4Type"] as const) {
    const val = o[k];
    if (typeof val === "string" && INGREDIENT_RENAMES[val]) {
      o[k] = INGREDIENT_RENAMES[val];
    }
  }
  for (const k of RECIPE_FIELDS) {
    const arr = o[k];
    if (!Array.isArray(arr)) continue;
    for (const row of arr) {
      if (row && typeof row === "object") {
        const r = row as Record<string, unknown>;
        if (typeof r.ingredient === "string" && INGREDIENT_RENAMES[r.ingredient]) {
          r.ingredient = INGREDIENT_RENAMES[r.ingredient];
        }
      }
    }
  }
}

export function loadProfile(brand: string, flavor: string): FormValues | null {
  try {
    const raw = localStorage.getItem(PROFILE_KEY(brand, flavor));
    if (!raw) return null;
    const doughVals: Partial<FormValues> = JSON.parse(raw);
    let crustVals: Partial<FormValues> = {};
    try {
      const crustRaw = localStorage.getItem(CRUST_PROFILE_KEY(brand, flavor));
      if (crustRaw) crustVals = JSON.parse(crustRaw);
    } catch {}
    const result = { ...DEFAULT_VALUES, ...doughVals, ...crustVals };
    // Strip per-run fields even if they were saved in an old profile
    PER_RUN_FIELDS.forEach((f) => { (result as Record<string, unknown>)[f] = DEFAULT_VALUES[f]; });
    const rawHadCombined = typeof (doughVals as Record<string, unknown>).pep1Combined === "boolean"
      || typeof (crustVals as Record<string, unknown>).pep1Combined === "boolean";
    resolvePep1Combined(result as unknown as Record<string, unknown>, rawHadCombined);
    const loaded = normalizePepFields(result as unknown as Record<string, unknown>) as unknown as FormValues;
    // Remember what this profile looked like when it was handed to the caller
    // (form load, editor open, …). saveProfile compares against this snapshot:
    // a form that comes back UNCHANGED while the cached profile has since moved
    // on (a newer copy adopted from the server pool) must NOT republish its
    // stale values — that was the recurring loss mode of the old sync-map
    // transport.
    try {
      rememberProfileSnapshot(
        canonicalProfileKey(brand, flavor),
        extractProfileBlobs(loaded),
      );
    } catch {}
    return loaded;
  } catch {}
  return null;
}

/**
 * The RAW stored profile object for brand+flavor (dough + crust merged), WITHOUT
 * the DEFAULT_VALUES overlay loadProfile applies. Returns null when nothing is
 * saved for this brand+flavor. Used by the scheduled-recipe warning to tell a
 * missing profile apart from one that exists but carries no real recipe data.
 */
export function loadRawProfile(brand: string, flavor: string): Record<string, unknown> | null {
  try {
    const raw = localStorage.getItem(PROFILE_KEY(brand, flavor));
    if (!raw) return null;
    const dough = JSON.parse(raw) as Record<string, unknown>;
    let crust: Record<string, unknown> = {};
    try {
      const crustRaw = localStorage.getItem(CRUST_PROFILE_KEY(brand, flavor));
      if (crustRaw) crust = JSON.parse(crustRaw) as Record<string, unknown>;
    } catch {}
    return { ...dough, ...crust };
  } catch {
    return null;
  }
}

/**
 * True when a profile object carries real recipe/applicator data (vs. a blank
 * default form). Used to (a) avoid letting a blank/default form clobber a
 * populated profile, and (b) decide whether a seeded profile may be repaired.
 */
function profileObjHasRealData(p: Record<string, unknown>): boolean {
  const arr = (x: unknown) => Array.isArray(x) && x.length > 0;
  // A dough recipe ALONE does not make a profile "real". Almost every blank/
  // duplicate profile still carries a default dough recipe, so counting dough
  // here let a dough-only form be saved as a permanent brand+flavor profile —
  // which the spec-sheet cleanup (@workspace/profile-cleanup, dough-ignoring)
  // then couldn't recognize as blank, so the empty setups kept reappearing
  // ("ghosts"). Keep the dough exclusion in lockstep with profileHasRecipeData
  // in that lib (the two predicates differ elsewhere, but must agree on dough).
  if (arr(p.frontlineRecipe)) return true;
  for (const k of ["app1CheeseRecipe", "app2CheeseRecipe", "app3CheeseRecipe", "app4CheeseRecipe"]) {
    if (arr(p[k])) return true;
  }
  for (const k of [
    "app1Type", "app2Type", "app3Type", "app4Type",
    "pep1Type", "pep2Type", "dieType",
    "frontlineRecipeName",
  ]) {
    const val = p[k];
    if (typeof val === "string" && val.trim()) return true;
  }
  return false;
}

/**
 * Backfill a run's sauce fields from the CURRENT saved profile when the run
 * carries none. Scheduled/imported runs snapshot the profile at scheduling
 * time — a sauce recipe added to the profile afterward never reached them
 * (applicator fields looked "auto-applied" only because they were present at
 * snapshot time, while the sauce stayed blank). Fills blanks only — never
 * overwrites a sauce the run already has. Mobile parity: its pull-up
 * (applyScheduledDay) spreads the live profile, so it already behaves this way.
 */
export function backfillSauceFromProfile(
  values: FormValues,
  brand: string | undefined,
  flavor: string | undefined,
): FormValues {
  if (!brand) return values;
  const hasName = (values.frontlineRecipeName ?? "").trim() !== "";
  const hasRows = (values.frontlineRecipe ?? []).some(r => Number(r.lbs ?? 0) > 0);
  if (hasName || hasRows) return values;
  const profile = loadProfile(brand, flavor ?? "");
  if (!profile) return values;
  const pName = (profile.frontlineRecipeName ?? "").trim();
  const pRows = (profile.frontlineRecipe ?? []).filter(r => Number(r.lbs ?? 0) > 0);
  if (!pName && pRows.length === 0) return values;
  const out: FormValues = { ...values };
  if (pName) out.frontlineRecipeName = pName;
  if (pRows.length) out.frontlineRecipe = profile.frontlineRecipe;
  if (!(Number(out.sauceOzPerPizza ?? 0) > 0) && Number(profile.sauceOzPerPizza ?? 0) > 0) {
    out.sauceOzPerPizza = profile.sauceOzPerPizza;
  }
  return out;
}

/**
 * Generalized profile backfill for scheduled/imported runs. Scheduled runs
 * snapshot the profile at scheduling time, so anything added to the profile
 * afterwards (a cheese recipe, packaging settings, a die size, …) never
 * reached them — the sauce-only backfill above fixed one instance of a
 * general problem. Now that profiles live in a factory-wide server pool and
 * can change under a schedule at any time, blank-fill EVERY profile-carried
 * field: a field is taken from the profile only when the run still holds the
 * untouched DEFAULT for it (never overwrites data the run already has).
 *
 * Skipped on purpose:
 *   • PER_RUN_FIELDS / PROGRESS_FIELDS — never part of a profile;
 *   • booleans — their default is a meaningful choice, "still default" is
 *     indistinguishable from "deliberately set to the default";
 *   • brand/flavor identity fields (not FormValues fields, but guarded anyway).
 *
 * Runs the sauce backfill first (its blank test is smarter than raw
 * default-equality: an empty-rows sauce array still counts as blank).
 */
export function backfillFromProfile(
  values: FormValues,
  brand: string | undefined,
  flavor: string | undefined,
): FormValues {
  let out = backfillSauceFromProfile(values, brand, flavor);
  if (!brand) return out;
  const profile = loadProfile(brand, flavor ?? "");
  if (!profile) return out;
  const skip = new Set<string>([
    ...PER_RUN_FIELDS,
    ...PROGRESS_FIELDS,
    "brand",
    "flavor",
  ]);
  for (const field of Object.keys(DEFAULT_VALUES) as (keyof FormValues)[]) {
    if (skip.has(field)) continue;
    const def = DEFAULT_VALUES[field];
    if (typeof def === "boolean") continue;
    const prof = profile[field];
    if (prof === undefined) continue;
    let curBlank = false;
    let profBlank = false;
    try {
      const defJson = JSON.stringify(def);
      curBlank = JSON.stringify(out[field]) === defJson;
      profBlank = JSON.stringify(prof) === defJson;
    } catch {
      continue;
    }
    if (!curBlank || profBlank) continue;
    if (out === values) out = { ...values };
    (out as Record<string, unknown>)[field] = prof;
  }
  return out;
}

/** True when the stored profile for brand+flavor has real recipe/applicator data. */
export function profileHasRealData(brand: string, flavor: string): boolean {
  try {
    const raw = localStorage.getItem(PROFILE_KEY(brand, flavor));
    if (!raw) return false;
    return profileObjHasRealData(JSON.parse(raw) as Record<string, unknown>);
  } catch {
    return false;
  }
}

// The exact dough-blob / crust-blob JSON a profile write would persist for
// `values` — the single extraction shared by saveProfile (what it writes) and
// loadProfile (the "as loaded" snapshot), so the two are byte-comparable.
function extractProfileBlobs(values: FormValues): { dough: string; crust: string } {
  const doughVals = { ...values } as Record<string, unknown>;
  CRUST_FIELDS.forEach((f) => delete doughVals[f]);
  PROGRESS_FIELDS.forEach((f) => delete doughVals[f]);
  PER_RUN_FIELDS.forEach((f) => delete doughVals[f]);
  const crustVals: Partial<Record<CrustField, unknown>> = {};
  CRUST_FIELDS.forEach((f) => { crustVals[f] = values[f]; });
  return { dough: JSON.stringify(doughVals), crust: JSON.stringify(crustVals) };
}

// Every distinct blob pair loadProfile has handed out for a key this page load
// (bounded). saveProfile treats a form matching ANY of them as "unchanged since
// some load" — a single latest-only snapshot is not enough, because another
// reader calling loadProfile AFTER a newer server copy was adopted would
// overwrite the snapshot and let the stale open form republish old values.
const SNAPSHOT_HISTORY_CAP = 12;
const loadedProfileSnapshots = new Map<string, { dough: string; crust: string }[]>();

function rememberProfileSnapshot(key: string, snap: { dough: string; crust: string }): void {
  const list = loadedProfileSnapshots.get(key) ?? [];
  if (list.some((s) => s.dough === snap.dough && s.crust === snap.crust)) return;
  list.push(snap);
  if (list.length > SNAPSHOT_HISTORY_CAP) list.shift();
  loadedProfileSnapshots.set(key, list);
}

// Returns true when a change was actually persisted (callers use this to
// decide whether to fan the profile out to pending/scheduled runs).
export function saveProfile(brand: string, flavor: string, values: FormValues): boolean {
  if (!brand && !flavor) return false;
  // Never persist a blank/default form as a brand+flavor profile. A profile only
  // holds recipe/topping/template data; an all-empty form is always the result of
  // an autosave (or run switch / sync reset) firing before the profile has loaded
  // into the form. Writing it would zero out the seeded dough/sauce/cheese/toppings
  // for the selected brand+flavor — and unlike the previous guard, this refuses the
  // write even when the existing profile briefly looks empty (race during heal).
  if (!profileObjHasRealData(values as unknown as Record<string, unknown>)) return false;
  const { dough: rawDough, crust } = extractProfileBlobs(values);
  const key = canonicalProfileKey(brand, flavor);

  // Preserve _subTab: this metadata field is written by saveProfileSubTab (not part
  // of FormValues) and must survive ordinary profile saves. extractProfileBlobs only
  // serialises FormValues fields, so without this step a normal autosave or nav-save
  // would erase _subTab from the blob, removing the cross-tablet sync anchor.
  let dough = rawDough;
  try {
    const existingRaw = localStorage.getItem(PROFILE_KEY(brand, flavor));
    if (existingRaw) {
      const existing = JSON.parse(existingRaw) as Record<string, unknown>;
      const subTab = existing._subTab;
      if (subTab === "dough" || subTab === "crusts") {
        const parsed = JSON.parse(rawDough) as Record<string, unknown>;
        parsed._subTab = subTab;
        dough = JSON.stringify(parsed);
      }
    }
  } catch {}

  // Change detection — profiles are now a factory-wide server pool with
  // per-profile last-write-wins stamps, so an unchanged nav-save must not mint
  // a fresh stamp (it would outrank a genuinely newer edit from another device):
  //   1. identical to the cached blobs → nothing changed, skip entirely;
  //   2. identical to what loadProfile handed out while the CACHE has since
  //      moved on (newer server copy adopted) → the open form is stale, don't
  //      republish it over the fresher data.
  try {
    const storedDough = localStorage.getItem(PROFILE_KEY(brand, flavor));
    const storedCrust = localStorage.getItem(CRUST_PROFILE_KEY(brand, flavor));
    if (storedDough === dough && storedCrust === crust) return false;
    // The stale-form guard only applies while a stored profile EXISTS to
    // protect: if the local copy is gone (deleted, factory reset, fresh
    // device), an incoming save must persist even when it matches an old
    // in-memory snapshot — otherwise the profile silently never re-saves.
    // A form matching ANY blob loadProfile handed out this page load is an
    // unchanged re-save of that load, not a user edit — even when a LATER
    // loadProfile call has since seen a newer (server-adopted) copy.
    const snaps = loadedProfileSnapshots.get(key);
    if (
      storedDough != null &&
      snaps?.some((s) => s.dough === dough && s.crust === crust)
    ) {
      return false;
    }
  } catch {}
  try { localStorage.setItem(PROFILE_KEY(brand, flavor), dough); } catch {}
  try { localStorage.setItem(CRUST_PROFILE_KEY(brand, flavor), crust); } catch {}
  loadedProfileSnapshots.set(key, [{ dough, crust }]);
  markProfileEdited(key);
  return true;
}

/**
 * Persist the line-type preference (dough / crusts) for a brand+flavor pair.
 * Written whenever the user manually switches the Line Type toggle so that
 * future runs for the same identity automatically start in the correct mode.
 *
 * In addition to the fast-access `:subtab` localStorage key, the preference is
 * embedded as `_subTab` inside the dough profile blob so that the existing
 * brand-profiles server-pool sync carries it to every other tablet. Other
 * devices pick it up the next time they reconcile profiles from the server
 * (see profileServerSync.ts → reconcileProfilesFromServer).
 */
export function saveProfileSubTab(
  brand: string,
  flavor: string,
  subTab: "dough" | "crusts",
): void {
  if (!brand && !flavor) return;
  const profileKey = canonicalProfileKey(brand, flavor);
  const subtabStorageKey = profileKey + ":subtab";
  // 1. Fast-access local key for synchronous reads within this session.
  try { localStorage.setItem(subtabStorageKey, subTab); } catch {}
  // 2. Embed in the dough profile blob so the server-pool sync distributes it.
  try {
    const doughKey = PROFILE_KEY(brand, flavor);
    const raw = localStorage.getItem(doughKey);
    const blob: Record<string, unknown> = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    if (blob._subTab !== subTab) {
      blob._subTab = subTab;
      localStorage.setItem(doughKey, JSON.stringify(blob));
      // Trigger a server-pool push so other tablets receive the update.
      markProfileEdited(profileKey);
    }
  } catch {}
}

/**
 * Return the saved Line Type preference for a brand+flavor pair, or null when
 * none has been explicitly recorded (caller defaults to "dough").
 *
 * Checks the fast-access `:subtab` key first; falls back to `_subTab` inside
 * the dough profile blob (populated on devices that reconciled a server update
 * but have not yet toggled the line type locally).
 */
export function loadProfileSubTab(
  brand: string,
  flavor: string,
): "dough" | "crusts" | null {
  const subtabStorageKey = canonicalProfileKey(brand, flavor) + ":subtab";
  try {
    const v = localStorage.getItem(subtabStorageKey);
    if (v === "dough" || v === "crusts") return v;
  } catch { return null; }
  // Fallback: read _subTab from the dough profile blob (set by server reconcile
  // on tablets that haven't toggled locally yet).
  try {
    const raw = localStorage.getItem(PROFILE_KEY(brand, flavor));
    if (raw) {
      const blob = JSON.parse(raw) as Record<string, unknown>;
      const embedded = blob._subTab;
      if (embedded === "dough" || embedded === "crusts") {
        // Seed the fast-access key so subsequent calls don't need to parse.
        try { localStorage.setItem(subtabStorageKey, embedded); } catch {}
        return embedded;
      }
    }
  } catch {}
  return null;
}

/**
 * Merge a few packaging fields into the stored profile for brand+flavor,
 * creating the profile blob when absent. Used by the Shipping & Palletizing
 * Guide importer: it deliberately bypasses saveProfile's "has real data"
 * guard because this is a targeted field merge onto whatever is stored —
 * it can never zero out recipe data (only the provided keys are written).
 * The fields live in the dough profile blob (none are crust fields).
 */
export function applyPackagingPatchToProfile(
  brand: string,
  flavor: string,
  patch: Partial<FormValues>,
): void {
  if (!brand) return;
  const keys = Object.keys(patch) as (keyof FormValues)[];
  if (keys.length === 0) return;
  try {
    let existing: Record<string, unknown> = {};
    try {
      const raw = localStorage.getItem(PROFILE_KEY(brand, flavor));
      if (raw) existing = JSON.parse(raw) as Record<string, unknown>;
    } catch {}
    for (const k of keys) existing[k] = patch[k];
    localStorage.setItem(PROFILE_KEY(brand, flavor), JSON.stringify(existing));
    markProfileEdited(canonicalProfileKey(brand, flavor));
  } catch {}
}

// ─── Unified setup editing ("edit once, updates everywhere") ─────────────────

/**
 * Normalize recipe rows for comparison/promotion: trim ingredient names, drop
 * rows with no ingredient (the blank "+ Add" row), coerce lbs to a finite
 * non-negative number. Mirrors normalizeNamedRecipeComponent so a form row and
 * a pool component compare on equal footing.
 */
export function normalizeRecipeRowsForCompare(
  rows: ReadonlyArray<{ ingredient?: unknown; lbs?: unknown }> | undefined | null,
): { ingredient: string; lbs: number }[] {
  return (rows ?? [])
    .map((r) => {
      const ingredient = typeof r?.ingredient === "string" ? r.ingredient.trim() : "";
      const n = Number(r?.lbs ?? 0);
      return { ingredient, lbs: Number.isFinite(n) ? Math.max(0, n) : 0 };
    })
    .filter((r) => r.ingredient);
}

/**
 * Order-sensitive equality of two recipe-row lists after normalization
 * (case-insensitive ingredient names). Used to decide whether a run form's
 * dough/sauce rows have drifted from the linked shared (server-pool) recipe and
 * whether a pool change actually needs to rewrite anything.
 */
export function recipeRowsEqual(
  a: ReadonlyArray<{ ingredient?: unknown; lbs?: unknown }> | undefined | null,
  b: ReadonlyArray<{ ingredient?: unknown; lbs?: unknown }> | undefined | null,
): boolean {
  const na = normalizeRecipeRowsForCompare(a);
  const nb = normalizeRecipeRowsForCompare(b);
  if (na.length !== nb.length) return false;
  return na.every(
    (r, i) =>
      r.ingredient.toLowerCase() === nb[i].ingredient.toLowerCase() &&
      r.lbs === nb[i].lbs,
  );
}

/**
 * Overlay a freshly saved profile onto the OPEN run form's current values,
 * keeping everything that belongs to the run rather than the profile:
 * PER_RUN_FIELDS (cases needed, temp overrides), PROGRESS_FIELDS (skids/cases/
 * trays/batches progress of a started run) and the brand/flavor identity.
 * Returns `current` unchanged (same reference) when nothing differs, so the
 * caller can cheaply skip the reset/stamp/push dance.
 */
export function mergeProfileIntoOpenForm(
  current: FormValues,
  profile: FormValues,
): FormValues {
  const skip = new Set<string>([
    ...PER_RUN_FIELDS,
    ...PROGRESS_FIELDS,
    "brand",
    "flavor",
  ]);
  let out = current;
  for (const field of Object.keys(DEFAULT_VALUES) as (keyof FormValues)[]) {
    if (skip.has(field)) continue;
    const prof = profile[field];
    if (prof === undefined) continue;
    if (deepEqual(out[field], prof)) continue;
    if (out === current) out = { ...current };
    (out as Record<string, unknown>)[field] = prof;
  }
  return out;
}

/** One changed shared (server-pool) dough/sauce recipe to fan out to profiles. */
export interface NamedRecipePoolPatch {
  name: string;
  rows: { ingredient: string; lbs: number }[];
  /** Dough only: target doughball weight in oz (> 0 = known). */
  doughballWeightOz?: number;
  /** Dough only: doughballs per tray (> 0 = known). */
  doughballsPerTray?: number;
  /**
   * Dough only: normalized variant list carrying customer assignments. Used to
   * resolve the authoritative per-flavor weight when a specific brand+flavor
   * customer entry exists on a variant — this overrides any stored weight
   * (including a wrong value written before customer assignments were imported).
   */
  doughballVariants?: unknown[];
}

/**
 * Search a raw variant list for a specific brand+flavor customer entry and
 * return its weightOz. Returns 0 if no specific match is found. Intentionally
 * avoids importing @workspace/named-recipes so storage.ts stays lightweight.
 */
function findSpecificVariantWeight(
  variants: unknown[] | undefined,
  brand: string,
  flavor: string,
): number {
  if (!Array.isArray(variants) || !brand || !flavor) return 0;
  const b = brand.trim().toLowerCase();
  const f = flavor.trim().toLowerCase();
  if (!b || !f) return 0;
  for (const vr of variants) {
    if (!vr || typeof vr !== "object") continue;
    const v = vr as { weightOz?: unknown; customers?: unknown[] };
    const weightOz = Number(v.weightOz ?? 0);
    if (!(weightOz > 0)) continue;
    const customers = Array.isArray(v.customers) ? v.customers : [];
    for (const cu of customers) {
      if (!cu || typeof cu !== "object") continue;
      const c = cu as { brand?: unknown; flavor?: unknown };
      if (
        String(c.brand ?? "").trim().toLowerCase() === b &&
        String(c.flavor ?? "").trim().toLowerCase() === f
      )
        return weightOz;
    }
  }
  return 0;
}

/**
 * Fan a changed shared dough/sauce recipe out to every SAVED brand+flavor
 * profile that links it by name: profiles whose doughRecipeName /
 * frontlineRecipeName matches (case-insensitive) get their recipe rows — and,
 * for dough, the target doughball weight — rewritten to the new pool version.
 * Targeted field merge onto the stored blob (like applyPackagingPatchToProfile),
 * so it can never blank other profile data and never creates a profile that
 * doesn't exist. Returns the (lowercased) brand+flavor pairs actually rewritten
 * so the caller can reload an affected open form.
 */
export function refreshProfilesFromNamedRecipes(
  kind: "dough" | "sauce",
  changed: ReadonlyArray<NamedRecipePoolPatch>,
  opts?: {
    /**
     * When true, only update profiles whose recipe rows are currently EMPTY —
     * i.e. the name is set but no rows have ever been stored. Profiles that
     * already carry rows are skipped so this is safe to call on every page
     * load without overwriting valid existing data.
     */
    emptyRowsOnly?: boolean;
  },
): { brand: string; flavor: string }[] {
  if (typeof localStorage === "undefined" || changed.length === 0) return [];
  const byName = new Map<string, NamedRecipePoolPatch>();
  for (const c of changed) {
    const key = c.name.trim().toLowerCase();
    if (key) byName.set(key, c);
  }
  if (byName.size === 0) return [];
  const nameField = kind === "dough" ? "doughRecipeName" : "frontlineRecipeName";
  const rowsField = kind === "dough" ? "doughRecipe" : "frontlineRecipe";
  const prefix = "run-calc-profile-";
  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith(prefix)) keys.push(k);
  }
  const touched: { brand: string; flavor: string }[] = [];
  for (const k of keys) {
    try {
      const obj = JSON.parse(localStorage.getItem(k) ?? "null") as
        | Record<string, unknown>
        | null;
      if (!obj || typeof obj !== "object") continue;
      const linked = typeof obj[nameField] === "string" ? (obj[nameField] as string).trim().toLowerCase() : "";
      if (!linked) continue;
      const patch = byName.get(linked);
      if (!patch) continue;
      const curRows = Array.isArray(obj[rowsField])
        ? (obj[rowsField] as { ingredient?: unknown; lbs?: unknown }[])
        : [];
      // emptyRowsOnly: skip profiles that already have rows stored — the full
      // diff path handles them when the pool actually changes.
      if (opts?.emptyRowsOnly && curRows.length > 0) continue;
      const rowsDiffer = !recipeRowsEqual(curRows, patch.rows);

      // Doughball weight is PER-FLAVOR (one family serves many flavors). Two
      // cases:
      //   Specific match: a customer entry on a variant names this exact
      //     brand+flavor → authoritative, overrides any stored value (corrects
      //     weights written before customer assignments were imported).
      //   Generic pool weight: backfill-only — fill a blank profile, never
      //     overwrite a value the operator or a prior import set.
      const rest = k.slice(prefix.length);
      const sep = rest.indexOf("__");
      const profileBrand = sep >= 0 ? rest.slice(0, sep) : rest;
      const profileFlavor = sep >= 0 ? rest.slice(sep + 2) : "";
      const specificWeight =
        kind === "dough"
          ? findSpecificVariantWeight(
              patch.doughballVariants,
              profileBrand,
              profileFlavor,
            )
          : 0;
      const wantWeight = kind === "dough" ? (patch.doughballWeightOz ?? 0) : 0;
      const storedWeight = Number(obj.targetDoughballWeight ?? 0);
      const weightDiffers =
        specificWeight > 0
          ? specificWeight !== storedWeight
          : wantWeight > 0 && !(storedWeight > 0);
      const effectiveWeight = specificWeight > 0 ? specificWeight : wantWeight;

      const wantTray = kind === "dough" ? patch.doughballsPerTray ?? 0 : 0;
      const trayDiffers =
        wantTray > 0 && !(Number(obj.doughballsPerTray ?? 0) > 0);
      if (!rowsDiffer && !weightDiffers && !trayDiffers) continue;
      if (rowsDiffer) obj[rowsField] = patch.rows.map((r) => ({ ...r }));
      if (weightDiffers) obj.targetDoughballWeight = effectiveWeight;
      if (trayDiffers) obj.doughballsPerTray = wantTray;
      localStorage.setItem(k, JSON.stringify(obj));
      markProfileEdited(k.slice(prefix.length));
      touched.push({ brand: profileBrand, flavor: profileFlavor });
    } catch {
      // Skip an unreadable profile — never let one bad row block the fan-out.
    }
  }
  return touched;
}

/**
 * Fan a cheese or mix recipe's rows out to every saved profile whose
 * app1–4 applicator slot is linked to the given recipe name. Mirrors
 * refreshProfilesFromNamedRecipes for the cheese/mix pool (those recipes live
 * in `app{n}CheeseRecipeName` link fields rather than a dedicated name field).
 *
 * Called after a recipe-name merge (applyRecipeNameMerge rewrote the name
 * fields but not the row arrays) and on the one-time boot heal to correct
 * profiles that accumulated stale rows from earlier merges.
 *
 * @param opts.emptyRowsOnly  When true, skip slots that already have rows —
 *   safe for ongoing empty-row healing without overwriting valid data.
 */
export function refreshCheeseOrMixProfileRows(
  targetName: string,
  targetRows: ReadonlyArray<{ ingredient: string; lbs: number }>,
  opts?: { emptyRowsOnly?: boolean },
): void {
  if (typeof localStorage === "undefined" || !targetName.trim() || targetRows.length === 0) return;
  const nameLc = targetName.trim().toLowerCase();
  const prefixes = ["run-calc-profile-", "run-calc-crust-profile-"];
  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && prefixes.some((p) => k.startsWith(p))) keys.push(k);
  }
  for (const k of keys) {
    try {
      const obj = JSON.parse(localStorage.getItem(k) ?? "null") as Record<string, unknown> | null;
      if (!obj || typeof obj !== "object") continue;
      let changed = false;
      for (const slot of [1, 2, 3, 4] as const) {
        const nameField = `app${slot}CheeseRecipeName`;
        const rowsField = `app${slot}CheeseRecipe`;
        const linked =
          typeof obj[nameField] === "string"
            ? (obj[nameField] as string).trim().toLowerCase()
            : "";
        if (linked !== nameLc) continue;
        const curRows = Array.isArray(obj[rowsField])
          ? (obj[rowsField] as { ingredient?: unknown; lbs?: unknown }[])
          : [];
        // "emptyRowsOnly" also heals rows that are all-zero (ingredient names
        // present but every lbs = 0) — these are effectively empty because
        // they carry no useful data and will just be re-imported from the
        // server mix master-data anyway.
        const curRowsAllZero = curRows.every((r) => !(Number(r.lbs) > 0));
        if (opts?.emptyRowsOnly && curRows.length > 0 && !curRowsAllZero) continue;
        if (recipeRowsEqual(curRows, targetRows)) continue;
        obj[rowsField] = targetRows.map((r) => ({ ingredient: r.ingredient, lbs: r.lbs }));
        changed = true;
      }
      if (changed) {
        localStorage.setItem(k, JSON.stringify(obj));
        const profilePrefix = prefixes.find((p) => k.startsWith(p)) ?? prefixes[0];
        markProfileEdited(k.slice(profilePrefix.length));
      }
    } catch {
      // Skip unreadable profiles — never let one bad entry block the fan-out.
    }
  }
}

export function freshDayState(): DayState {
  // The placeholder run is `seeded`: auto-created, not a user action. While it
  // stays pristine it is excluded from sync pushes and dropped on receive once
  // the shared day has real runs (see isPristineSeedRun) — otherwise every
  // fresh device signing in mid-day adds a blank "Unnamed Run" to every peer's
  // list via the additive union.
  return {
    runs: [{ id: genId(), brand: "", flavor: "", seeded: true }],
    currentIndex: 0,
    date: todayStr(),
    substitutions: [],
    substitutionLog: [],
    stagedItems: {},
    prepPhase: { prepStartedAt: null, prepBatchesDough: 0, prepBatchesSauce: 0, prepCarriedOver: false },
  };
}

// True when a run is still the untouched auto-created placeholder: flagged
// `seeded` (freshDayState / daily rollover — never New Run, imports, or
// schedule pull-ups), with blank identity/lifecycle meta AND an all-default
// value. Such a run is local-only: buildSyncPayload skips it and the
// sync-receive union drops it once the shared day has real runs. Any user
// input (brand, notes, Start, a typed value) makes this false and the run
// syncs normally. `value` is whatever would be pushed for the run (live form
// for the current run, stored copy otherwise) so mid-typing is respected.
export function isPristineSeedRun(run: RunMeta): boolean {
  return !!run.seeded && isBlankRemovableRun(run);
}

// True when a run is completely blank — no identity and never started —
// REGARDLESS of the `seeded` flag or stored form values. Used by:
//   • The "remove blank runs" eraser: placeholder runs pushed before the
//     seeded/local-only fix (and runs whose values were contaminated by
//     profile fan-out) are recognised by their identity/lifecycle alone —
//     relying on isAllDefaultRunValue caused contaminated runs (which had
//     full recipe data but no brand/flavor/startedAt) to slip through.
//   • isPristineSeedRun: a seeded run that received recipe data via profile
//     fan-out must still be kept local-only if it was never given an identity.
export function isBlankRemovableRun(run: RunMeta): boolean {
  return (
    !run.brand &&
    !run.flavor &&
    !(run.notes ?? "").trim() &&
    !run.startedAt &&
    !run.endedAt &&
    (run.stoppages ?? []).length === 0
  );
}

export function loadDayState(): DayState {
  try {
    const raw = localStorage.getItem(DAY_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as DayState;
      if (!parsed.date || parsed.date !== todayStr()) return freshDayState();
      const runs = parsed.runs.map((r: any) => ({
        ...r,
        brand: r.brand ?? (r.label ?? ""),
        flavor: r.flavor ?? "",
      }));
      return { ...parsed, runs, date: parsed.date ?? todayStr() };
    }
  } catch {}
  return freshDayState();
}

// True when two run objects carry the same metadata, ignoring the LWW stamp
// itself. Used to decide whether a save actually changed a run's meta.
function runMetaEquals(a: RunMeta, b: RunMeta): boolean {
  const { metaUpdatedAt: _a, ...restA } = a;
  const { metaUpdatedAt: _b, ...restB } = b;
  return deepEqual(restA, restB);
}

// Diff-stamp each run's lifecycle/metadata against the currently STORED copy:
// a run whose meta changed (or is new) gets metaUpdatedAt = now; an unchanged
// run keeps its prior stamp. Centralized here so EVERY local mutation path
// (start/pause/resume/end, stoppages, notes, …) is stamped without touching
// each call site. The sync-receive path passes { stampMeta: false } so runs
// adopted FROM a peer keep the peer's stamp instead of being re-claimed as a
// local edit (which would defeat the newer-stamp-wins merge and start echo wars).
export function saveDayState(ds: DayState, opts?: { stampMeta?: boolean }): void {
  let toSave = ds;
  if (opts?.stampMeta !== false) {
    try {
      const stored = loadDayState();
      const storedById = new Map(stored.runs.map(r => [r.id, r]));
      const now = Date.now();
      let changed = false;
      const runs = ds.runs.map(r => {
        const prev = storedById.get(r.id);
        if (prev && runMetaEquals(r, prev)) {
          // Unchanged meta: keep the strongest stamp either copy carries.
          const keep = Math.max(r.metaUpdatedAt ?? 0, prev.metaUpdatedAt ?? 0);
          if (keep !== (r.metaUpdatedAt ?? 0)) { changed = true; return { ...r, metaUpdatedAt: keep }; }
          return r;
        }
        changed = true;
        return { ...r, metaUpdatedAt: now };
      });
      if (changed) toSave = { ...ds, runs };
    } catch {}
  }
  try { localStorage.setItem(DAY_KEY, JSON.stringify({ ...toSave, date: todayStr() })); } catch {}
}

// Overlay each run's durable metaUpdatedAt (stamped by saveDayState into
// localStorage) onto an in-memory run list before pushing it to /api/sync.
// React state doesn't carry the fresh stamps (mutation sites don't stamp — the
// diff-stamp lives in saveDayState), so the push payload must re-attach them or
// the server/peers could never tell our just-started run is the newer copy.
export function overlayRunMetaStamps(runs: RunMeta[]): RunMeta[] {
  try {
    const stored = loadDayState();
    const storedById = new Map(stored.runs.map(r => [r.id, r]));
    return runs.map(r => {
      const stamp = Math.max(r.metaUpdatedAt ?? 0, storedById.get(r.id)?.metaUpdatedAt ?? 0);
      return stamp > 0 && stamp !== r.metaUpdatedAt ? { ...r, metaUpdatedAt: stamp } : r;
    });
  } catch {
    return runs;
  }
}

export function loadHistory(): HistoryDay[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (raw) {
      const history = JSON.parse(raw) as HistoryDay[];
      for (const day of history) {
        for (const vals of Object.values(day.runValues ?? {})) {
          const o = vals as unknown as Record<string, unknown>;
          resolvePep1Combined(o, typeof o.pep1Combined === "boolean");
          normalizePepFields(o);
        }
      }
      return history;
    }
  } catch {}
  return [];
}

// A history run worth keeping/showing: it has a name (brand or flavor), was
// actually started, or carries notes. Blank "Unnamed Run" placeholders — e.g.
// the auto-seeded run created when someone signs in on an off day to work on
// other things — are noise and are excluded from history.
export function isDisplayableHistoryRun(run: RunMeta): boolean {
  return !!(run.brand || run.flavor || run.startedAt || (run.notes ?? "").trim());
}

// Drop blank/unnamed runs from each archived day, and drop days left with no
// runs at all. Display-side companion to the archive-time filter, so history
// polluted before this change (or by older peers over sync) cleans up too.
export function filterMeaningfulHistory(days: HistoryDay[]): HistoryDay[] {
  return days
    .map(day => ({ ...day, runs: day.runs.filter(isDisplayableHistoryRun) }))
    .filter(day => day.runs.length > 0);
}

export function archiveDayToHistory(ds: DayState, date: string): void {
  try {
    const history = loadHistory().filter(h => h.date !== date);
    // Never archive blank/unnamed placeholder runs; if nothing meaningful ran
    // that day (e.g. an off-day sign-in), don't create a history entry at all.
    const keptRuns = ds.runs.filter(isDisplayableHistoryRun);
    if (keptRuns.length === 0) {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
      return;
    }
    const runValues: Record<string, FormValues> = {};
    for (const run of keptRuns) {
      const raw = localStorage.getItem(RUN_KEY(run.id));
      if (raw) runValues[run.id] = JSON.parse(raw);
    }
    const entry: HistoryDay = { date, runs: keptRuns, runValues };
    const trimmed = [entry, ...history].slice(0, MAX_HISTORY_DAYS);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(trimmed));
  } catch {}
}

export function loadRunValues(id: string): FormValues {
  try {
    const raw = localStorage.getItem(RUN_KEY(id));
    if (raw) {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const result = { ...DEFAULT_VALUES, ...parsed } as unknown as Record<string, unknown>;
      foldMachineTimeZeros(result);
      resolvePep1Combined(result, typeof parsed.pep1Combined === "boolean");
      return normalizePepFields(result) as unknown as FormValues;
    }
  } catch {}
  return DEFAULT_VALUES;
}

export function saveRunValues(id: string, values: FormValues): void {
  try { localStorage.setItem(RUN_KEY(id), JSON.stringify(values)); } catch {}
}

// Per-run monotonic edit timestamps (run id -> ms of last local edit). Synced via
// SyncPayload.runValuesUpdatedAt so the apply path can tell a fresher local edit
// from a stale remote and refuse to clobber it. Bumped only on real local edits.
const RUN_VALUES_UPDATED_KEY = "run-calc-runvalues-updated";
export function loadRunValuesUpdated(): Record<string, number> {
  try {
    const raw = localStorage.getItem(RUN_VALUES_UPDATED_KEY);
    if (raw) return JSON.parse(raw) as Record<string, number>;
  } catch {}
  return {};
}
export function saveRunValuesUpdated(map: Record<string, number>): void {
  try { localStorage.setItem(RUN_VALUES_UPDATED_KEY, JSON.stringify(map)); } catch {}
}
export function markRunValuesUpdated(id: string, ts: number = Date.now()): void {
  const m = loadRunValuesUpdated();
  m[id] = ts;
  saveRunValuesUpdated(m);
}

// Structural deep-equality used by the autosave effect to tell a real user edit
// from a programmatic re-emit of the SAME stored run values. A run switch,
// sync-apply, daily rollover, or post-login load all call form.reset(...) which
// re-fires form.watch() with values that are already persisted; without this we
// would re-stamp markRunValuesUpdated() on a non-edit, defeating the per-run
// lost-update guard and letting a loaded/stale/empty value win the merge and
// clobber a peer's real edit (multi-device "I entered it and it vanished" data
// loss). Mirrors mobile's primed-baseline diffStampRunEdits, which only stamps
// genuine changes. Objects compare key-order-independently; arrays compare by
// index (recipe-row order is meaningful).
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return a === b;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i])) return false;
    return true;
  }
  if (typeof a === "object" && typeof b === "object") {
    const ak = Object.keys(a as object);
    const bk = Object.keys(b as object);
    if (ak.length !== bk.length) return false;
    for (const k of ak) {
      if (!Object.prototype.hasOwnProperty.call(b, k)) return false;
      if (!deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) return false;
    }
    return true;
  }
  return a === b;
}

// Decide which value to PUSH for the CURRENT run when building a sync payload.
// The current run is normally pushed from the live form so an in-progress edit is
// shared immediately, but the form is transiently all-default during mount /
// hydration and right after any programmatic form.reset() (run switch, daily
// rollover, sync-apply) before the run's real values are loaded back in. The
// stamp map (runValuesUpdatedAt) is read independently from localStorage and
// still carries this run's real edit time, so a push firing in that window would
// emit an EMPTY value paired with a REAL stamp — and because the stamps are equal
// the per-run lost-update guard on every peer ACCEPTS it, wiping real data on the
// shared day-state row (the recurring "I entered it, refreshed, it vanished"
// loss). Never let an all-default live form overwrite a populated stored value;
// fall back to the durable localStorage copy. Returns `live` in every other case
// (genuine edit, or a legitimately blank run whose stored value is also default),
// so this only blocks the populated→empty transition.
export function pickCurrentRunPushValue(
  live: FormValues,
  stored: FormValues,
): FormValues {
  return isEmptyOverPopulated(live, stored) ? stored : live;
}

// True when `candidate` is an all-default/empty run value but `fallback` is a
// populated one. This is the single predicate behind ALL the day-state
// data-loss guards: the corruption pairs an empty run value with a REAL edit
// stamp (the form is transiently all-default during mount / after any
// programmatic form.reset() while localStorage still holds the real value AND
// stamp), so the stamp-based lost-update guard would otherwise ACCEPT the empty
// value and wipe real data on the shared sync row. Used on BOTH the push side
// (candidate = live form, fallback = stored) and the RECEIVE side (candidate =
// incoming remote value, fallback = local stored) so an empty value can never
// overwrite a populated one in either direction, regardless of stamp.
export function isEmptyOverPopulated(
  candidate: FormValues,
  fallback: FormValues,
): boolean {
  return isAllDefaultRunValue(candidate) && !isAllDefaultRunValue(fallback);
}

// The pep batch-lbs fields defaulted to 25 before the defaults cleanup zeroed
// them (DEFAULT_VALUES now starts them at 0). Blank runs saved under the old
// defaults are still all-default in spirit — every "is this run value
// untouched?" check must recognize BOTH shapes, or legacy blank runs stop
// being sweepable and legacy blank stored copies start counting as
// "populated" in the empty-over-populated guards.
const LEGACY_PEP_BATCH_FIELDS = [
  "pep1BatchLbs",
  "pep2BatchLbs",
  "pep1BatchLbsB",
  "pep2BatchLbsB",
] as const;

// True when `value` is an all-default run value under EITHER the current
// all-zero defaults or the exact legacy blank signature where ALL FOUR pep
// batch-lbs fields were 25 (the old DEFAULT_VALUES shape). Never treats a
// real edit as default: any other field difference fails the check, and a 25
// in only SOME of the pep fields is treated as a real user-typed weight —
// only the full four-field legacy signature counts as untouched.
export function isAllDefaultRunValue(value: unknown): boolean {
  if (deepEqual(value, DEFAULT_VALUES)) return true;
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const o = { ...(value as Record<string, unknown>) };
  // Machine times used to default to 0; blank runs saved under the old
  // defaults (or with the fields folded either way) are still untouched in
  // spirit. Normalize 0-or-default to the current default before comparing.
  for (const k of Object.keys(MACHINE_TIME_DEFAULTS) as (keyof typeof MACHINE_TIME_DEFAULTS)[]) {
    if (o[k] === 0) o[k] = MACHINE_TIME_DEFAULTS[k];
  }
  if (deepEqual(o, DEFAULT_VALUES)) return true;
  for (const f of LEGACY_PEP_BATCH_FIELDS) {
    if (o[f] !== 25) return false;
  }
  const normalized = { ...o };
  for (const f of LEGACY_PEP_BATCH_FIELDS) normalized[f] = 0;
  return deepEqual(normalized, DEFAULT_VALUES);
}

// A form.reset() re-emits values through form.watch(), so a heal that fires
// while the operator is mid-keystroke could clobber a just-typed edit before
// autosave persists it. Any caller of the heal (and the sync-receive current-run
// reset) must honor this quiet window after the last local edit.
export const RECENT_LOCAL_EDIT_WINDOW_MS = 2000;

// Pure decision behind the current-run form heal effect (home.tsx). On a fresh
// device's FIRST sync-apply right after sign-in, the apply callback's form-reset
// block reads the PRE-apply dayStateRef — whose blank local run id isn't in the
// payload — so it skips the reset, leaving the live form all-default ("0 cases
// needed") while localStorage now holds the real synced values. The server sends
// only ONE initial SSE payload on connect, so nothing later heals it. Heal (i.e.
// reset the form to the stored copy) ONLY when:
//   1. the live form is all-default while the stored copy is populated
//      (isEmptyOverPopulated — the same guard the sync receive path uses, so a
//      genuinely edited or legitimately blank form is never touched), and
//   2. no local edit landed within RECENT_LOCAL_EDIT_WINDOW_MS, so genuine
//      user typing always wins over the heal.
// Healing is one-directional (defaults → stored real data); anything looser
// re-introduces the empty-over-populated clobber class of bugs.
export function shouldHealFormFromStored(
  liveVals: FormValues,
  storedVals: FormValues,
  lastLocalEditAt: number,
  now: number,
): boolean {
  return (
    isEmptyOverPopulated(liveVals, storedVals) &&
    now - lastLocalEditAt > RECENT_LOCAL_EDIT_WINDOW_MS
  );
}

// ── Sync-receive merge-survival helpers ─────────────────────────────────────
// Extracted from the home.tsx sync-receive handler so the recipe-name-merge
// survival guarantees are importable and regression-tested end-to-end (a merge
// followed by a stale incoming sync payload). See recipeMergeSyncReceive.test.ts.

// Per-run lost-update decision for the sync-receive run-values loop. Returns
// true when the incoming remote value should overwrite the local one; false to
// keep local. Keep local when the remote is all-default over a populated local
// (empty-over-populated corruption, regardless of stamp) OR when our local edit
// stamp is strictly newer than the remote's. This is what makes a recipe-name
// merge stick across a stale peer: the merge advances the re-pointed runs' edit
// stamps, so localTs > remoteTs here and the stale pre-merge selection is
// rejected instead of overwriting the merged one.
export function acceptRemoteRunValueOnSync(
  remoteVals: FormValues,
  localVals: FormValues,
  remoteTs: number,
  localTs: number,
): boolean {
  if (isEmptyOverPopulated(remoteVals, localVals)) return false;
  return !(localTs > remoteTs);
}

// Drop recipe-preset keys tombstoned under `namespace` from a preset map. A
// recipe-name merge folds the merged-away name's preset KEY and tombstones it;
// the additive preset union on sync-receive would otherwise resurrect that
// folded-away key from a stale peer. Mirrors the list dropDeleted guard.
export function dropTombstonedPresetKeys<V>(
  obj: Record<string, V>,
  deletedMap: Record<string, string[]>,
  namespace: string,
): Record<string, V> {
  const keptSet = new Set(dropDeleted(Object.keys(obj), deletedMap, namespace));
  const out: Record<string, V> = {};
  for (const [k, v] of Object.entries(obj)) if (keptSet.has(k)) out[k] = v;
  return out;
}

// Return a copy of `deletedMap` where tombstones under `namespace` are removed
// for any name currently alive in `aliveNames` (case-insensitive). Needed for
// the cheese-preset drop on sync-receive: Mix recipe rows share the cheese
// preset map, so a name reclassified Cheese → Mix is tombstoned under
// "cheeseRecipeNames" (to keep it out of the cheese list on every peer) while
// its rows must survive in the shared map as long as the name lives in the mix
// list. Without this filter the receive-side drop would wipe the moved
// recipe's rows on the next sync.
export function dropTombstonesForAliveNames(
  deletedMap: Record<string, string[]>,
  namespace: string,
  aliveNames: string[],
): Record<string, string[]> {
  const tomb = deletedMap[namespace];
  if (!tomb || tomb.length === 0 || aliveNames.length === 0) return deletedMap;
  const alive = new Set(aliveNames.map((n) => n.trim().toLowerCase()));
  const next = tomb.filter((n) => !alive.has(n.trim().toLowerCase()));
  if (next.length === tomb.length) return deletedMap;
  const out = { ...deletedMap };
  if (next.length > 0) out[namespace] = next;
  else delete out[namespace];
  return out;
}

// Whether a brand+flavor profile key (`${brandLc}__${flavorLc}`) is tombstoned
// by a brand/flavor deletion or merge. Brand+flavor profiles are keyed by the
// lowercased brand/flavor combo; on sync-receive they must honor the deletion
// (`deletedMap`) and merge (`tombSet`) tombstones or a stale peer's payload
// resurrects (or seeds) a profile for a brand/flavor the user deleted/merged.
// `deletedMap` uses the "brands" namespace for whole-brand deletes and the
// `flavor:<brandLc>` namespace (see flavorNamespace) for per-flavor deletes;
// `tombSet` is the flat merged-away set (lowercased). Mirrors the inline guard
// in the home.tsx sync-receive handler.
export function profileKeyIsTombstoned(
  key: string,
  deletedMap: Record<string, string[]>,
  tombSet: Set<string>,
): boolean {
  const sep = key.indexOf("__");
  if (sep < 0) return false;
  const brandLc = key.slice(0, sep);
  const flavorLc = key.slice(sep + 2);
  const deletedBrandSet = new Set((deletedMap["brands"] ?? []).map((b) => b.trim().toLowerCase()));
  if (deletedBrandSet.has(brandLc)) return true;
  if ((deletedMap[`flavor:${brandLc}`] ?? []).includes(flavorLc)) return true;
  if (tombSet.has(brandLc) || tombSet.has(flavorLc)) return true;
  return false;
}

export function loadTemplates(): RunTemplate[] {
  try {
    const raw = localStorage.getItem(TEMPLATES_KEY);
    if (raw) {
      const templates = JSON.parse(raw) as RunTemplate[];
      for (const t of templates) {
        if (t.values) normalizePepFields(t.values as unknown as Record<string, unknown>);
      }
      return templates;
    }
  } catch {}
  return [];
}

export function saveTemplates(t: RunTemplate[]): void {
  try { localStorage.setItem(TEMPLATES_KEY, JSON.stringify(t)); } catch {}
}

export function loadDoughRecipePresets(): Record<string, DoughRecipePreset> {
  try { return JSON.parse(localStorage.getItem(DOUGH_RECIPE_PRESETS_KEY) ?? "{}") as Record<string, DoughRecipePreset>; } catch { return {}; }
}
export function saveDoughRecipePresets(p: Record<string, DoughRecipePreset>): void {
  try { localStorage.setItem(DOUGH_RECIPE_PRESETS_KEY, JSON.stringify(p)); } catch {}
  notifyKv(DOUGH_RECIPE_PRESETS_KEY, p);
}

export function loadFrontlineRecipePresets(): Record<string, RecipeRow[]> {
  try { return JSON.parse(localStorage.getItem(FRONTLINE_RECIPE_PRESETS_KEY) ?? "{}") as Record<string, RecipeRow[]>; } catch { return {}; }
}
export function saveFrontlineRecipePresets(p: Record<string, RecipeRow[]>): void {
  try { localStorage.setItem(FRONTLINE_RECIPE_PRESETS_KEY, JSON.stringify(p)); } catch {}
  notifyKv(FRONTLINE_RECIPE_PRESETS_KEY, p);
}

export function loadCheeseRecipePresets(): Record<string, RecipeRow[]> {
  try { return JSON.parse(localStorage.getItem(CHEESE_RECIPE_PRESETS_KEY) ?? "{}") as Record<string, RecipeRow[]>; } catch { return {}; }
}
export function saveCheeseRecipePresets(p: Record<string, RecipeRow[]>): void {
  try { localStorage.setItem(CHEESE_RECIPE_PRESETS_KEY, JSON.stringify(p)); } catch {}
  notifyKv(CHEESE_RECIPE_PRESETS_KEY, p);
}

export const SEED_MIX_RECIPE_NAMES = new Set(MIX_SEED.mixRecipeNames);

export const STALE_BRANDS = [
  "Bobos","Lowes","Lucias","Morming Melts",
  "Lucia's / Craft","Lucia's / Morning Melts","Lucia's / Pinsa",
];

const PEP_TAXONOMY_MIGRATION_KEY = "run-calc-pep-taxonomy-v1";

// One-time taxonomy fix:
//  • Pep types list: rename legacy names → detailed standard names, drop retired
//    names ("Diced Pepperoni" — now an applicator type), ensure defaults present.
//  • Applicator (ingredient) types list: add "Diced Pepperoni".
// Pep references inside saved profiles/runs/templates/history are normalized on
// read (see normalizePepFields), so this only repairs the manageable lists.
export function applyPepTaxonomyMigrationIfNeeded(): void {
  if (typeof localStorage === "undefined") return;
  if (localStorage.getItem(PEP_TAXONOMY_MIGRATION_KEY)) return;
  try {
    const savedPep = loadList(PEP_TYPES_KEY, DEFAULT_PEP_TYPES);
    const cleanedPep = savedPep
      .map(t => PEP_TYPE_RENAMES[t] ?? t)
      .filter(t => !RETIRED_PEP_TYPES.includes(t));
    const mergedPep = [...new Set([...DEFAULT_PEP_TYPES, ...cleanedPep])].sort((a, b) => a.localeCompare(b));
    saveList(PEP_TYPES_KEY, mergedPep);

    // Only carry a retired pep name over to the applicator list if the user
    // actually HAD it as a pep type — never introduce it on a fresh/empty
    // install (the app ships with no built-in data since the 2026-07-03 purge).
    const retiredPresent = RETIRED_PEP_TYPES.filter(name =>
      savedPep.some(t => t.toLowerCase() === name.toLowerCase()),
    );
    if (retiredPresent.length > 0) {
      const savedApp = loadList(INGREDIENT_TYPES_KEY, DEFAULT_INGREDIENT_TYPES);
      for (const name of retiredPresent) {
        if (!savedApp.some(t => t.toLowerCase() === name.toLowerCase())) savedApp.push(name);
      }
      saveList(INGREDIENT_TYPES_KEY, [...new Set(savedApp)].sort((a, b) => a.localeCompare(b)));
    }

    localStorage.setItem(PEP_TAXONOMY_MIGRATION_KEY, "1");
  } catch {}
}

const INGREDIENT_DEDUPE_MIGRATION_KEY = "run-calc-ingredient-dedupe-v2";

// One-time near-duplicate cleanup: rename app-type and cheese-ingredient names to
// their canonical spelling and drop the resulting duplicates (case-insensitive).
// Names inside saved profiles/runs/templates/history are renamed on read (see
// normalizeIngredientFields), so this only repairs the manageable option lists.
export function applyIngredientDedupeMigrationIfNeeded(): void {
  if (typeof localStorage === "undefined") return;
  if (localStorage.getItem(INGREDIENT_DEDUPE_MIGRATION_KEY)) return;
  try {
    for (const key of [INGREDIENT_TYPES_KEY, CHEESE_INGREDIENTS_KEY]) {
      if (localStorage.getItem(key) === null) continue;
      const saved = loadList(key, []);
      const seen = new Set<string>();
      const out: string[] = [];
      for (const t of saved) {
        const renamed = INGREDIENT_RENAMES[t] ?? t;
        const lk = renamed.toLowerCase();
        if (!seen.has(lk)) {
          seen.add(lk);
          out.push(renamed);
        }
      }
      saveList(key, out.sort((a, b) => a.localeCompare(b)));
    }
    localStorage.setItem(INGREDIENT_DEDUPE_MIGRATION_KEY, "1");
  } catch {}
}

// ── Server ingredient catalog (Task #102) ───────────────────────────────────
// The catalog is the factory-wide, server-owned source of truth for
// ingredient names going forward; recipe rows carry a stable `ingredientId`
// resolved through it (see @workspace/ingredient-catalog). The legacy
// per-list localStorage arrays + merge/deletion tombstones above are kept
// working unchanged (nothing here removes them) so existing sync/parity
// behavior is unaffected; this only ADDS the catalog as an authoritative,
// additional source that every recipe row can resolve its live name from.
const INGREDIENT_CATALOG_MIGRATION_KEY = "run-calc-ingredient-catalog-migration-v1";
const INGREDIENT_LIST_CATEGORIES: [string, IngredientCategory][] = [
  [INGREDIENT_TYPES_KEY, "general"],
  [PEP_TYPES_KEY, "pep"],
  [CHEESE_INGREDIENTS_KEY, "cheese"],
  [MIX_INGREDIENTS_KEY, "mix"],
  [DOUGH_INGREDIENTS_KEY, "dough"],
  [FRONTLINE_INGREDIENTS_KEY, "frontline"],
];

// One-time, idempotent: if the server catalog is empty, seed it from today's
// local option lists so no existing name is lost. Marker-guarded so it only
// ever runs once per device even if the catalog stays empty (e.g. offline).
export async function migrateIngredientListsToCatalogIfNeeded(
  existing: Ingredient[],
): Promise<Ingredient[]> {
  if (typeof localStorage === "undefined") return existing;
  if (localStorage.getItem(INGREDIENT_CATALOG_MIGRATION_KEY)) return existing;
  if (existing.length > 0) {
    // Catalog already has data (another device seeded it, or manager added
    // items) — nothing to migrate, just mark done.
    try { localStorage.setItem(INGREDIENT_CATALOG_MIGRATION_KEY, "1"); } catch {}
    return existing;
  }
  try {
    let pool = existing;
    for (const [key, category] of INGREDIENT_LIST_CATEGORIES) {
      const names = loadList(key, []);
      for (const name of names) {
        if (!name.trim()) continue;
        const built = findOrBuildIngredient(name, category, pool);
        if (!pool.some((i) => i.id === built.id)) pool = [...pool, built];
        else pool = pool.map((i) => (i.id === built.id ? built : i));
      }
    }
    if (pool.length === 0) {
      localStorage.setItem(INGREDIENT_CATALOG_MIGRATION_KEY, "1");
      return existing;
    }
    const saved = await saveIngredientsRemote(pool);
    localStorage.setItem(INGREDIENT_CATALOG_MIGRATION_KEY, "1");
    return saved;
  } catch {
    // Network/server unavailable — leave the marker unset so it retries next
    // load instead of silently skipping the migration forever.
    return existing;
  }
}

// Refresh + backfill `ingredientId`/`ingredient` on every recipe-row array in
// a FormValues object using the live catalog. Pure passthrough on rows that
// already have neither a matching id nor name (never drops data).
export function hydrateRecipeRowsWithCatalog(
  values: FormValues,
  catalog: Ingredient[],
): FormValues {
  if (catalog.length === 0) return values;
  const index = buildIngredientIndex(catalog);
  const hydrate = (rows: RecipeRow[] | undefined) =>
    rows ? (hydrateRecipeRowsCatalog(rows, index) as RecipeRow[]) : rows;
  return {
    ...values,
    doughRecipe: hydrate(values.doughRecipe) ?? values.doughRecipe,
    app1CheeseRecipe: hydrate(values.app1CheeseRecipe) ?? values.app1CheeseRecipe,
    app2CheeseRecipe: hydrate(values.app2CheeseRecipe) ?? values.app2CheeseRecipe,
    app3CheeseRecipe: hydrate(values.app3CheeseRecipe) ?? values.app3CheeseRecipe,
    app4CheeseRecipe: hydrate(values.app4CheeseRecipe) ?? values.app4CheeseRecipe,
    frontlineRecipe: hydrate(values.frontlineRecipe) ?? values.frontlineRecipe,
  };
}

export { fetchIngredients };

// Persist a user-driven ingredient merge across every localStorage surface:
// master-data option lists, recipe presets (dough/sauce/cheese), brand + crust
// profiles, per-run values, templates, and history. Pure value rewriting lives
// in ./mergeIngredients; this only wires it to storage. Inventory stock is
// folded separately via the server merge endpoint. Callers reload the app after
// this so React state re-initializes from the rewritten localStorage and the
// merged lists get pushed to live-sync.
export function applyIngredientMerge(map: MergeMap): void {
  if (typeof localStorage === "undefined") return;
  if (Object.keys(map).length === 0) return;
  // Record the merged-away source names as tombstones so live-sync's additive
  // list-union can't bring them back from a stale peer/server. Never tombstone a
  // target (a source that maps to itself isn't a real source).
  const targets = new Set(Object.values(map).map((t) => t.trim().toLowerCase()));
  const sources = Object.keys(map).filter((s) => !targets.has(s.trim().toLowerCase()));
  if (sources.length > 0) saveMergedAway([...loadMergedAway(), ...sources]);
  // ── Flat master-data option lists. Die types are intentionally EXCLUDED from
  // merge (not in the merge universe, and dieType is not in MERGE_NAME_FIELDS),
  // so DIE_TYPES_KEY is deliberately NOT rewritten here. ──
  const listKeys = [
    INGREDIENT_TYPES_KEY,
    PEP_TYPES_KEY,
    CHEESE_INGREDIENTS_KEY,
    DOUGH_INGREDIENTS_KEY,
    FRONTLINE_INGREDIENTS_KEY,
    MIX_INGREDIENTS_KEY,
  ];
  for (const key of listKeys) {
    if (localStorage.getItem(key) === null) continue;
    const merged = mergeListNames(loadList(key, []), map).sort((a, b) => a.localeCompare(b));
    saveList(key, merged);
  }
  // ── Recipe presets ──
  try {
    const dough = loadDoughRecipePresets();
    const nextDough: Record<string, DoughRecipePreset> = {};
    for (const [name, preset] of Object.entries(dough)) {
      nextDough[name] = { ...preset, rows: mergeRecipePresetMap({ r: preset.rows ?? [] }, map).r };
    }
    saveDoughRecipePresets(nextDough);
  } catch {}
  try { saveFrontlineRecipePresets(mergeRecipePresetMap(loadFrontlineRecipePresets(), map)); } catch {}
  try { saveCheeseRecipePresets(mergeRecipePresetMap(loadCheeseRecipePresets(), map)); } catch {}
  // ── Templates ──
  try {
    const templates = loadTemplates().map((t) =>
      t.values ? { ...t, values: mergeSettingsObject(t.values as unknown as Record<string, unknown>, map) as unknown as typeof t.values } : t,
    );
    saveTemplates(templates);
  } catch {}
  // ── History ──
  try {
    const history = loadHistory().map((day) => ({
      ...day,
      runValues: Object.fromEntries(
        Object.entries(day.runValues ?? {}).map(([id, vals]) => [
          id,
          mergeSettingsObject(vals as unknown as Record<string, unknown>, map) as unknown as FormValues,
        ]),
      ),
    }));
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
  } catch {}
  // ── Per-run values + brand/crust profiles (prefix scan; mirrors buildSyncPayload) ──
  const runPrefix = RUN_KEY("");
  const keysToRewrite: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k) continue;
    if (
      k.startsWith(runPrefix) ||
      k.startsWith("run-calc-profile-") ||
      k.startsWith("run-calc-crust-profile-")
    ) {
      keysToRewrite.push(k);
    }
  }
  for (const k of keysToRewrite) {
    try {
      const obj = JSON.parse(localStorage.getItem(k) ?? "null");
      if (obj && typeof obj === "object") {
        localStorage.setItem(k, JSON.stringify(mergeSettingsObject(obj as Record<string, unknown>, map)));
      }
    } catch {}
  }
}

// Per-category storage wiring for a RECIPE-NAME merge (see ./mergeRecipeNames).
// Each category owns a name list, a deletion-tombstone namespace, and (except
// mixes, whose presets are code-defined factory seeds) a recipe-preset map whose
// KEYS are the recipe names.
const RECIPE_NAME_MERGE_STORE: Record<
  RecipeNameMergeCategory,
  {
    listKey: string;
    namespace: string;
    loadPresets?: () => Record<string, unknown>;
    savePresets?: (p: Record<string, unknown>) => void;
  }
> = {
  dough: {
    listKey: DOUGH_RECIPE_NAMES_KEY,
    namespace: "doughRecipeNames",
    loadPresets: () => loadDoughRecipePresets() as unknown as Record<string, unknown>,
    savePresets: (p) => saveDoughRecipePresets(p as unknown as Record<string, DoughRecipePreset>),
  },
  sauce: {
    listKey: FRONTLINE_RECIPE_NAMES_KEY,
    namespace: "frontlineRecipeNames",
    loadPresets: () => loadFrontlineRecipePresets() as unknown as Record<string, unknown>,
    savePresets: (p) => saveFrontlineRecipePresets(p as unknown as Record<string, RecipeRow[]>),
  },
  cheese: {
    listKey: CHEESE_RECIPE_NAMES_KEY,
    namespace: "cheeseRecipeNames",
    loadPresets: () => loadCheeseRecipePresets() as unknown as Record<string, unknown>,
    savePresets: (p) => saveCheeseRecipePresets(p as unknown as Record<string, RecipeRow[]>),
  },
  // Mixes have no editable preset store (factory MIX_SEED) and no per-run
  // selection field, so a mix merge only folds the name list + tombstones.
  mixes: { listKey: MIX_RECIPE_NAMES_KEY, namespace: "mixRecipeNames" },
};

// Persist a user-driven RECIPE-NAME merge across every localStorage surface:
// the category's name list, its recipe-preset map keys, and the recipe-name
// selection fields on per-run values, brand/crust profiles, templates, and
// history. Deletion tombstones stop the additive live-sync union from
// resurrecting the merged-away names. Pure rewriting lives in ./mergeRecipeNames;
// this only wires it to storage. Callers refresh React state (refreshAfterMerge)
// so the merged data shows immediately and the sync push carries it.
// Returns the ids of the runs whose per-run values were actually changed, so the
// caller can advance their `runValuesUpdatedAt` stamps — otherwise a stale remote
// sync payload (carrying the pre-merge recipe-name selection at an equal/newer
// stamp) could overwrite the merged value on the next pull.
export function applyRecipeNameMerge(category: RecipeNameMergeCategory, map: MergeMap): string[] {
  if (typeof localStorage === "undefined") return [];
  if (Object.keys(map).length === 0) return [];
  const store = RECIPE_NAME_MERGE_STORE[category];
  const fields = RECIPE_NAME_FIELDS_BY_CATEGORY[category];
  // Tombstone the merged-away source names (never a target that maps to itself)
  // so the additive sync list-union can't bring them back from a stale peer.
  const targets = new Set(Object.values(map).map((t) => t.trim().toLowerCase()));
  const sources = Object.keys(map).filter((s) => !targets.has(s.trim().toLowerCase()));
  for (const s of sources) tombstoneDeleted(store.namespace, s);
  // ── Name list ──
  if (localStorage.getItem(store.listKey) !== null) {
    const merged = mergeListNames(loadList(store.listKey, []), map).sort((a, b) => a.localeCompare(b));
    saveList(store.listKey, merged);
  }
  // ── Recipe presets (fold KEYS; target's rows win) ──
  if (store.loadPresets && store.savePresets) {
    try {
      store.savePresets(foldPresetKeys(store.loadPresets(), map));
    } catch {}
  }
  // (Defensive: no category currently has zero selection fields — mix names
  // live in the shared app{n}CheeseRecipeName link fields, same as cheese.)
  if (fields.length === 0) return [];
  const rewrite = <T extends Record<string, unknown>>(obj: T) =>
    mergeRecipeNameSettingsObject(obj, map, fields);
  // ── Templates ──
  try {
    const templates = loadTemplates().map((t) =>
      t.values ? { ...t, values: rewrite(t.values as unknown as Record<string, unknown>) as unknown as typeof t.values } : t,
    );
    saveTemplates(templates);
  } catch {}
  // ── History ──
  try {
    const history = loadHistory().map((day) => ({
      ...day,
      runValues: Object.fromEntries(
        Object.entries(day.runValues ?? {}).map(([id, vals]) => [
          id,
          rewrite(vals as unknown as Record<string, unknown>) as unknown as FormValues,
        ]),
      ),
    }));
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
  } catch {}
  // ── Per-run values + brand/crust profiles (prefix scan; mirrors buildSyncPayload) ──
  const runPrefix = RUN_KEY("");
  const keysToRewrite: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k) continue;
    if (
      k.startsWith(runPrefix) ||
      k.startsWith("run-calc-profile-") ||
      k.startsWith("run-calc-crust-profile-")
    ) {
      keysToRewrite.push(k);
    }
  }
  const affectedRunIds: string[] = [];
  for (const k of keysToRewrite) {
    try {
      const raw = localStorage.getItem(k) ?? "null";
      const obj = JSON.parse(raw);
      if (obj && typeof obj === "object") {
        const next = JSON.stringify(rewrite(obj as Record<string, unknown>));
        if (next !== raw) {
          localStorage.setItem(k, next);
          if (k.startsWith(runPrefix)) affectedRunIds.push(k.slice(runPrefix.length));
        }
      }
    } catch {}
  }
  return affectedRunIds;
}

/**
 * Blank every selection field that still points at a recipe name which is
 * leaving its category (a reclassify/"move to another category", not a merge —
 * there is no target name of the SAME category to re-point to). Walks the same
 * surfaces as applyRecipeNameMerge (templates, history, per-run values,
 * brand/crust profiles) and returns the ids of runs it actually changed so the
 * caller can bump their edit stamps before the sync push — otherwise a stale
 * peer at an equal/older stamp resurrects the dangling selection.
 */
export function clearRecipeNameSelections(
  category: RecipeNameMergeCategory,
  name: string,
): string[] {
  if (typeof localStorage === "undefined") return [];
  const fields = RECIPE_NAME_FIELDS_BY_CATEGORY[category];
  if (fields.length === 0 || !name.trim()) return [];
  const needle = name.trim().toLowerCase();
  const clear = <T extends Record<string, unknown>>(obj: T): T => {
    let changed = false;
    const out = { ...obj } as Record<string, unknown>;
    for (const k of fields) {
      const v = out[k];
      if (typeof v === "string" && v.trim().toLowerCase() === needle) {
        out[k] = "";
        changed = true;
      }
    }
    return (changed ? out : obj) as T;
  };
  // ── Templates ──
  try {
    const templates = loadTemplates().map((t) =>
      t.values ? { ...t, values: clear(t.values as unknown as Record<string, unknown>) as unknown as typeof t.values } : t,
    );
    saveTemplates(templates);
  } catch {}
  // ── History ──
  try {
    const history = loadHistory().map((day) => ({
      ...day,
      runValues: Object.fromEntries(
        Object.entries(day.runValues ?? {}).map(([id, vals]) => [
          id,
          clear(vals as unknown as Record<string, unknown>) as unknown as FormValues,
        ]),
      ),
    }));
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
  } catch {}
  // ── Per-run values + brand/crust profiles (prefix scan; mirrors buildSyncPayload) ──
  const runPrefix = RUN_KEY("");
  const keysToRewrite: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k) continue;
    if (
      k.startsWith(runPrefix) ||
      k.startsWith("run-calc-profile-") ||
      k.startsWith("run-calc-crust-profile-")
    ) {
      keysToRewrite.push(k);
    }
  }
  const affectedRunIds: string[] = [];
  for (const k of keysToRewrite) {
    try {
      const raw = localStorage.getItem(k) ?? "null";
      const obj = JSON.parse(raw);
      if (obj && typeof obj === "object") {
        const next = JSON.stringify(clear(obj as Record<string, unknown>));
        if (next !== raw) {
          localStorage.setItem(k, next);
          if (k.startsWith(runPrefix)) affectedRunIds.push(k.slice(runPrefix.length));
        }
      }
    } catch {}
  }
  return affectedRunIds;
}

/**
 * Remove a STALE recipe-name reference outright — for "old reference" names
 * with no real pool recipe behind them and no good merge target. Unlike a
 * merge there is no target: every surface that still holds the name is
 * cleared. Walks the same surfaces as applyRecipeNameMerge:
 *  - legacy local name list (case-insensitive removal) + deletion tombstone,
 *    so the additive live-sync union can't resurrect it from a stale peer;
 *  - the category's recipe-preset map (drops the name's entry);
 *  - recipe-name selection fields on per-run values, brand/crust profiles,
 *    templates and history (blanked via clearRecipeNameSelections).
 * Callers must refuse pool-backed names BEFORE calling (pool recipes are
 * deleted in their Manage Lists section, not here) and must bump the returned
 * runs' edit stamps + push, exactly like a merge.
 */
export function removeStaleRecipeReference(
  category: RecipeNameMergeCategory,
  name: string,
): string[] {
  if (typeof localStorage === "undefined") return [];
  const trimmed = name.trim();
  if (!trimmed) return [];
  const needle = trimmed.toLowerCase();
  const store = RECIPE_NAME_MERGE_STORE[category];
  // Tombstone first — even when the list/preset entry only lives on peers or
  // the server, the synced tombstone is what makes the removal stick.
  tombstoneDeleted(store.namespace, trimmed);
  // ── Legacy name list (case-insensitive) ──
  if (localStorage.getItem(store.listKey) !== null) {
    const list = loadList(store.listKey, []);
    const next = list.filter((n) => n.trim().toLowerCase() !== needle);
    if (next.length !== list.length) saveList(store.listKey, next);
  }
  // ── Recipe presets (drop the name's entry, case-insensitive) ──
  if (store.loadPresets && store.savePresets) {
    try {
      const presets = store.loadPresets();
      const keys = Object.keys(presets).filter((k) => k.trim().toLowerCase() === needle);
      if (keys.length > 0) {
        const next = { ...presets };
        for (const k of keys) delete next[k];
        store.savePresets(next);
      }
    } catch {}
  }
  // ── Selection fields on runs/profiles/templates/history ──
  return clearRecipeNameSelections(category, trimmed);
}

// ── Master-data change history (local-only undo trail) ──────────────────────
// A snapshot is every "run-calc-*" localStorage key EXCEPT the change-history
// key itself (which would nest snapshots and blow up exponentially). This is the
// maximal blast radius of any master-data edit — a merge rewrites lists, recipe
// presets, profiles, runs, templates and history; a brand/flavor rename rewrites
// profiles + day-state; an ingredient rename rewrites per-run values. Snapshot-
// everything is the only universally-correct undo, so we accept the size cost
// (bounded by MAX_CHANGE_HISTORY + quota-safe trimming on write).
const APP_KEY_PREFIX = "run-calc-";

export function captureMasterDataSnapshot(): Record<string, string> {
  const snap: Record<string, string> = {};
  if (typeof localStorage === "undefined") return snap;
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k || k === CHANGE_HISTORY_KEY) continue;
    if (!k.startsWith(APP_KEY_PREFIX)) continue;
    const v = localStorage.getItem(k);
    if (v !== null) snap[k] = v;
  }
  return snap;
}

// Restore a snapshot: rewrite every captured key, and delete any current
// "run-calc-*" key (except the change-history key) that wasn't in the snapshot —
// so additions made after the snapshot are truly reverted, not just overwritten.
export function restoreMasterDataSnapshot(snap: Record<string, string>): void {
  if (typeof localStorage === "undefined") return;
  const present = new Set<string>();
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith(APP_KEY_PREFIX) && k !== CHANGE_HISTORY_KEY) present.add(k);
  }
  for (const k of present) {
    if (!(k in snap)) {
      try { localStorage.removeItem(k); } catch {}
    }
  }
  for (const [k, v] of Object.entries(snap)) {
    try { localStorage.setItem(k, v); } catch {}
  }
}

export function loadChangeHistory(): MasterDataChange[] {
  try {
    const raw = localStorage.getItem(CHANGE_HISTORY_KEY);
    if (raw) return JSON.parse(raw) as MasterDataChange[];
  } catch {}
  return [];
}

// Persist the change-history list, trimming oldest entries until it fits the
// localStorage quota. A snapshot can be large, so a write may overflow; rather
// than throw (and break the edit that triggered it) we drop the oldest entries
// and retry, keeping whatever recent history fits.
export function saveChangeHistory(list: MasterDataChange[]): void {
  if (typeof localStorage === "undefined") return;
  let trimmed = list.slice(0, MAX_CHANGE_HISTORY);
  while (trimmed.length > 0) {
    try {
      localStorage.setItem(CHANGE_HISTORY_KEY, JSON.stringify(trimmed));
      return;
    } catch {
      trimmed = trimmed.slice(0, -1); // drop the oldest and retry
    }
  }
  try { localStorage.removeItem(CHANGE_HISTORY_KEY); } catch {}
}

// Record a change. `before` must be a snapshot captured BEFORE the edit. If the
// edit turned out to be a no-op (the post-edit state equals `before`), nothing
// is recorded — list mutations bail silently on duplicates/invalid input, and a
// useless undo entry would just clutter the history.
export function recordMasterDataChange(
  type: MasterDataChangeType,
  description: string,
  before: Record<string, string>,
): void {
  const after = captureMasterDataSnapshot();
  if (JSON.stringify(before) === JSON.stringify(after)) return;
  const entry: MasterDataChange = {
    id: genId(),
    ts: Date.now(),
    type,
    description,
    before,
  };
  saveChangeHistory([entry, ...loadChangeHistory()]);
}

// Roll back to the point just before the given entry: restore that entry's
// before-snapshot and discard it plus every newer entry (the list is newest-
// first, so we keep only entries older than the undone one). Returns false when
// the entry no longer exists. Callers reload/refresh React state and re-push to
// the server after a successful undo.
export function undoChange(id: string): boolean {
  const list = loadChangeHistory();
  const idx = list.findIndex((e) => e.id === id);
  if (idx === -1) return false;
  restoreMasterDataSnapshot(list[idx].before);
  saveChangeHistory(list.slice(idx + 1));
  return true;
}

/** Case-insensitive merge that keeps the existing label when a duplicate appears. */
function mergeListInsensitive(existing: string[], additions: string[]): string[] {
  const seen = new Map<string, string>();
  for (const x of existing) seen.set(x.toLowerCase(), x);
  for (const a of additions) {
    const k = a.toLowerCase();
    if (!seen.has(k)) seen.set(k, a);
  }
  return [...seen.values()];
}

const RECAT_STRAY_MIX_KEY = "run-calc-recat-stray-mix-v1";

/**
 * One-time cleanup: mix / cheese-mix RECIPE names (e.g. "4Hands Club Mix",
 * "Aldo's Cheese Mix", "Red Hot Cheese Mix Monterey Jack ...") that were
 * imported into the standalone-ingredient list (`ingredientTypes`) are really
 * recipe names, so they belong in the Mixes / Cheese recipe-name lists — that's
 * where the Merge tool's Mixes/Cheese tabs read from, and where they can be
 * merged/managed. Move each stray "...mix" name OUT of `ingredientTypes` and
 * INTO `mixRecipeNames`, or `cheeseRecipeNames` when the name mentions cheese.
 * Genuine ingredients that legitimately contain "mix" (allowlisted, e.g. the
 * jarred "Hot Giardiniera Mix") are left alone. Each removed ingredient entry is
 * tombstoned so the additive live-sync union can't resurrect it, and the
 * destination tombstone (if any) is cleared so the moved name sticks. Runs once,
 * guarded by a version marker.
 */
export function applyStrayMixRecategorizeIfNeeded(): void {
  if (typeof localStorage === "undefined") return;
  if (localStorage.getItem(RECAT_STRAY_MIX_KEY)) return;
  try {
    const ingredients = loadList(INGREDIENT_TYPES_KEY, DEFAULT_INGREDIENT_TYPES);
    const allowlist = new Set(
      [
        // The generic "Mix"/"Cheese" applicator types are legitimate dropdown
        // entries (the run form's Mix/Cheese cards gate on them) — a fresh
        // device must never tombstone them out of the factory-wide list.
        "mix",
        "cheese",
        ...DEFAULT_INGREDIENT_TYPES,
        ...MIX_SEED.frontlineIngredients,
        ...loadList(PEP_TYPES_KEY, DEFAULT_PEP_TYPES),
      ].map((n) => n.toLowerCase()),
    );
    const stray = ingredients.filter((n) => isStrayMixName(n, allowlist));
    if (stray.length === 0) {
      localStorage.setItem(RECAT_STRAY_MIX_KEY, "1");
      return;
    }
    const cheeseAdds = stray.filter((n) => /cheese/i.test(n));
    const mixAdds = stray.filter((n) => !/cheese/i.test(n));

    saveList(
      INGREDIENT_TYPES_KEY,
      ingredients.filter((n) => !stray.includes(n)).sort((a, b) => a.localeCompare(b)),
    );
    if (cheeseAdds.length) {
      saveList(
        CHEESE_RECIPE_NAMES_KEY,
        mergeListInsensitive(loadList(CHEESE_RECIPE_NAMES_KEY, []), cheeseAdds).sort((a, b) =>
          a.localeCompare(b),
        ),
      );
    }
    if (mixAdds.length) {
      saveList(
        MIX_RECIPE_NAMES_KEY,
        mergeListInsensitive(loadList(MIX_RECIPE_NAMES_KEY, []), mixAdds).sort((a, b) =>
          a.localeCompare(b),
        ),
      );
    }

    for (const n of stray) tombstoneDeleted("ingredientTypes", n);
    for (const n of cheeseAdds) clearDeleted("cheeseRecipeNames", n);
    for (const n of mixAdds) clearDeleted("mixRecipeNames", n);

    localStorage.setItem(RECAT_STRAY_MIX_KEY, "1");
  } catch {}
}

const RECAT_MIX_SLOT_KEY = "run-calc-mix-slot-recat-v1";
const PENDING_SERVER_MIX_PUSH_KEY = "run-calc-pending-server-mix-push-v1";

/** A mix queued for a best-effort push to the server Mixes pool (see below). */
export type PendingServerMixPush = { name: string; componentIngredients: string[] };

/** Mixes the cleanup migration queued for the server pool (empty when none). */
export function loadPendingServerMixPushes(): PendingServerMixPush[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(PENDING_SERVER_MIX_PUSH_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((p): p is PendingServerMixPush => !!p && typeof (p as PendingServerMixPush).name === "string")
      .map((p) => ({
        name: p.name,
        componentIngredients: Array.isArray(p.componentIngredients)
          ? p.componentIngredients.filter((i): i is string => typeof i === "string")
          : [],
      }));
  } catch {
    return [];
  }
}

/** Clear the queue after a successful server push. */
export function clearPendingServerMixPushes(): void {
  try { localStorage.removeItem(PENDING_SERVER_MIX_PUSH_KEY); } catch {}
}

/**
 * One-time cleanup (approved 2026-07-09): applicator TYPE slots that hold a raw
 * mix/cheese-blend RECIPE name (e.g. "White Fajita Mix") are converted to the
 * generic types the run form's recipe cards gate on — literal "Mix" for mixes,
 * "cheese" for cheese blends — with the original name preserved as the slot's
 * recipe-name link (and rows backfilled from the local presets when the slot
 * has none). New spec imports already place slots this way; this migrates what
 * older imports left behind. Also:
 *  - moves any REMAINING stray recipe names out of `ingredientTypes` (same
 *    rules + tombstones as applyStrayMixRecategorizeIfNeeded — that pass ran
 *    before newer imports could re-add strays),
 *  - ensures the generic "Cheese" and "Mix" entries exist in the Type dropdown
 *    (tombstones cleared so the additive sync union keeps them), and
 *  - queues converted/stray mix names for a best-effort push to the server
 *    Mixes pool (the run form's Mix card hydrates from the server list), which
 *    home.tsx retries on boot until a manager session succeeds.
 * Live/scheduled RUN VALUES are intentionally NOT rewritten — the run-form
 * gates match raw mix names case-insensitively ("…mix"), so today's open runs
 * keep working and tomorrow's runs pull from the converted profiles.
 * Runs once, guarded by a version marker.
 */
export function applyMixSlotRecategorizeIfNeeded(): void {
  if (typeof localStorage === "undefined") return;
  if (localStorage.getItem(RECAT_MIX_SLOT_KEY)) return;
  try {
    const allowlist = new Set(
      [
        "mix",
        "cheese",
        ...DEFAULT_INGREDIENT_TYPES,
        ...MIX_SEED.frontlineIngredients,
        ...loadList(PEP_TYPES_KEY, DEFAULT_PEP_TYPES),
      ].map((n) => n.toLowerCase()),
    );

    // ── Remaining strays out of the shared Type dropdown, generics in ──
    const ingredients = loadList(INGREDIENT_TYPES_KEY, DEFAULT_INGREDIENT_TYPES);
    const stray = ingredients.filter((n) => isStrayMixName(n, allowlist));
    const strayCheese = stray.filter((n) => /cheese/i.test(n));
    const strayMix = stray.filter((n) => !/cheese/i.test(n));
    saveList(
      INGREDIENT_TYPES_KEY,
      mergeListInsensitive(
        ingredients.filter((n) => !stray.includes(n)),
        ["Cheese", "Mix"],
      ).sort((a, b) => a.localeCompare(b)),
    );
    for (const n of stray) tombstoneDeleted("ingredientTypes", n);
    clearDeleted("ingredientTypes", "Cheese");
    clearDeleted("ingredientTypes", "Mix");

    // ── Convert saved profiles' applicator slots ──
    const presets = loadCheeseRecipePresets();
    const presetByLower = new Map(Object.keys(presets).map((k) => [k.toLowerCase(), k] as const));
    const presetRowsFor = (name: string): RecipeRow[] => {
      const pk = presetByLower.get(name.trim().toLowerCase());
      const rows = pk ? presets[pk] ?? [] : [];
      return rows
        .filter((r) => (r.ingredient ?? "").trim())
        .map((r) => ({ ingredient: r.ingredient, lbs: r.lbs }));
    };
    const pendingByLower = new Map<string, PendingServerMixPush>();
    const queueMixPush = (name: string) => {
      const key = name.trim().toLowerCase();
      if (!key || pendingByLower.has(key)) return;
      pendingByLower.set(key, {
        name: name.trim(),
        componentIngredients: presetRowsFor(name).map((r) => r.ingredient),
      });
    };
    const cheeseNameAdds: string[] = [...strayCheese];
    const mixNameAdds: string[] = [...strayMix];
    for (const n of strayMix) queueMixPush(n);

    const bf = loadBrandFlavors();
    for (const [brand, flavors] of Object.entries(bf)) {
      for (const flavor of flavors) {
        const saved = loadProfile(brand, flavor);
        if (!saved) continue;
        const rec = saved as unknown as Record<string, unknown>;
        let changed = false;
        for (const slot of [1, 2, 3, 4]) {
          const t = String(rec[`app${slot}Type`] ?? "").trim();
          if (!t) continue;
          if (!isStrayMixName(t, allowlist)) continue;
          const isCheese = /cheese/i.test(t);
          rec[`app${slot}Type`] = isCheese ? "cheese" : "Mix";
          const existingName = String(rec[`app${slot}CheeseRecipeName`] ?? "").trim();
          const linkName = existingName || t;
          if (!existingName) rec[`app${slot}CheeseRecipeName`] = t;
          const rows = rec[`app${slot}CheeseRecipe`];
          const hasRows =
            Array.isArray(rows) &&
            rows.some((r) => String((r as RecipeRow)?.ingredient ?? "").trim());
          if (!hasRows) {
            const presetRows = presetRowsFor(linkName);
            if (presetRows.length) rec[`app${slot}CheeseRecipe`] = presetRows;
          }
          if (isCheese) cheeseNameAdds.push(linkName);
          else {
            mixNameAdds.push(linkName);
            queueMixPush(linkName);
          }
          changed = true;
        }
        if (!changed) continue;
        // Targeted dough-blob write (NOT saveProfile: the loaded blob has no
        // crust fields, so saveProfile would overwrite the crust profile with
        // an empty extract). Mirrors applyPackagingPatchToProfile.
        try {
          localStorage.setItem(PROFILE_KEY(brand, flavor), JSON.stringify(rec));
          markProfileEdited(canonicalProfileKey(brand, flavor));
        } catch {}
      }
    }

    // ── Recipe-name lists (merge tabs read these) + tombstone clears ──
    if (cheeseNameAdds.length) {
      saveList(
        CHEESE_RECIPE_NAMES_KEY,
        mergeListInsensitive(loadList(CHEESE_RECIPE_NAMES_KEY, []), cheeseNameAdds).sort((a, b) =>
          a.localeCompare(b),
        ),
      );
      for (const n of cheeseNameAdds) clearDeleted("cheeseRecipeNames", n);
    }
    if (mixNameAdds.length) {
      saveList(
        MIX_RECIPE_NAMES_KEY,
        mergeListInsensitive(loadList(MIX_RECIPE_NAMES_KEY, []), mixNameAdds).sort((a, b) =>
          a.localeCompare(b),
        ),
      );
      for (const n of mixNameAdds) clearDeleted("mixRecipeNames", n);
    }

    if (pendingByLower.size) {
      const existing = loadPendingServerMixPushes();
      const seen = new Set(existing.map((p) => p.name.trim().toLowerCase()));
      const merged = [...existing, ...[...pendingByLower.values()].filter((p) => !seen.has(p.name.trim().toLowerCase()))];
      try { localStorage.setItem(PENDING_SERVER_MIX_PUSH_KEY, JSON.stringify(merged)); } catch {}
    }

    localStorage.setItem(RECAT_MIX_SLOT_KEY, "1");
  } catch {}
}

/**
 * Pool-aware follow-up to applyMixSlotRecategorizeIfNeeded (see the heal
 * helpers in mergeRecipeNames.ts for the full story). The v1 pass ran at boot
 * with a word heuristic only; this pass runs once the SERVER cheese/mix
 * pools have loaded, so a TYPE slot holding an exact pool name (regardless of
 * wording, e.g. "Gyro Cheese Blend") is converted to the generic type with the
 * CANONICAL pool spelling in the link field. Covers saved profiles (targeted
 * dough-blob writes + edit stamps so the fix pushes to the server profile
 * pool) and per-run values (v1 skipped runs; a stray type there leaks into the
 * Type dropdown, which unions current values). Also drops pool names that
 * leaked into the ingredientTypes dropdown list (with tombstones).
 * RECURRING (was one-shot behind "run-calc-mix-slot-recat-v2"): a spec import
 * whose cheese blend had no matching recipe in the same file used to re-leak
 * blend names AFTER the one-time marker was set, so the heal now runs on every
 * boot once the pools load. It is idempotent and only writes when something
 * actually changed, so a converged device does no writes. Skips until the
 * pools have actually loaded. Returns the ids of runs whose stored values
 * changed so the caller can refresh open forms + advance edit stamps.
 */
export function applyPoolAwareSlotHealIfNeeded(
  serverCheeseNames: readonly string[],
  serverMixNames: readonly string[],
): string[] {
  if (typeof localStorage === "undefined") return [];
  if (serverCheeseNames.length === 0 && serverMixNames.length === 0) return [];
  const affectedRunIds: string[] = [];
  try {
    const pools = {
      cheese: buildPoolLookup(serverCheeseNames),
      mixes: buildPoolLookup(serverMixNames),
      allowlist: new Set(
        [
          "mix",
          "cheese",
          ...DEFAULT_INGREDIENT_TYPES,
          ...MIX_SEED.frontlineIngredients,
          ...loadList(PEP_TYPES_KEY, DEFAULT_PEP_TYPES),
        ].map((n) => n.toLowerCase()),
      ),
    };

    // ── Saved profiles (local mirror of the server profile pool) ──
    const bf = loadBrandFlavors();
    for (const [brand, flavors] of Object.entries(bf)) {
      for (const flavor of flavors) {
        const saved = loadProfile(brand, flavor);
        if (!saved) continue;
        const { values, changed } = healApplicatorSlotValues(
          saved as unknown as Record<string, unknown>,
          pools,
        );
        if (!changed) continue;
        // Targeted dough-blob write (NOT saveProfile — the loaded blob has no
        // crust fields, so saveProfile would clobber the crust profile).
        try {
          localStorage.setItem(PROFILE_KEY(brand, flavor), JSON.stringify(values));
          markProfileEdited(canonicalProfileKey(brand, flavor));
        } catch {}
      }
    }

    // ── Per-run values (v1 intentionally skipped these; the Type dropdown
    //    unions current values, so a stray name here keeps showing) ──
    const runPrefix = RUN_KEY("");
    const runKeys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(runPrefix)) runKeys.push(k);
    }
    for (const k of runKeys) {
      try {
        const raw = localStorage.getItem(k) ?? "null";
        const obj = JSON.parse(raw);
        if (!obj || typeof obj !== "object") continue;
        const { values, changed } = healApplicatorSlotValues(
          obj as Record<string, unknown>,
          pools,
        );
        if (!changed) continue;
        localStorage.setItem(k, JSON.stringify(values));
        affectedRunIds.push(k.slice(runPrefix.length));
      } catch {}
    }

    // ── Pool names that leaked into the shared Type dropdown list ──
    const ingredients = loadList(INGREDIENT_TYPES_KEY, DEFAULT_INGREDIENT_TYPES);
    const leaked = ingredients.filter(
      (n) =>
        !pools.allowlist.has(n.trim().toLowerCase()) &&
        (pools.cheese.has(n.trim().toLowerCase()) || pools.mixes.has(n.trim().toLowerCase())),
    );
    if (leaked.length) {
      saveList(INGREDIENT_TYPES_KEY, ingredients.filter((n) => !leaked.includes(n)));
      for (const n of leaked) tombstoneDeleted("ingredientTypes", n);
    }
  } catch {}
  return affectedRunIds;
}

/**
 * Re-type profile applicator slots after a cheese recipe is MOVED to Mixes
 * (the manager "Move to Mixes" action): every saved profile slot name-linked
 * to the moved recipe (app{n}CheeseRecipeName, case-insensitive) whose type is
 * "cheese" becomes the generic "Mix" type — the link name stays put, since Mix
 * slots use the same CheeseRecipeName link field (see mix-applicator-slots).
 * Also covers legacy slots whose TYPE cell holds the recipe name itself.
 * Targeted dough-blob writes + edit stamps (NOT saveProfile — the loaded blob
 * has no crust fields, so saveProfile would clobber the crust profile),
 * mirroring applyPoolAwareSlotHealIfNeeded. Returns how many profiles changed.
 */
export function relinkCheeseSlotsToMixInProfiles(recipeName: string): number {
  if (typeof localStorage === "undefined") return 0;
  const nameLc = recipeName.trim().toLowerCase();
  if (!nameLc) return 0;
  let relinked = 0;
  try {
    const bf = loadBrandFlavors();
    for (const [brand, flavors] of Object.entries(bf)) {
      for (const flavor of flavors) {
        const saved = loadProfile(brand, flavor);
        if (!saved) continue;
        const vals = saved as unknown as Record<string, unknown>;
        let changed = false;
        for (const n of [1, 2, 3, 4]) {
          const link = String(vals[`app${n}CheeseRecipeName`] ?? "").trim().toLowerCase();
          const type = String(vals[`app${n}Type`] ?? "").trim().toLowerCase();
          if (link === nameLc && type === "cheese") {
            vals[`app${n}Type`] = "Mix";
            changed = true;
          } else if (type === nameLc) {
            // Legacy slot: the recipe name sits in the TYPE cell directly.
            vals[`app${n}Type`] = "Mix";
            if (!link) vals[`app${n}CheeseRecipeName`] = recipeName.trim();
            changed = true;
          }
        }
        if (!changed) continue;
        try {
          localStorage.setItem(PROFILE_KEY(brand, flavor), JSON.stringify(vals));
          markProfileEdited(canonicalProfileKey(brand, flavor));
          relinked++;
        } catch {}
      }
    }
  } catch {}
  return relinked;
}

const DEDUPE_MIX_CHEESE_OVERLAP_KEY = "run-calc-dedupe-mix-cheese-overlap-v1";

// ── Server-driven data reset (replaces the old one-time local-wipe marker) ────
// A manager can clear all shared day-state from the server (POST /api/sync/reset),
// which bumps a per-scope "reset epoch". Every client tracks the last epoch it has
// honoured in localStorage; when the server epoch is higher (learned on boot via
// GET /api/sync/reset-epoch, or pushed live over SSE), the client wipes its local
// day-state and adopts the new epoch. This is the ONE reliable reset path — no
// constant to bump, no API downtime, and the PUT epoch guard stops a populated
// client from re-uploading its old copy through the additive live-sync union.
const RESET_EPOCH_KEY = "run-calc-reset-epoch";

/** The reset epoch this device has already honoured (0 if never reset). */
export function getStoredResetEpoch(): number {
  if (typeof localStorage === "undefined") return 0;
  try {
    const raw = localStorage.getItem(RESET_EPOCH_KEY);
    const n = raw == null ? 0 : parseInt(raw, 10);
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

/**
 * Apply a server data reset if the given server epoch is newer than what this
 * device has honoured. Wipes every `run-calc*` localStorage key (day-state,
 * profiles, master lists, migration markers) EXCEPT the epoch marker itself, so
 * the device starts fresh and can't re-upload its old copy. Records the new epoch
 * so it runs exactly once per reset. Returns true when a wipe happened (caller
 * should reload the app), false otherwise. Fail-safe: never throws.
 */
export function applyResetWipe(serverEpoch: number): boolean {
  if (typeof localStorage === "undefined") return false;
  if (!Number.isFinite(serverEpoch) || serverEpoch <= getStoredResetEpoch()) return false;
  try {
    const doomed: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith("run-calc") && k !== RESET_EPOCH_KEY) doomed.push(k);
    }
    for (const k of doomed) localStorage.removeItem(k);
    localStorage.setItem(RESET_EPOCH_KEY, String(serverEpoch));
    return true;
  } catch {
    return false;
  }
}

/**
 * One-time cleanup: recipe names that ended up in BOTH the Cheese and the Mix
 * recipe-name lists (spec imports seed cheese-mix names into `cheeseRecipeNames`
 * while migrations/user moves put the same names into `mixRecipeNames`). A name
 * the user keeps under Mixes is a mix, not a cheese recipe — drop the duplicate
 * Cheese entry so it stops showing up on the Merge tool's "Cheese mixes" tab
 * and in the Manage Cheese list. The Mix entry is kept; the removed Cheese
 * entry is tombstoned so the additive live-sync union can't resurrect it, and
 * any stale Mix tombstone is cleared so the kept name sticks. Preset rows are
 * untouched (cheese and mix share one preset map keyed by name). Runs once,
 * guarded by a version marker.
 */
export function applyMixCheeseOverlapDedupeIfNeeded(): void {
  if (typeof localStorage === "undefined") return;
  if (localStorage.getItem(DEDUPE_MIX_CHEESE_OVERLAP_KEY)) return;
  try {
    const cheese = loadList(CHEESE_RECIPE_NAMES_KEY, []);
    const mixSet = new Set(loadList(MIX_RECIPE_NAMES_KEY, []).map((n) => n.toLowerCase()));
    const dups = cheese.filter((n) => mixSet.has(n.toLowerCase()));
    if (dups.length === 0) {
      localStorage.setItem(DEDUPE_MIX_CHEESE_OVERLAP_KEY, "1");
      return;
    }
    saveList(CHEESE_RECIPE_NAMES_KEY, cheese.filter((n) => !dups.includes(n)));
    for (const n of dups) {
      tombstoneDeleted("cheeseRecipeNames", n);
      clearDeleted("mixRecipeNames", n);
    }
    localStorage.setItem(DEDUPE_MIX_CHEESE_OVERLAP_KEY, "1");
  } catch {}
}

/**
 * Delete every saved profile (dough + crust) for a brand. Called on brand
 * deletion: dropping the brand from the Brands list and tombstoning it is not
 * enough — the per-profile localStorage entries (`run-calc-profile-<brand>__*`
 * and `run-calc-crust-profile-<brand>__*`) used to linger. Those orphans were
 * re-broadcast on every sync (buildPushPayload scans ALL profile keys) and
 * resurrected stale/scrambled profile data (wrong die size, wrong recipes)
 * whenever the brand's deletion tombstone was later cleared by a re-add or
 * re-import. Purge them so a deleted brand fully disappears.
 */
export function deleteProfilesForBrand(brand: string): void {
  if (typeof localStorage === "undefined") return;
  const brandLc = brand.toLowerCase().trim();
  if (!brandLc) return;
  const doughPrefix = `run-calc-profile-${brandLc}__`;
  const crustPrefix = `run-calc-crust-profile-${brandLc}__`;
  const toRemove: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k) continue;
    if (k.startsWith(doughPrefix) || k.startsWith(crustPrefix)) toRemove.push(k);
  }
  const deletedKeys = new Set<string>();
  for (const k of toRemove) {
    try { localStorage.removeItem(k); } catch {}
    if (k.startsWith(doughPrefix)) deletedKeys.add(k.slice("run-calc-profile-".length));
    else deletedKeys.add(k.slice("run-calc-crust-profile-".length));
  }
  // Propagate to the factory-wide server pool so the deleted brand's profiles
  // disappear everywhere (and can't be re-adopted on the next reconcile).
  for (const key of deletedKeys) markProfileDeleted(key);
}

/**
 * Rewrite the saved `dieType` value on every profile (dough + crust) from
 * `oldName` to `newName`. Called on a die-type rename: without it,
 * healDieTypesFromProfiles re-adds the old name from a stale profile and
 * recreates the very duplicate the rename was meant to remove. Mirrors mobile,
 * which rewrites `dieType` on each brandProfiles entry.
 */
export function rewriteDieTypeInProfiles(oldName: string, newName: string): void {
  if (typeof localStorage === "undefined") return;
  const from = oldName.trim();
  const to = newName.trim();
  if (!from || !to || from === to) return;
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k || (!k.startsWith("run-calc-profile-") && !k.startsWith("run-calc-crust-profile-")))
      continue;
    try {
      const obj = JSON.parse(localStorage.getItem(k) ?? "null") as Record<string, unknown> | null;
      if (obj && typeof obj.dieType === "string" && obj.dieType.trim() === from) {
        obj.dieType = to;
        localStorage.setItem(k, JSON.stringify(obj));
        markProfileEdited(
          k.startsWith("run-calc-crust-profile-")
            ? k.slice("run-calc-crust-profile-".length)
            : k.slice("run-calc-profile-".length),
        );
      }
    } catch {
      // Skip an unreadable profile — never let one bad row block the rewrite.
    }
  }
}

/**
 * Rewrite pep type references (pep1Type, pep1TypeB, pep2Type, pep2TypeB) in all
 * saved profiles. Called on a pep-type merge so profiles don't re-introduce the
 * merged-away name next time they are applied.
 */
export function rewritePepTypeInProfiles(oldName: string, newName: string): void {
  if (typeof localStorage === "undefined") return;
  const from = oldName.trim();
  const to = newName.trim();
  if (!from || !to || from === to) return;
  const pepFields = ["pep1Type", "pep1TypeB", "pep2Type", "pep2TypeB"] as const;
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k || (!k.startsWith("run-calc-profile-") && !k.startsWith("run-calc-crust-profile-")))
      continue;
    try {
      const obj = JSON.parse(localStorage.getItem(k) ?? "null") as Record<string, unknown> | null;
      if (!obj) continue;
      let changed = false;
      for (const field of pepFields) {
        if (typeof obj[field] === "string" && (obj[field] as string).trim() === from) {
          obj[field] = to;
          changed = true;
        }
      }
      if (changed) {
        localStorage.setItem(k, JSON.stringify(obj));
        markProfileEdited(
          k.startsWith("run-calc-crust-profile-")
            ? k.slice("run-calc-crust-profile-".length)
            : k.slice("run-calc-profile-".length),
        );
      }
    } catch {
      // Skip an unreadable profile — never let one bad row block the rewrite.
    }
  }
}

/**
 * Rewrite applicator type references (app1Type–app4Type) in all saved profiles.
 * Called on an applicator-type merge so profiles don't re-introduce the
 * merged-away name next time they are applied.
 */
export function rewriteAppTypeInProfiles(oldName: string, newName: string): void {
  if (typeof localStorage === "undefined") return;
  const from = oldName.trim();
  const to = newName.trim();
  if (!from || !to || from === to) return;
  const appFields = ["app1Type", "app2Type", "app3Type", "app4Type"] as const;
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k || (!k.startsWith("run-calc-profile-") && !k.startsWith("run-calc-crust-profile-")))
      continue;
    try {
      const obj = JSON.parse(localStorage.getItem(k) ?? "null") as Record<string, unknown> | null;
      if (!obj) continue;
      let changed = false;
      for (const field of appFields) {
        if (typeof obj[field] === "string" && (obj[field] as string).trim() === from) {
          obj[field] = to;
          changed = true;
        }
      }
      if (changed) {
        localStorage.setItem(k, JSON.stringify(obj));
        markProfileEdited(
          k.startsWith("run-calc-crust-profile-")
            ? k.slice("run-calc-crust-profile-".length)
            : k.slice("run-calc-profile-".length),
        );
      }
    } catch {
      // Skip an unreadable profile — never let one bad row block the rewrite.
    }
  }
}

/**
 * Rewrite recipe name references in all saved profiles after a recipe is
 * renamed. Scans every dough and crust profile blob in localStorage and
 * rewrites the relevant name field(s) when they match the old name
 * (case-sensitive equality — names are stored as typed). Mirrors the
 * `rewriteDieTypeInProfiles` / `rewriteAppTypeInProfiles` pattern.
 *
 * `kind` controls which fields are checked:
 *   "dough"  → doughRecipeName
 *   "sauce"  → frontlineRecipeName
 *   "cheese" → app1–4CheeseRecipeName (each slot independently)
 */
export function rewriteRecipeNameInProfiles(
  kind: "dough" | "sauce" | "cheese",
  oldName: string,
  newName: string,
): void {
  if (typeof localStorage === "undefined") return;
  const from = oldName.trim();
  const to = newName.trim();
  if (!from || !to || from === to) return;
  const fields =
    kind === "dough"
      ? ["doughRecipeName"]
      : kind === "sauce"
        ? ["frontlineRecipeName"]
        : ["app1CheeseRecipeName", "app2CheeseRecipeName", "app3CheeseRecipeName", "app4CheeseRecipeName"];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k || (!k.startsWith("run-calc-profile-") && !k.startsWith("run-calc-crust-profile-")))
      continue;
    try {
      const obj = JSON.parse(localStorage.getItem(k) ?? "null") as Record<string, unknown> | null;
      if (!obj) continue;
      let changed = false;
      for (const field of fields) {
        if (typeof obj[field] === "string" && (obj[field] as string).trim() === from) {
          obj[field] = to;
          changed = true;
        }
      }
      if (changed) {
        localStorage.setItem(k, JSON.stringify(obj));
        markProfileEdited(
          k.startsWith("run-calc-crust-profile-")
            ? k.slice("run-calc-crust-profile-".length)
            : k.slice("run-calc-profile-".length),
        );
      }
    } catch {
      // Skip an unreadable profile — never let one bad row block the rewrite.
    }
  }
}

/**
 * Delete the saved profile (dough + crust) for a single brand+flavor. Called on
 * flavor deletion for the same reason as deleteProfilesForBrand: without it the
 * profile entry orphans and can resurrect stale data on a later re-import.
 */
export function deleteProfileEntry(brand: string, flavor: string): void {
  if (typeof localStorage === "undefined") return;
  try { localStorage.removeItem(PROFILE_KEY(brand, flavor)); } catch {}
  try { localStorage.removeItem(CRUST_PROFILE_KEY(brand, flavor)); } catch {}
  markProfileDeleted(canonicalProfileKey(brand, flavor));
}

const PURGE_ORPHANED_PROFILES_KEY = "run-calc-purge-orphaned-profiles-v1";

/**
 * One-time cleanup: remove saved brand/flavor profiles (dough + crust) whose
 * brand is no longer in the Brands list. Deleting a brand used to leave its
 * per-profile localStorage entries behind (see deleteProfilesForBrand); those
 * orphans were re-broadcast on every sync and could resurrect stale/scrambled
 * data. This heals installs that already accumulated orphans before the deletion
 * fix landed. Guarded by a version marker AND only runs once the Brands list is
 * populated, so a transient empty list (e.g. before seeds/sync) can't nuke every
 * profile. If the list is still empty the marker is left unset so it retries on
 * a later load.
 */
export function purgeOrphanedProfilesIfNeeded(): void {
  if (typeof localStorage === "undefined") return;
  if (localStorage.getItem(PURGE_ORPHANED_PROFILES_KEY)) return;
  try {
    const brands = loadList(BRANDS_KEY, []);
    if (brands.length === 0) return; // defer until brands are seeded/loaded
    const known = new Set(brands.map((b) => b.toLowerCase().trim()));
    const orphans: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k) continue;
      let rest: string | null = null;
      if (k.startsWith("run-calc-profile-")) rest = k.slice("run-calc-profile-".length);
      else if (k.startsWith("run-calc-crust-profile-")) rest = k.slice("run-calc-crust-profile-".length);
      if (rest === null) continue;
      const sep = rest.indexOf("__");
      if (sep < 0) continue;
      const brandLc = rest.slice(0, sep);
      if (!known.has(brandLc)) orphans.push(k);
    }
    const deletedKeys = new Set<string>();
    for (const k of orphans) {
      try { localStorage.removeItem(k); } catch {}
      if (k.startsWith("run-calc-crust-profile-")) deletedKeys.add(k.slice("run-calc-crust-profile-".length));
      else deletedKeys.add(k.slice("run-calc-profile-".length));
    }
    for (const key of deletedKeys) markProfileDeleted(key);
    localStorage.setItem(PURGE_ORPHANED_PROFILES_KEY, "1");
  } catch {}
}

/**
 * One-time spec-sheet reconciliation cleanup: delete duplicate BLANK brand/flavor
 * profiles (an empty twin left beside a populated one), rebuild a handful of
 * profiles that lost their recipe data using the values recovered from the
 * factory spec sheets, and drop any brand whose flavor list becomes empty after
 * the blank deletions. The concrete plan (delete pairs + rebuild overlays) lives
 * in @workspace/profile-cleanup so web and mobile apply exactly the same fix.
 *
 * Guarded by a version marker AND deferred until the Brands list is populated so
 * a transient empty list (before seeds/sync) can't be misread as "nothing to
 * keep". Deletions are tombstoned (per-flavor namespace + "brands") so the
 * additive live-sync union can't resurrect them from a stale peer; rebuilds
 * clear any stale tombstone so the healed profile sticks.
 */
export function applyProfileCleanupIfNeeded(): void {
  if (typeof localStorage === "undefined") return;
  if (localStorage.getItem(PROFILE_CLEANUP_MARKER)) return;
  try {
    const brands = loadList(BRANDS_KEY, []);
    if (brands.length === 0) return; // defer until brands are seeded/loaded

    const getProfile = (key: string): Record<string, unknown> | null => {
      const s = splitProfileKey(key);
      if (!s) return null;
      return loadRawProfile(s.brand, s.flavor);
    };
    const { deleteKeys, rebuildKeys } = planProfileCleanup(getProfile);

    // Compute brands to drop BEFORE mutating the flavor lists (uses the current
    // flavor lists + the delete keys to decide which brands empty out).
    const brandFlavors = loadBrandFlavors();
    const brandsToRemove = brandsToRemoveAfterDeletes(brandFlavors, deleteKeys);
    const removeBrandSet = new Set(brandsToRemove.map((b) => b.toLowerCase().trim()));

    // 1) Delete the duplicate blank profiles + tombstone each flavor.
    const delByBrand: Record<string, Set<string>> = {};
    for (const key of deleteKeys) {
      const s = splitProfileKey(key);
      if (!s) continue;
      deleteProfileEntry(s.brand, s.flavor);
      tombstoneDeleted(flavorNamespace(s.brand), s.flavor);
      (delByBrand[s.brand] ??= new Set()).add(s.flavor);
    }

    // 2) Strip the deleted flavors from each brand's flavor list.
    for (const [brandKey, flavors] of Object.entries(brandFlavors)) {
      const del = delByBrand[brandKey.toLowerCase().trim()];
      if (!del) continue;
      brandFlavors[brandKey] = flavors.filter((f) => !del.has(f.toLowerCase().trim()));
    }

    // 3) Remove brands whose flavor list emptied out (list + tombstone + profiles).
    if (brandsToRemove.length > 0) {
      const brandsList = loadList(BRANDS_KEY, []);
      saveList(
        BRANDS_KEY,
        brandsList.filter((b) => !removeBrandSet.has(b.toLowerCase().trim())),
      );
      for (const b of brandsToRemove) {
        tombstoneDeleted("brands", b);
        deleteProfilesForBrand(b);
        const matchKey = Object.keys(brandFlavors).find(
          (k) => k.toLowerCase().trim() === b.toLowerCase().trim(),
        );
        if (matchKey) delete brandFlavors[matchKey];
      }
    }
    saveBrandFlavors(brandFlavors);

    // 4) Rebuild the profiles that lost their recipe data.
    for (const key of rebuildKeys) {
      const s = splitProfileKey(key);
      if (!s) continue;
      const overlay = PROFILE_REBUILD_OVERLAYS[key];
      if (!overlay) continue;
      const base = loadProfile(s.brand, s.flavor) ?? { ...DEFAULT_VALUES };
      const merged = { ...base, ...overlay } as FormValues;
      const dough = PROFILE_REBUILD_DOUGHBALL_OZ[key];
      if (typeof dough === "number") {
        (merged as Record<string, unknown>).targetDoughballWeight = dough;
      }
      clearDeleted(flavorNamespace(s.brand), s.flavor);
      clearDeleted("brands", s.brand);
      saveProfile(s.brand, s.flavor, merged);
    }

    localStorage.setItem(PROFILE_CLEANUP_MARKER, "1");
  } catch {}
}

// ── Excel spec-sheet importer (user-facing) ──────────────────────────────────
//
// These power the user-facing Excel importer (web header menu → Import Spec
// Sheet). The pure logic — canonicalization, alias collection, new-vs-updated
// summary, prompt shaping — lives in @workspace/spec-import; this is the thin
// platform glue that reads the known canonical lists and writes profiles +
// recipe presets to localStorage. Apply semantics (per product): overwrite
// existing brand/flavor profiles + recipes and add brand-new ones automatically.
// Mirrors the mobile glue in artifacts/run-calculator-mobile/context (parity).

/** All known canonical name lists, supplied to ground the AI parse + fuzzy match. */
export function loadSpecImportKnown(): {
  brands: string[];
  flavorsByBrand: Record<string, string[]>;
  appTypes: string[];
  pepTypes: string[];
  cheeseIngredients: string[];
  doughIngredients: string[];
  sauceIngredients: string[];
  sauceNames: string[];
  dieTypes: string[];
  doughRecipes: string[];
  sauceRecipes: string[];
  cheeseRecipes: string[];
} {
  // Exclude names the user deliberately DELETED (tombstoned, un-delete stamp
  // not winning) from the match universe. Leaving them in lets the alias/
  // exact/fuzzy layers ground a renamed sheet's NEW flavor back onto a deleted
  // old one ("4 Cheese Meltdown" → deleted "FOUR CHEESE MELTDOWN"), so the
  // import lands under names the user can no longer see. An exact same-name
  // re-import still works: the name simply imports as "new" and applySpecImport
  // clears its tombstone.
  const deletedMap = loadDeletedItems();
  const flavorsByBrand: Record<string, string[]> = {};
  for (const [brand, flavors] of Object.entries(loadBrandFlavors())) {
    flavorsByBrand[brand] = dropDeleted(flavors ?? [], deletedMap, flavorNamespace(brand));
  }
  return {
    brands: dropDeleted(
      loadList(BRANDS_KEY, []).filter(b => !STALE_BRANDS.includes(b)),
      deletedMap,
      "brands",
    ),
    flavorsByBrand,
    appTypes: loadList(INGREDIENT_TYPES_KEY, DEFAULT_INGREDIENT_TYPES),
    pepTypes: loadList(PEP_TYPES_KEY, DEFAULT_PEP_TYPES)
      .map(t => PEP_TYPE_RENAMES[t] ?? t)
      .filter(t => !RETIRED_PEP_TYPES.includes(t)),
    cheeseIngredients: loadList(CHEESE_INGREDIENTS_KEY, DEFAULT_CHEESE_INGREDIENTS),
    doughIngredients: loadList(DOUGH_INGREDIENTS_KEY, DEFAULT_DOUGH_INGREDIENTS),
    sauceIngredients: loadList(FRONTLINE_INGREDIENTS_KEY, DEFAULT_FRONTLINE_INGREDIENTS),
    // Existing dough recipe names: the name list (all registered dough recipe
    // names) unioned with presets that have ingredient rows.
    doughNames: [
      ...new Set([
        ...loadList(DOUGH_RECIPE_NAMES_KEY, DEFAULT_DOUGH_RECIPE_NAMES),
        ...Object.keys(loadDoughRecipePresets()),
      ]),
    ],
    // Existing sauce/frontline recipe names: the selectable Sauce Recipe
    // options list (which carries ready-made sauce names like "BBQ Sauce")
    // unioned with the mixed-recipe preset names. Grounds a parsed profile's
    // sauceName so a sauce the factory already uses isn't false-flagged just
    // because this particular sheet doesn't spell it out.
    sauceNames: [
      ...new Set([
        ...loadList(FRONTLINE_RECIPE_NAMES_KEY, DEFAULT_FRONTLINE_RECIPE_NAMES),
        ...Object.keys(loadFrontlineRecipePresets()),
      ]),
    ],
    dieTypes: [...new Set([...DEFAULT_DIE_TYPES, ...loadList(DIE_TYPES_KEY, DEFAULT_DIE_TYPES)])],
    // Existing recipe names per kind: lets the server ground a paraphrased
    // recipe name back to the factory's existing recipe (update, not duplicate).
    doughRecipes: Object.keys(recipePresetMapForKind("dough")),
    sauceRecipes: Object.keys(recipePresetMapForKind("sauce")),
    cheeseRecipes: Object.keys(recipePresetMapForKind("cheese")),
  };
}

/** True when a brand+flavor already has a stored profile with real data. */
export function profileExistsForImport(brand: string, flavor: string): boolean {
  return profileHasRealData(brand, flavor);
}

function recipePresetMapForKind(kind: ParsedRecipe["kind"]): Record<string, RecipeRow[]> {
  if (kind === "dough") {
    const presets = loadDoughRecipePresets();
    const out: Record<string, RecipeRow[]> = {};
    for (const [name, p] of Object.entries(presets)) out[name] = p.rows;
    return out;
  }
  if (kind === "sauce") return loadFrontlineRecipePresets();
  return loadCheeseRecipePresets();
}

/** True when a dough/sauce/cheese recipe already exists in the library by name. */
export function recipeExistsForImport(kind: ParsedRecipe["kind"], name: string): boolean {
  const map = recipePresetMapForKind(kind);
  const lower = name.trim().toLowerCase();
  return Object.keys(map).some(k => k.trim().toLowerCase() === lower);
}

/**
 * Existing recipe names the import review can offer as a "use my existing recipe"
 * link for a given display kind. Only names that ACTUALLY have saved ingredient
 * rows are returned (so linking always points at a real recipe): dough/sauce read
 * their own preset maps; cheese and mix share the cheese preset map but are split
 * by which NAME list the name lives in, so a mix row never offers a cheese recipe
 * and vice versa.
 */
export function existingRecipeNamesForImport(kind: SpecImportDisplayKind): string[] {
  const sortNames = (xs: string[]) => [...xs].sort((a, b) => a.localeCompare(b));
  if (kind === "dough") {
    const p = loadDoughRecipePresets();
    return sortNames(Object.keys(p).filter(k => (p[k]?.rows?.length ?? 0) > 0));
  }
  if (kind === "sauce") {
    const p = loadFrontlineRecipePresets();
    return sortNames(Object.keys(p).filter(k => (p[k]?.length ?? 0) > 0));
  }
  const cheesePresets = loadCheeseRecipePresets();
  const cheeseKeysLower = new Set(
    Object.keys(cheesePresets)
      .filter(k => (cheesePresets[k]?.length ?? 0) > 0)
      .map(k => k.trim().toLowerCase()),
  );
  const nameList = loadList(kind === "mix" ? MIX_RECIPE_NAMES_KEY : CHEESE_RECIPE_NAMES_KEY, []);
  return sortNames(nameList.filter(n => cheeseKeysLower.has(n.trim().toLowerCase())));
}

/** The existing ingredient rows of a saved recipe (case-insensitive lookup). */
function existingRecipeRowsForImport(kind: ParsedRecipe["kind"], name: string): RecipeRow[] {
  const map = recipePresetMapForKind(kind);
  const lower = name.trim().toLowerCase();
  const key = Object.keys(map).find(k => k.trim().toLowerCase() === lower);
  return key ? map[key] : [];
}

/** Existing die-type options the import review can offer as a reuse target. */
export function existingDieTypesForImport(): string[] {
  return [...new Set([...DEFAULT_DIE_TYPES, ...loadList(DIE_TYPES_KEY, DEFAULT_DIE_TYPES)])].sort(
    (a, b) => a.localeCompare(b),
  );
}

/**
 * Recover die types referenced by saved brand/flavor profiles into the selectable
 * master list (DIE_TYPES_KEY). A spec/recipe import writes each profile's `dieType`
 * VALUE, but the run form's Die Type picker only lists DIE_TYPES_KEY — and with the
 * built-in defaults now empty, a data reset can leave the picker blank even though
 * profiles still name a die. Union those names back in (case-insensitive, keeping
 * each name's existing spelling) while honoring explicit deletions (deletedItems
 * "dieTypes") so a die the user removed is never resurrected. `extra` lets callers
 * fold in die types found on live runs. Mirrors mobile, which unions imported die
 * types into its master list. Returns the effective master list.
 *
 * `scanProfileDieTypes` is the raw profile scan (no de-dupe); the server-pool
 * reconcile also uses it so a die a profile still names is always offered by
 * the picker even after the pool became server-backed.
 */
export function scanProfileDieTypes(): string[] {
  const raw: string[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      // dieType normally lives in the main profile object (run-calc-profile-*),
      // but scan crust profiles (run-calc-crust-profile-*) too so legacy/mixed
      // saves are still recovered.
      if (!k || (!k.startsWith("run-calc-profile-") && !k.startsWith("run-calc-crust-profile-")))
        continue;
      try {
        const obj = JSON.parse(localStorage.getItem(k) ?? "null") as Record<string, unknown> | null;
        const dt = obj && typeof obj.dieType === "string" ? obj.dieType.trim() : "";
        if (dt) raw.push(dt);
      } catch {
        // Skip an unreadable profile — never let one bad row block the heal.
      }
    }
  } catch {
    // localStorage unavailable (SSR / privacy mode) — nothing to heal from.
  }
  return raw;
}

export function healDieTypesFromProfiles(extra: string[] = []): string[] {
  const stored = loadList(DIE_TYPES_KEY, DEFAULT_DIE_TYPES);
  const raw: string[] = [];
  for (const name of [...stored, ...extra]) {
    const t = (name ?? "").trim();
    if (t) raw.push(t);
  }
  raw.push(...scanProfileDieTypes());
  // Fold variant spellings onto their canonical die name, then de-dupe
  // case-insensitively (keep the first spelling seen).
  const seen = new Set<string>();
  const canon: string[] = [];
  for (const name of raw) {
    const renamed = canonicalDieTypeName(name);
    const lower = renamed.toLowerCase();
    if (seen.has(lower)) continue;
    seen.add(lower);
    canon.push(renamed);
  }
  const allowed = dropDeleted(canon, loadDeletedItems(), "dieTypes").sort((a, b) => a.localeCompare(b));
  // Persist only when the effective list actually changed (avoid needless writes).
  if (JSON.stringify(allowed) !== JSON.stringify(stored)) saveList(DIE_TYPES_KEY, allowed);
  return allowed;
}

/**
 * Self-heal an editable packaging option list (circles / shipper / skid-stacking
 * / grip-sheets) the same way die types heal from profiles. Mirrors
 * healDieTypesFromProfiles but is generic over the list:
 *  - Seeds the built-in defaults ONCE (when the key has never been written), so
 *    the options that already worked are present out of the box. After that the
 *    list is fully user-owned (add/remove), so a removed option stays removed.
 *  - Re-adds any value still referenced by a saved profile (import/save may set a
 *    profile's field without touching the master list), then honors deletion
 *    tombstones so a removed option is never resurrected.
 * Dedupes case-insensitively (first spelling wins), sorts, and persists only on
 * change. Namespace matches the sync payload field name.
 */
export function healPackagingFromProfiles(
  key: string,
  defaults: string[],
  field: string,
  namespace: string,
): string[] {
  // Seed defaults exactly once; thereafter read the user-owned stored list.
  const seeded = localStorage.getItem(key) === null;
  const stored = seeded ? [...defaults] : loadList(key, defaults);
  if (seeded) saveList(key, stored);
  const raw: string[] = [];
  for (const name of stored) {
    const t = (name ?? "").trim();
    if (t) raw.push(t);
  }
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || (!k.startsWith("run-calc-profile-") && !k.startsWith("run-calc-crust-profile-")))
        continue;
      try {
        const obj = JSON.parse(localStorage.getItem(k) ?? "null") as Record<string, unknown> | null;
        const val = obj && typeof obj[field] === "string" ? (obj[field] as string).trim() : "";
        if (val) raw.push(val);
      } catch {
        // Skip an unreadable profile — never let one bad row block the heal.
      }
    }
  } catch {
    // localStorage unavailable (SSR / privacy mode) — nothing to heal from.
  }
  const seen = new Set<string>();
  const canon: string[] = [];
  for (const name of raw) {
    const lower = name.toLowerCase();
    if (seen.has(lower)) continue;
    seen.add(lower);
    canon.push(name);
  }
  const allowed = dropDeleted(canon, loadDeletedItems(), namespace).sort((a, b) => a.localeCompare(b));
  if (JSON.stringify(allowed) !== JSON.stringify(stored)) saveList(key, allowed);
  return allowed;
}

/**
 * Whether a spec-import must SKIP a brand+flavor profile. Always false: a prior
 * delete/merge only protects against live-sync resurrection, never against a
 * deliberate re-import (see body). Kept as a predicate so partitionTombstonedParse
 * keeps a stable signature; deleted brand/flavors now simply re-import.
 */
export function importProfileIsTombstoned(_brand: string, _flavor: string): boolean {
  // A prior brand/flavor DELETION must NOT suppress a deliberate re-import.
  //
  // Deletion tombstones (the structured deletedItems map, namespaces "brands" /
  // "flavor:<brand>") exist to stop live-sync's additive union from RESURRECTING
  // a name a user removed on another device — i.e. they protect against RESYNC,
  // not against a fresh RE-IMPORT. When the user re-imports a spec sheet they are
  // explicitly asking for those profiles back, and applySpecImport clears the
  // tombstone as it re-applies each profile so the reintroduction sticks.
  //
  // Brand/flavor MERGES land in the SAME deletedItems namespaces (never the flat
  // mergedAway set, which holds only ingredient/app/pep merges), so there is no
  // separate "merged brand/flavor" signal to distinguish and check here. An
  // imported profile is therefore never skipped — deleted ones simply come back.
  return false;
}

// The deletion-tombstone namespace for each recipe kind's name list (matches the
// namespaces used by applyRecipeNameMerge / the sync-receive preset-key drop).
const RECIPE_KIND_DELETE_NAMESPACE: Record<ParsedRecipe["kind"], string> = {
  dough: "doughRecipeNames",
  sauce: "frontlineRecipeNames",
  cheese: "cheeseRecipeNames",
};

/**
 * Whether a spec-import must SKIP a dough/sauce/cheese recipe NAME. Always false
 * (except a blank name, trivially): a prior delete/merge only protects against
 * live-sync resurrection, never a deliberate re-import (see body). Kept as a
 * predicate so partitionTombstonedParse keeps a stable signature.
 */
export function recipeNameIsTombstoned(_kind: ParsedRecipe["kind"], name: string): boolean {
  if (!name.trim()) return false;
  // A prior recipe DELETE must NOT block a re-import (the deletion tombstone
  // protects live-sync resurrection only, and applySpecImport clears it as the
  // recipe re-applies). Recipe MERGES are indistinguishable from deletes — both
  // land in the per-kind deletion namespace, NOT the flat mergedAway set (which
  // is written ONLY by ingredient/app/pep merges, see applyIngredientMerge). So
  // there is no reliable recipe-merge signal to check, and consulting mergedAway
  // would only FALSE-suppress a recipe whose name collides with a merged
  // ingredient (e.g. "Pepperoni"). An imported recipe is therefore never skipped.
  return false;
}

function ingredientKeyForKind(kind: ParsedRecipe["kind"]): { key: string; defaults: string[] } {
  if (kind === "dough") return { key: DOUGH_INGREDIENTS_KEY, defaults: DEFAULT_DOUGH_INGREDIENTS };
  if (kind === "sauce") return { key: FRONTLINE_INGREDIENTS_KEY, defaults: DEFAULT_FRONTLINE_INGREDIENTS };
  return { key: CHEESE_INGREDIENTS_KEY, defaults: DEFAULT_CHEESE_INGREDIENTS };
}

/**
 * Whether a spec-sheet CHEESE-kind recipe is really a MIX and should register
 * its name under the Mixes category instead of Cheese. The AI importer only
 * knows dough/sauce/cheese, so pre-blended topping mixes ("White Fajita Mix",
 * "Garlic Chicken Mix") arrive as `kind: "cheese"` — routing happens here at
 * apply time. A name that mentions "cheese" NEVER routes to mix — a past
 * misroute can leave a cheese blend duplicated into the Mixes pool, and
 * honoring that junk entry would flip the blend to "Mix" forever (an explicit
 * review-time forcedCategory override still wins upstream). Otherwise a name
 * is a mix when the user already keeps it in the Mix list, or when it contains
 * the standalone word "mix" (the same split applyStrayMixRecategorizeIfNeeded
 * uses) AND it actually blends 2+ ingredients — a single-ingredient table is
 * not a mix no matter what its label says, so it stays under Cheese. Everything
 * else — ingredient rows, the shared cheese/mix preset map, and the
 * applicator-slot profile tie — is identical for both categories, so only the
 * NAME list (and its tombstone namespace) differs.
 */
// Ingredient names that mark a component as cheese(-adjacent). Cellulose is
// the anti-caking agent cheese blends carry, so it counts. Word-bounded so
// "blue" doesn't match "Blueberry". Mirrors @workspace/spec-import's copy —
// the heuristic is deliberately duplicated (this apply path must work
// offline/test without the lib's parse machinery); change BOTH together.
const CHEESEISH_INGREDIENT_RE =
  /\b(?:cheese|mozz|mozzarella|provolone|cheddar|parm|parmesan|romano|asiago|fontina|feta|ricotta|gouda|muenster|monterey|jack|brick|gorgonzola|pecorino|queso|cotija|oaxaca|asadero|havarti|swiss|curd|cellulose)\b/i;

export function specImportCheeseRecipeIsMix(
  name: string,
  userMixNamesLower: ReadonlySet<string>,
  ingredientCount: number,
  componentNames?: ReadonlyArray<string>,
): boolean {
  const t = name.trim().toLowerCase();
  if (!t) return false;
  if (/cheese/i.test(t)) return false;
  if (userMixNamesLower.has(t)) return true;
  if (ingredientCount >= 2 && /\b(mix|blend)\b/.test(t)) return true;
  // No mix/blend word, but the components themselves say "not cheese": a
  // multi-ingredient blend with no cheese-ish ingredient defaults to Mix
  // ("Italian Beef & Gravy"). Default only — forcedCategory wins upstream.
  if (componentNames && ingredientCount >= 2) {
    const named = componentNames.map((n) => n.trim()).filter(Boolean);
    if (named.length >= 2 && !named.some((n) => CHEESEISH_INGREDIENT_RE.test(n))) {
      return true;
    }
  }
  return false;
}

/** Kind shown in the import review UI: the three parse kinds plus "mix". */
export type SpecImportDisplayKind = ParsedRecipe["kind"] | "mix";

/**
 * The category the import review should DISPLAY for a parsed recipe: the parse
 * kind, except cheese-kind recipes that would route to the Mixes category at
 * apply time (explicit user override first, then the same heuristic
 * applySpecImport uses) show as "mix" so the selector reflects what will
 * actually happen on commit.
 */
export function specImportRecipeDisplayKind(r: ParsedRecipe): SpecImportDisplayKind {
  if (r.kind !== "cheese") return r.kind;
  if (r.forcedCategory === "mix") return "mix";
  if (r.forcedCategory === "cheese") return "cheese";
  // A user-typed rename never re-categorizes: the word heuristic is unreliable
  // on a name the user chose ("My Special Blend 2" is still a cheese recipe).
  if (r.userNamed) return "cheese";
  const userMixNamesLower = new Set(loadList(MIX_RECIPE_NAMES_KEY, []).map((n) => n.toLowerCase()));
  return specImportCheeseRecipeIsMix(
    r.name ?? "",
    userMixNamesLower,
    r.rows?.length ?? 0,
    (r.rows ?? []).map((row) => row.ingredient ?? ""),
  )
    ? "mix"
    : "cheese";
}

/**
 * Apply a (already-canonicalized) parsed spec-sheet import to local storage.
 * Profiles and recipes overwrite existing entries of the same brand+flavor /
 * name and add new ones; option lists are additively merged so every new
 * brand/flavor/type/ingredient/recipe name becomes selectable. Best-effort and
 * fail-safe: a malformed entry is skipped rather than aborting the whole import.
 */
// A dough/sauce recipe NAME a spec sheet put onto a profile with no actual
// mixing recipe anywhere to back it (no recipe in the import, no local preset).
// Without a pool entry the name is invisible under Manage Lists → Dough/Sauce
// Recipes, so the caller creates an empty-components placeholder in the server
// pool (see commitSpecImport) that the manager fills in later.
export type SpecImportRecipePlaceholder = {
  kind: "dough" | "sauce";
  name: string;
  brand: string;
  flavor: string;
};

/**
 * A dough/sauce recipe from the SERVER pool, passed into applySpecImport by
 * the commit glue (which fetched the live pools for its relink/placeholder
 * passes anyway). Shape mirrors @workspace/named-recipes' NamedRecipe fields
 * used here, kept structural so storage.ts stays free of that dependency.
 */
export type SpecImportServerPoolRecipe = {
  name: string;
  components: RecipeRow[];
  doughballWeightOz?: number;
  doughballsPerTray?: number;
  /** Dough only: per-customer variant list (label/weightOz/perTray). */
  doughballVariants?: unknown;
};

export function applySpecImport(
  parsed: ParsedSpecImport,
  out?: { recipePlaceholders?: SpecImportRecipePlaceholder[] },
  serverPools?: {
    dough?: SpecImportServerPoolRecipe[];
    sauce?: SpecImportServerPoolRecipe[];
  },
  /**
   * Manager-stored per-die line-setting overrides (Manage Lists → Die
   * Defaults), fetched by the commit glue. Used to blank-fill line settings
   * from the imported die type; overrides win over the built-in map. Optional
   * and best-effort — when absent the built-in map still applies.
   */
  dieLineDefaultOverrides?: DieLineDefaultsOverrides,
  /**
   * Set of profile keys (`"${brand.toLowerCase()}\u0000${flavor.toLowerCase()}"`)
   * for which blank-fill guards are BYPASSED — the sheet's dough name, sauce name,
   * and doughball weight overwrite whatever is currently stored. Used by the
   * step-2 "Force update" toggle to let a manager correct a previously bad import
   * without hunting through the recipe manager.
   */
  forceUpdateProfileKeys?: ReadonlySet<string>,
): { touchedProfiles: Array<{ brand: string; flavor: string }>; crustProfiles: Array<{ brand: string; flavor: string }> } {
  if (typeof localStorage === "undefined") return { touchedProfiles: [], crustProfiles: [] };

  // Matches a purchased pre-made crust product name (Bonici/Pedone/pinsa etc.).
  // Mirrors the PURCHASED_CRUST_NAME_RE / INHOUSE_CRUST_NAME_RE pair from
  // @workspace/spec-import's stripPurchasedCrustDie — kept in sync manually.
  const IMPORTED_PURCHASED_CRUST_RE = /\bcrusts?\b/i;
  const IMPORTED_INHOUSE_CRUST_RE = /\b(?:doughs?|recipes?|dies?)\b/i;

  // ── Server-pool lookups (dough/sauce master-data lives server-side) ──
  // Local presets only mirror recipes this device saved; a profile can point
  // at a pool recipe (e.g. "CRB Dough") this device has never touched. The
  // commit glue passes the freshly fetched pools so name snapping and row
  // hydration below see the same universe the placeholder suppression does.
  // Best-effort: when the pools are absent (offline / test), everything falls
  // back to local-preset behavior.
  const poolFor = (kind: "dough" | "sauce"): SpecImportServerPoolRecipe[] =>
    (kind === "dough" ? serverPools?.dough : serverPools?.sauce) ?? [];
  const poolEntryFor = (
    kind: "dough" | "sauce",
    name: string,
  ): SpecImportServerPoolRecipe | undefined =>
    poolFor(kind).find((r) => specImportNamedRecipeNamesEqual(r.name, name));
  // Snap a spec-named dough/sauce onto the EXISTING pool spelling: exact
  // (loose-equal) match first, then the family match ("11\" CRB recipe" →
  // "CRB Dough"). Registering the raw spec name while suppression
  // family-matched it is exactly how phantom dropdown names were minted —
  // a name in the option list that no recipe anywhere backs.
  // A name backed by a recipe CARRIED BY THIS IMPORT must never family-snap
  // onto a pool recipe — the import brings its own (possibly different)
  // formula under that name ("Masa Dough (Lowes Natural)" next to the pool's
  // "Masa Dough"), and the link passes upstream already decided it stays
  // separate. Snapping here would re-point references at the wrong recipe.
  const importedRecipeKeys: Record<"dough" | "sauce", Set<string>> = {
    dough: new Set<string>(),
    sauce: new Set<string>(),
  };
  for (const r of parsed.recipes ?? []) {
    if (r.kind !== "dough" && r.kind !== "sauce") continue;
    const k = specImportNameMatchKey(r.name ?? "");
    if (k) importedRecipeKeys[r.kind].add(k);
  }
  const snapToPoolName = (kind: "dough" | "sauce", name: string): string => {
    const t = name.trim();
    if (!t) return t;
    const exact = poolEntryFor(kind, t);
    if (exact) return exact.name;
    if (importedRecipeKeys[kind].has(specImportNameMatchKey(t))) return t;
    const family = findSpecImportNamedRecipeFamilyMatch(
      kind,
      t,
      poolFor(kind).map((r) => r.name),
    );
    return family ?? t;
  };

  // ── Canonicalize parsed profile brands onto EXISTING brand spellings ──
  // A saved parse can carry a punctuation-typo brand (`Aldo"s` for the real
  // `Aldo's`) — the sanitizer now snaps these at parse time, but sheets saved
  // BEFORE that fix (and re-applied via the saved-sheet/hash-reuse path) still
  // hold the typo. Snap each profile brand onto the registry brand that shares
  // its loose brand key, so re-applying an old parse updates the real profile
  // instead of minting a near-duplicate brand. New brands (no key match) are
  // kept verbatim.
  {
    const knownByKey = new Map<string, string>();
    for (const b of Object.keys(loadBrandFlavors())) {
      const key = specImportBrandMatchKey(b);
      if (key && !knownByKey.has(key)) knownByKey.set(key, b);
    }
    const canonBrand = (raw: string): string => {
      const t = (raw ?? "").trim();
      if (!t) return t;
      const hit = knownByKey.get(specImportBrandMatchKey(t));
      return hit && hit.toLowerCase() !== t.toLowerCase() ? hit : t;
    };
    parsed = {
      ...parsed,
      profiles: (parsed.profiles ?? []).map((p) => {
        const brand = canonBrand(p.brand);
        return brand === p.brand ? p : { ...p, brand };
      }),
    };
  }

  // ── Un-tombstone anything the user chose to re-include ──
  // A profile/recipe reaching apply was explicitly kept in the review. If it had
  // been merged or deleted away, clear its tombstones so the reintroduction is
  // durable — otherwise live-sync's additive union would strip it right back out.
  // No-op when the name isn't tombstoned, so clearing unconditionally is safe.
  for (const p of parsed.profiles) {
    const brand = p.brand.trim();
    const flavor = p.flavor.trim();
    if (!brand || !flavor) continue;
    clearDeleted("brands", brand);
    clearDeleted(flavorNamespace(brand), flavor);
    clearMergedAway(brand);
    clearMergedAway(flavor);
  }
  // Cheese-kind recipes whose name is really a MIX register under the Mixes
  // category instead (see specImportCheeseRecipeIsMix) — decide once up front
  // so the tombstone-clear and the name-list registration below stay in step.
  const userMixNamesLower = new Set(loadList(MIX_RECIPE_NAMES_KEY, []).map((n) => n.toLowerCase()));
  const routesToMix = (r: ParsedRecipe): boolean => {
    if (r.kind !== "cheese") return false;
    // Explicit review-time override (the "mix"/"cheese" pick in the import
    // dialog's category selector) always wins over the name heuristic.
    if (r.forcedCategory === "mix") return true;
    if (r.forcedCategory === "cheese") return false;
    // A user-typed rename never re-categorizes (heuristic is unreliable on a
    // chosen name) — mirrors specImportRecipeDisplayKind.
    if (r.userNamed) return false;
    return specImportCheeseRecipeIsMix(
      r.name,
      userMixNamesLower,
      r.rows.length,
      r.rows.map((row) => row.ingredient ?? ""),
    );
  };

  for (const r of parsed.recipes) {
    // A reference-only recipe links to an EXISTING saved recipe (kept as-is), so
    // it neither registers a name nor needs a tombstone cleared.
    if (r.referenceOnly) continue;
    const name = r.name.trim();
    if (!name || r.rows.length === 0) continue;
    clearDeleted(routesToMix(r) ? "mixRecipeNames" : RECIPE_KIND_DELETE_NAMESPACE[r.kind], name);
    clearMergedAway(name);
  }

  // ── Recipe libraries (overwrite by name + register names/ingredients) ──
  const doughPresets = loadDoughRecipePresets();
  const saucePresets = loadFrontlineRecipePresets();
  const cheesePresets = loadCheeseRecipePresets();
  const newDoughIng: string[] = [];
  const newSauceIng: string[] = [];
  const newCheeseIng: string[] = [];
  const newDoughNames: string[] = [];
  const newSauceNames: string[] = [];
  const newCheeseNames: string[] = [];
  const newMixNames: string[] = [];

  for (const r of parsed.recipes) {
    // Reference-only recipes reuse a saved recipe untouched — never overwrite the
    // library or register the name/ingredients from this import.
    if (r.referenceOnly) continue;
    const name = r.name.trim();
    if (!name || r.rows.length === 0) continue;
    const rows = r.rows.map(row => ({ ingredient: row.ingredient, lbs: row.lbs }));
    if (r.kind === "dough") {
      // Keep the doughball weight with the preset: the import's value wins,
      // otherwise preserve any weight the preset already carried.
      const ballOz =
        r.doughballOz != null && r.doughballOz > 0
          ? r.doughballOz
          : doughPresets[name]?.doughballWeightOz;
      doughPresets[name] = ballOz && ballOz > 0 ? { rows, doughballWeightOz: ballOz } : { rows };
      newDoughNames.push(name);
      newDoughIng.push(...rows.map(x => x.ingredient));
    } else if (r.kind === "sauce") {
      saucePresets[name] = rows;
      newSauceNames.push(name);
      newSauceIng.push(...rows.map(x => x.ingredient));
    } else {
      // Mixes share the cheese preset map and ingredient pool; only the NAME
      // list differs (Mix category vs Cheese category).
      cheesePresets[name] = rows;
      (routesToMix(r) ? newMixNames : newCheeseNames).push(name);
      newCheeseIng.push(...rows.map(x => x.ingredient));
    }
  }

  saveDoughRecipePresets(doughPresets);
  saveFrontlineRecipePresets(saucePresets);
  saveCheeseRecipePresets(cheesePresets);

  if (newDoughNames.length) {
    saveList(DOUGH_RECIPE_NAMES_KEY, mergeListInsensitive(loadList(DOUGH_RECIPE_NAMES_KEY, DEFAULT_DOUGH_RECIPE_NAMES), newDoughNames).sort((a, b) => a.localeCompare(b)));
    saveList(ingredientKeyForKind("dough").key, mergeListInsensitive(loadList(DOUGH_INGREDIENTS_KEY, DEFAULT_DOUGH_INGREDIENTS), newDoughIng).sort((a, b) => a.localeCompare(b)));
  }
  if (newSauceNames.length) {
    saveList(FRONTLINE_RECIPE_NAMES_KEY, mergeListInsensitive(loadList(FRONTLINE_RECIPE_NAMES_KEY, DEFAULT_FRONTLINE_RECIPE_NAMES), newSauceNames).sort((a, b) => a.localeCompare(b)));
    saveList(ingredientKeyForKind("sauce").key, mergeListInsensitive(loadList(FRONTLINE_INGREDIENTS_KEY, DEFAULT_FRONTLINE_INGREDIENTS), newSauceIng).sort((a, b) => a.localeCompare(b)));
  }
  if (newCheeseNames.length) {
    saveList(CHEESE_RECIPE_NAMES_KEY, mergeListInsensitive(loadList(CHEESE_RECIPE_NAMES_KEY, []), newCheeseNames).sort((a, b) => a.localeCompare(b)));
  }
  if (newMixNames.length) {
    saveList(MIX_RECIPE_NAMES_KEY, mergeListInsensitive(loadList(MIX_RECIPE_NAMES_KEY, []), newMixNames).sort((a, b) => a.localeCompare(b)));
  }
  if (newCheeseIng.length) {
    saveList(ingredientKeyForKind("cheese").key, mergeListInsensitive(loadList(CHEESE_INGREDIENTS_KEY, DEFAULT_CHEESE_INGREDIENTS), newCheeseIng).sort((a, b) => a.localeCompare(b)));
  }

  // ── Profiles (overwrite spec fields, preserve unrelated fields) ──
  const bf = loadBrandFlavors();
  const newBrands: string[] = [];
  const newAppTypes: string[] = [];
  const newPepTypes: string[] = [];
  const profileSauceNames: string[] = [];
  const profileDoughNames: string[] = [];
  // Every profile this import writes to (applicator types and/or recipe ties) —
  // the post-loop cheese-mirror pass revisits each to fill any cheese applicator
  // left blank by a single-blend spec.
  const touchedProfiles = new Map<string, { brand: string; flavor: string }>();
  // Profiles identified as purchased-crust runs (no dieType + crust-named
  // doughName): the caller uses this to auto-switch the run's subTab to "crusts".
  const crustProfilesList: Array<{ brand: string; flavor: string }> = [];
  // Spec-named dough/sauce with no backing recipe anywhere — candidates for the
  // caller's empty-placeholder pool push (filtered against this import's
  // recipes and the local presets at the end of this function).
  const placeholderCandidates: SpecImportRecipePlaceholder[] = [];
  const markTouched = (brand: string, flavor: string): void => {
    if (!brand || !flavor) return;
    touchedProfiles.set(`${brand.toLowerCase()}\u0000${flavor.toLowerCase()}`, { brand, flavor });
  };

  function registerBrandFlavor(brand: string, flavor: string): void {
    if (!brand || !flavor) return;
    newBrands.push(brand);
    const list = bf[brand] ?? [];
    if (!list.some(f => f.toLowerCase() === flavor.toLowerCase())) bf[brand] = [...list, flavor];
  }

  // Every non-mix cheese-blend name the parse carries — used to detect which of
  // a profile's applicator slots are CHEESE (matched by loose key) so they render
  // the pick-only Cheese card instead of a raw blend name that never opens it.
  // ALSO union in the EXISTING cheese pool names (local mirror of the server
  // cheese_recipes pool): a spec-only workbook often names a blend the factory
  // already has, with no cheese recipe in the same file — without the pool the
  // resolver finds no candidate, the raw blend name stays as the applicator
  // type, and it leaks into the shared Type dropdown all over again.
  // NOTE: mixes share the cheese preset map (only the NAME list differs), so
  // the pool mirror's keys must be filtered against the Mix name list or mix
  // slots would be re-typed "cheese" here before the mix resolver ever runs.
  const mixNamesLowerNow = new Set(loadList(MIX_RECIPE_NAMES_KEY, []).map((n) => n.trim().toLowerCase()));
  const cheeseCandidateNames = [
    ...parsed.recipes
      .filter(r => r.kind === "cheese" && !routesToMix(r))
      .map(r => r.name),
    ...Object.keys(loadCheeseRecipePresets()).filter(
      (n) => !mixNamesLowerNow.has(n.toLowerCase()),
    ),
  ];
  // Every MIX-routed recipe name — the same treatment for mix applicator slots:
  // re-type them to the generic "Mix" and reference the pool recipe by name,
  // instead of leaking one raw ingredient-type entry per mix into the shared
  // Type dropdown (disconnected from the Mixes screen the recipe lives on).
  // Same pool union as cheese, for the same reason.
  const mixCandidateNames = [
    ...parsed.recipes
      .filter(r => r.kind === "cheese" && routesToMix(r))
      .map(r => r.name),
    ...loadList(MIX_RECIPE_NAMES_KEY, []),
  ];

  for (const p of parsed.profiles) {
    const brand = p.brand.trim();
    const flavor = p.flavor.trim();
    if (!brand || !flavor) continue;
    registerBrandFlavor(brand, flavor);
    markTouched(brand, flavor);
    // When the manager checked "Force update" for this profile in the step-2
    // review, bypass blank-fill guards below so the sheet's values OVERWRITE
    // whatever is stored (dough name, sauce name, doughball weight).
    const isForced =
      forceUpdateProfileKeys?.has(`${brand.toLowerCase()}\u0000${flavor.toLowerCase()}`) ??
      false;
    const values: FormValues = { ...DEFAULT_VALUES, ...(loadProfile(brand, flavor) ?? {}) };
    if (p.dieType) values.dieType = p.dieType;
    // Detect purchased-crust profiles (no die + crust-named doughName) so the
    // caller can auto-switch the run's Line Type to "Crust" instead of "Dough".
    // Uses the same pattern as stripPurchasedCrustDie in @workspace/spec-import.
    if (!p.dieType) {
      const rawDough = (p.doughName ?? "").trim();
      if (rawDough && IMPORTED_PURCHASED_CRUST_RE.test(rawDough) && !IMPORTED_INHOUSE_CRUST_RE.test(rawDough)) {
        crustProfilesList.push({ brand, flavor });
      }
    }
    // Allergen read from the spec sheet (egg/soy or any new allergen the sheet
    // named); already a normalized lower-case token from the parser. Present
    // only when the sheet designated one, so this never clobbers with "none".
    if (p.allergen) values.allergen = p.allergen;
    if (p.sauceOzPerPizza != null) values.sauceOzPerPizza = p.sauceOzPerPizza;
    // Case pack read from the sheet (how many pizzas per case). Only present when
    // the sheet stated a positive count, so this never clobbers with a default.
    if (p.pizzasPerCase != null && p.pizzasPerCase > 0) values.pizzasPerCase = p.pizzasPerCase;
    // Sauce barrel size — fallback only. When a mixed sauce recipe imports too,
    // the run form's recipe-driven effect zeroes this so the row-sum wins.
    if (p.sauceBarrelLbs != null && p.sauceBarrelLbs > 0) values.sauceBarrelLbs = p.sauceBarrelLbs;
    // Named bought/ready-made sauce (e.g. BBQ, Ranch): the sheet names the
    // sauce but there's no mixing recipe — record the name so needs/consumption
    // pull it as-is by name. Never clobber an existing mixed sauce recipe or a
    // name the user already set; a sauce-recipe tie later in this import still
    // overwrites (correctly) via the recipe apply loop below.
    const specSauceName = snapToPoolName("sauce", (p.sauceName ?? "").trim());
    if (specSauceName) {
      // Register the bought/ready-made sauce name as a selectable Sauce Recipe
      // option regardless of whether this profile keeps it — otherwise the name
      // only ever appears on the one profile and looks like it never imported.
      // (Collected separately: the newSauceNames list was already flushed to
      // storage before this loop runs.) Clear any delete/merge tombstone for
      // the name too, or the sync receive-side dropDeleted/dropMergedAway
      // filters would strip it right back out of the options list.
      profileSauceNames.push(specSauceName);
      clearDeleted("frontlineRecipeNames", specSauceName);
      clearMergedAway(specSauceName);
      placeholderCandidates.push({ kind: "sauce", name: specSauceName, brand, flavor });
    }
    const hasMixedSauce = (values.frontlineRecipe ?? []).some(r => Number(r.lbs ?? 0) > 0);
    // Update the sauce name when the spec carries one and it differs from what's
    // stored — the spec sheet is authoritative (covers first-import blanks AND
    // corrections of values that a previous bad import set incorrectly).
    // Mixed-sauce recipes always win over a bare name; the recipe-tie loop
    // below further overwrites with actual row data when available.
    if (specSauceName && !hasMixedSauce && (isForced || specSauceName !== (values.frontlineRecipeName ?? "").trim())) {
      values.frontlineRecipeName = specSauceName;
    }
    // The sheet may name a sauce whose recipe already exists in the library
    // (server pool mirror) without carrying the recipe itself — the recipe-tie
    // loop below only runs for recipes THIS import carries, so hydrate the
    // rows from the existing library here or the profile shows the name with
    // an empty recipe until the user reselects it. Never clobbers mixed rows.
    {
      const flName = (values.frontlineRecipeName ?? "").trim();
      if (flName && !(values.frontlineRecipe ?? []).some(r => Number(r.lbs ?? 0) > 0)) {
        // Local presets first, then the server pool — this device may never
        // have saved the pool recipe locally (pool is factory master-data).
        const rows = existingRecipeRowsForImport("sauce", flName);
        const poolRows = rows.length ? [] : (poolEntryFor("sauce", flName)?.components ?? []);
        const src = rows.length ? rows : poolRows;
        if (src.length) values.frontlineRecipe = src.map(r => ({ ...r }));
      }
    }
    // Named dough/crust from the spec sheet (e.g. "Ultra Thin Dough"): the
    // sheet names the dough but this workbook carries no dough mixing recipe —
    // record the TYPE now so the product is assigned its dough from day one,
    // and a later dough-recipe import re-links rows/weights onto every profile
    // pointing at this name (see the name-match pass in the tie loop below).
    // Never clobber an existing dough recipe or a name the user already set.
    const specDoughName = snapToPoolName("dough", (p.doughName ?? "").trim());
    if (specDoughName) {
      // Register the name as a selectable Dough Recipe option regardless of
      // whether this profile keeps it, and clear any delete/merge tombstone so
      // the sync receive-side filters don't strip it right back out.
      profileDoughNames.push(specDoughName);
      clearDeleted("doughRecipeNames", specDoughName);
      clearMergedAway(specDoughName);
      placeholderCandidates.push({ kind: "dough", name: specDoughName, brand, flavor });
    }
    const hasMixedDough = (values.doughRecipe ?? []).some(r => Number(r.lbs ?? 0) > 0);
    // Same principle as sauce above: spec sheet is authoritative for dough name.
    if (specDoughName && !hasMixedDough && (isForced || specDoughName !== (values.doughRecipeName ?? "").trim())) {
      values.doughRecipeName = specDoughName;
    }
    // Same library hydration for dough: an assigned dough name whose recipe
    // already exists gets its rows (and the doughball weight, when the profile
    // has none) attached now instead of waiting for a reselect.
    {
      const dName = (values.doughRecipeName ?? "").trim();
      if (dName && !(values.doughRecipe ?? []).some(r => Number(r.lbs ?? 0) > 0)) {
        // Local presets first, then the server pool — this device may never
        // have saved the pool recipe locally (pool is factory master-data).
        const rows = existingRecipeRowsForImport("dough", dName);
        const poolEntry = rows.length ? undefined : poolEntryFor("dough", dName);
        const src = rows.length ? rows : (poolEntry?.components ?? []);
        if (src.length) values.doughRecipe = src.map(r => ({ ...r }));
        const presets = loadDoughRecipePresets();
        const pKey = Object.keys(presets).find(k => k.trim().toLowerCase() === dName.toLowerCase());
        // Variant-aware pool numbers: a family recipe (CRB Dough) carries a
        // per-customer variant list, and its recipe-level weight/per-tray
        // belong to no particular customer. With multiple variants, only a
        // die-size match may pick one (mirrors the run form / Auto-Fill
        // planner); no match = hydrate nothing rather than a bogus number.
        const poolDough = poolEntryFor("dough", dName);
        const poolVariants = normalizeDoughballVariants(poolDough?.doughballVariants);
        const poolMatched = matchDoughballVariant(poolVariants, { dieType: values.dieType ?? "", brand, flavor });
        const poolWeight = poolMatched
          ? Number(poolMatched.weightOz ?? 0)
          : poolVariants.length > 1
            ? 0
            : Number(poolDough?.doughballWeightOz ?? 0);
        // Variant match wins over local preset root weight: a preset stores the
        // recipe-level (family) weight which is ambiguous for multi-variant
        // recipes; the matched variant is the authoritative per-customer answer.
        const w = (poolMatched && Number(poolMatched.weightOz ?? 0) > 0)
          ? Number(poolMatched.weightOz)
          : pKey
            ? Number(presets[pKey]?.doughballWeightOz ?? 0)
            : poolWeight;
        // Was this a high-confidence customers-based match (not a die-number
        // fallback)? A customers match is authoritative and may correct a
        // previously-set wrong value — e.g. a prior import assigned the wrong
        // variant before customer assignments were populated in the pool.
        const wMatchedViaCustomers =
          !!brand && poolMatched
            ? (poolMatched.customers ?? []).some(
                (c) =>
                  c.brand.trim().toLowerCase() === brand.trim().toLowerCase() &&
                  (c.flavor.trim() === "" ||
                    c.flavor.trim().toLowerCase() ===
                      (flavor ?? "").trim().toLowerCase()),
              )
            : false;
        const existingWeightOz = Number(values.targetDoughballWeight ?? 0);
        const existingMatchesVariant =
          !wMatchedViaCustomers || !poolMatched
            ? true
            : Math.abs(existingWeightOz - Number(poolMatched.weightOz ?? 0)) < 0.1;
        if (
          w > 0 &&
          (isForced || !(existingWeightOz > 0) || (wMatchedViaCustomers && !existingMatchesVariant))
        ) {
          values.targetDoughballWeight = w;
        }
        // Same pool hydration for doughballs-per-tray (local presets don't
        // carry it — it lives only on the server pool recipe).
        const perTray = poolMatched
          ? Number(poolMatched.perTray ?? 0)
          : poolVariants.length > 1
            ? 0
            : Number(poolDough?.doughballsPerTray ?? 0);
        if (perTray > 0 && !(Number(values.doughballsPerTray ?? 0) > 0)) {
          values.doughballsPerTray = perTray;
        }
      }
    }
    // Detect cheese applicator slots and re-type them to the literal "cheese"
    // (the run form's pick-only Cheese card gates on that exactly); the blend
    // name is recorded as the slot's cheese recipe name so it hydrates from the
    // server pool, and the recipe-tie loop below writes its rows.
    // Arrange applicators into their physical line stations first (the AI may
    // report an explicit slot when the sheet's layout shows a topping belongs
    // AFTER the pep applicators, i.e. on App 3/4); holes come back as
    // empty-type entries that the loop below skips.
    // The profile itself may already hold a generic-typed slot whose linked
    // recipe name exists in NEITHER this sheet NOR the pools (e.g. a mix the
    // factory never defined as a Mixes recipe — "Hot Giardiniera Mix"). Those
    // links must count as candidates too, or a re-import finds no match and
    // clobbers the generic "Mix"/"cheese" type back to the raw sheet name.
    // Pre-compute loose keys for all known mix names so profileLinkCandidates
    // can guard against feeding a mix recipe name into the cheese candidate list
    // — doing so creates a self-perpetuating cycle where a stale "cheese"-typed
    // slot re-stamps "cheese" on every re-import even though the recipe is a mix.
    const mixNamesLooseSet = new Set(mixCandidateNames.map(n => specImportNameMatchKey(n ?? "")));
    const profileLinkCandidates = (kind: "cheese" | "mix"): string[] => {
      const out: string[] = [];
      for (let slot = 1; slot <= 4; slot++) {
        const t = String((values as Record<string, unknown>)[`app${slot}Type`] ?? "").trim().toLowerCase();
        const link = String((values as Record<string, unknown>)[`app${slot}CheeseRecipeName`] ?? "").trim();
        if (!link || t !== kind) continue;
        // Never feed a mix recipe name into the cheese candidate list — that
        // creates a loop where a stale cheese-typed slot keeps re-stamping itself.
        if (kind === "cheese" && mixNamesLooseSet.has(specImportNameMatchKey(link))) continue;
        out.push(link);
      }
      return out;
    };
    const { applicators: cheeseResolvedApps, links: cheeseLinks } = resolveCheeseApplicatorSlots(
      assignApplicatorSlots(p.applicators),
      [...cheeseCandidateNames, ...profileLinkCandidates("cheese")],
      p.brand,
    );
    // Mix slots re-type to the literal "Mix" (the run form's Mix card + Mixes
    // pool picker); the recipe name is linked below just like cheese.
    const { applicators: resolvedApps, links: mixLinks } = resolveMixApplicatorSlots(
      cheeseResolvedApps,
      [...mixCandidateNames, ...profileLinkCandidates("mix")],
      p.brand,
    );
    resolvedApps.forEach((a, i) => {
      const slot = i + 1;
      const type = a.type.trim();
      if (!type) return;
      (values as Record<string, unknown>)[`app${slot}Type`] = type;
      (values as Record<string, unknown>)[`app${slot}OzPerPizza`] = a.ozPerPizza;
      // Batch size — fallback only; a cheese recipe on this slot zeroes it at
      // run time so the recipe row-sum wins.
      if (a.batchLbs != null && a.batchLbs > 0) {
        (values as Record<string, unknown>)[`app${slot}BatchLbs`] = a.batchLbs;
      }
      newAppTypes.push(type);
    });
    for (const link of cheeseLinks) {
      (values as Record<string, unknown>)[`app${link.slot}CheeseRecipeName`] = link.recipeName;
    }
    for (const link of mixLinks) {
      (values as Record<string, unknown>)[`app${link.slot}CheeseRecipeName`] = link.recipeName;
    }
    // Post-correct any stale "cheese"-typed slot whose linked recipe is actually
    // a mix (e.g. the profile predates mix-pool awareness, or a prior import ran
    // before the premix workbook was loaded). Switch to "Mix" so the run form
    // shows the Mix card rather than the cheese picker with a "not found" error.
    for (let slot = 1; slot <= 4; slot++) {
      const curType = String((values as Record<string, unknown>)[`app${slot}Type`] ?? "").trim().toLowerCase();
      const recipeName = String((values as Record<string, unknown>)[`app${slot}CheeseRecipeName`] ?? "").trim();
      if (curType === "cheese" && recipeName && mixNamesLooseSet.has(specImportNameMatchKey(recipeName))) {
        (values as Record<string, unknown>)[`app${slot}Type`] = "Mix";
      }
    }
    const namedPeps = p.pepperonis.slice(0, 2).filter(pp => pp.type.trim());
    namedPeps.forEach((pp, i) => {
      const slot = i + 1;
      const type = pp.type.trim();
      (values as Record<string, unknown>)[`pep${slot}Type`] = type;
      (values as Record<string, unknown>)[`pep${slot}Sticks`] = pp.sticks;
      (values as Record<string, unknown>)[`pep${slot}OzPerPizza`] = pp.ozPerPizza;
      if (pp.batchLbs != null && pp.batchLbs > 0) {
        (values as Record<string, unknown>)[`pep${slot}BatchLbs`] = pp.batchLbs;
      }
      newPepTypes.push(type);
    });
    // A spec sheet with 2+ distinct pep types means the two applicators run
    // different peps, so they can't be combined; a single pep defaults to
    // combined (checkbox checked). Only derived when this import actually
    // carries pep slots — a re-import whose peps were pruned as unchanged (see
    // pruneSpecImportAgainstSnapshot) must keep the user's current setting.
    if (namedPeps.length > 0) {
      (values as Record<string, unknown>).pep1Combined = namedPeps.length >= 2 ? false : true;
    }
    // Blank-fill line settings from the profile's die type, exactly like
    // picking the die on the run form / profile editor: manager-stored
    // overrides (Manage Lists → Die Defaults) win, built-in map second.
    // resolveDieLineDefaults only returns fields still at their untouched
    // defaults, so values a user (or prior import) already set are kept.
    const lineFills = resolveDieLineDefaults(
      values.dieType ?? "",
      values as Partial<Record<string, unknown>>,
      dieLineDefaultOverrides,
    );
    Object.assign(values as Record<string, unknown>, lineFills);
    saveProfile(brand, flavor, values);
  }

  if (profileSauceNames.length) {
    saveList(FRONTLINE_RECIPE_NAMES_KEY, mergeListInsensitive(loadList(FRONTLINE_RECIPE_NAMES_KEY, DEFAULT_FRONTLINE_RECIPE_NAMES), profileSauceNames).sort((a, b) => a.localeCompare(b)));
  }
  if (profileDoughNames.length) {
    saveList(DOUGH_RECIPE_NAMES_KEY, mergeListInsensitive(loadList(DOUGH_RECIPE_NAMES_KEY, DEFAULT_DOUGH_RECIPE_NAMES), profileDoughNames).sort((a, b) => a.localeCompare(b)));
  }

  // ── Tie recipes onto their profiles ──
  // Recipes attach by NAME only. The old brand/flavor apply-target resolution
  // (explicit sheet targets + same-brand fan-out) is retired — a procedure
  // sheet naming a brand must never blanket that brand's flavors. A dough or
  // sauce recipe ties onto every saved profile whose linked dough/sauce recipe
  // NAME loose-matches it; a cheese/mix blend ties onto every saved profile
  // with an applicator slot of the right type whose linked name loose-matches.
  // The import's own profiles were saved (and registered) by the profile loop
  // above — with the sheet's dough/sauce/slot names already assigned — so the
  // registry walk below covers them too.
  // A dough mixing sheet can carry MANY same-named per-customer variant rows.
  // Count them so a name-relinked tie can tell "the one CRB Dough row" apart
  // from "18 ambiguous variant rows" (see the weight-match guard below).
  const doughNameCounts = new Map<string, number>();
  for (const r of parsed.recipes) {
    if (r.kind !== "dough") continue;
    const k = specImportNameMatchKey((r.name ?? "").trim());
    if (k) doughNameCounts.set(k, (doughNameCounts.get(k) ?? 0) + 1);
  }
  for (const r of parsed.recipes) {
    // A cheese-kind recipe routed to the MIXES category (user's review pick or
    // the name heuristic) is factory master-data on the Mixes screen — it must
    // NOT be tied onto profiles as a cheese-applicator recipe, or the run's
    // Cheese card would show it as cheese despite the user's "mix" pick. It DOES
    // tie onto slots the profile loop re-typed to the generic "Mix" (name+rows),
    // handled in the mix branch below.
    const isMixRecipe = r.kind === "cheese" && routesToMix(r);
    // Reference-only recipes tie the user's EXISTING saved recipe onto the
    // import's profiles — pull its rows fresh from the library (never r.rows).
    // If the saved recipe is gone (stale/tampered pick), skip the tie entirely
    // rather than writing an empty recipe onto the profile.
    const sourceRows = r.referenceOnly
      ? existingRecipeRowsForImport(r.kind, r.name)
      : r.rows;
    if (r.referenceOnly && sourceRows.length === 0) continue;
    const rows = sourceRows.map(row => ({ ingredient: row.ingredient, lbs: row.lbs }));
    // ── Link by NAME (the only tie path) ──
    // A dough/sauce recipe ties onto every saved profile whose dough/sauce
    // recipe NAME matches this recipe by the loose key — an earlier spec
    // import may have assigned only the name (no recipe existed yet); when
    // the actual recipe arrives later, every product pointing at that name
    // gets its rows/weights (and the canonical spelling) attached. A
    // cheese/mix blend ties onto profiles via the applicator-slot scan below.
    let targets: { brand: string; flavor: string }[] = [];
    if (r.kind === "cheese") {
      // Cheese (and mix-routed) blends attach only where a profile's
      // applicator slot of the matching type is name-linked to this blend.
      // Blank slot names do NOT attract a recipe — that was brand-targeting's
      // job and it sprayed blends across unrelated products.
      const slotType = isMixRecipe ? "mix" : "cheese";
      const rKey = specImportNameMatchKey(
        r.userNamed ? r.name : cleanSpecCheeseRecipeName(r.name),
      );
      if (rKey) {
        for (const [brand, flavors] of Object.entries(loadBrandFlavors())) {
          for (const flavor of flavors ?? []) {
            const saved = loadProfile(brand, flavor) as Record<string, unknown> | null;
            if (!saved) continue;
            const linked = [1, 2, 3, 4].some(n => {
              if (String(saved[`app${n}Type`] ?? "").trim().toLowerCase() !== slotType) return false;
              const nm = String(saved[`app${n}CheeseRecipeName`] ?? "").trim();
              return !!nm && specImportNameMatchKey(cleanSpecCheeseRecipeName(nm)) === rKey;
            });
            if (linked) targets.push({ brand, flavor });
          }
        }
      }
    }
    // Same-sheet tie: a pizza spec sheet parses its recipes WITH the profile
    // they sit on (each recipe carries that sheet's own brand/flavor). That
    // single explicit pairing is not brand targeting — tie onto the import's
    // OWN parsed profile so it gets the recipe at import time. Restricted to
    // parsed.profiles: a standalone procedure workbook naming customers never
    // reaches here as a same-sheet profile.
    {
      const rb = (r.brand ?? "").trim().toLowerCase();
      const rf = (r.flavor ?? "").trim().toLowerCase();
      if (rb && rf) {
        const own = parsed.profiles.find(
          p => p.brand.trim().toLowerCase() === rb && p.flavor.trim().toLowerCase() === rf,
        );
        if (own) {
          const seenT = new Set(targets.map(t => `${t.brand.toLowerCase()}\u0000${t.flavor.toLowerCase()}`));
          if (!seenT.has(`${own.brand.trim().toLowerCase()}\u0000${own.flavor.trim().toLowerCase()}`)) {
            targets.push({ brand: own.brand.trim(), flavor: own.flavor.trim() });
          }
        }
      }
    }
    // Profiles tied on by the NAME re-link below (rather than the recipe's own
    // explicit spec targets). One dough family serves many flavors with
    // DIFFERENT doughball weights / per-tray counts, and a re-import can carry
    // several same-named family variants — a name-relinked profile must only
    // have those values backfilled when blank, never overwritten by whichever
    // variant happens to be processed last.
    const nameRelinked = new Set<string>();
    if (r.kind === "dough" || r.kind === "sauce") {
      const nameField = r.kind === "dough" ? "doughRecipeName" : "frontlineRecipeName";
      const rNameKey = specImportNameMatchKey(r.name);
      if (rNameKey) {
        const seen = new Set(targets.map(t => `${t.brand.toLowerCase()}\u0000${t.flavor.toLowerCase()}`));
        for (const [brand, flavors] of Object.entries(loadBrandFlavors())) {
          for (const flavor of flavors ?? []) {
            const key = `${brand.toLowerCase()}\u0000${flavor.toLowerCase()}`;
            if (seen.has(key)) continue;
            const saved = loadProfile(brand, flavor);
            if (!saved) continue;
            const nm = String((saved as Record<string, unknown>)[nameField] ?? "").trim();
            // Typo/possessive-tolerant: the spec sheet may say "Aldo's Sauce"
            // while the sauce procedure names "ALDO PIZZA SAUCE" — one loose-key
            // character apart, and a strict compare left the profile pointing at
            // a name no recipe would ever carry.
            if (!nm || !specImportNamedRecipeNamesEqual(nm, r.name)) continue;
            seen.add(key);
            nameRelinked.add(key);
            targets.push({ brand, flavor });
          }
        }
      }
      // Dough/sauce procedure sheets list which customers use the recipe — but
      // that must never CREATE brands. Untouched, those "targets" registered
      // whole new brand/flavor entries in the shared registry (a dough batch
      // import once minted 4 stray brands) whose profiles then failed the
      // ghost-profile guard anyway. Tie only onto brand/flavors that already
      // exist (registry walk above, this import's own profiles, or an existing
      // registry entry under a possessive-tolerant brand match).
      // Canonicalize to the EXISTING spelling too — a target that only
      // loose-matches ("Aldo" vs registry "Aldo's") must tie onto the saved
      // brand/flavor, not mint a near-duplicate brand key from its raw text.
      const known = new Map<string, { brand: string; flavor: string }>();
      const note = (brand: string, flavor: string): void => {
        const b = brand.trim();
        const f = flavor.trim();
        if (!b || !f) return;
        const key = `${specImportBrandMatchKey(b)}\u0000${f.toLowerCase()}`;
        if (!known.has(key)) known.set(key, { brand: b, flavor: f });
      };
      for (const [brand, flavors] of Object.entries(loadBrandFlavors())) {
        for (const flavor of flavors ?? []) note(brand, flavor);
      }
      for (const p of parsed.profiles) note(p.brand, p.flavor);
      const canonTargets: typeof targets = [];
      const canonSeen = new Set<string>();
      for (const t of targets) {
        const canon = known.get(`${specImportBrandMatchKey(t.brand)}\u0000${t.flavor.trim().toLowerCase()}`);
        if (!canon) continue;
        const key = `${canon.brand.toLowerCase()}\u0000${canon.flavor.toLowerCase()}`;
        if (canonSeen.has(key)) continue;
        canonSeen.add(key);
        canonTargets.push(canon);
      }
      targets = canonTargets;
    }
    for (const { brand, flavor } of targets) {
      if (isMixRecipe) {
        // Fill the profile's "Mix" applicator slot(s) that reference this mix
        // (matched by loose name key, or still blank). No legacy slot fallback:
        // a mix with no Mix slot on the profile lives only on the Mixes screen.
        // Skip entirely (no register/touch/save) when nothing matches so a
        // mix-only import never creates or rewrites unrelated profiles.
        const existing = loadProfile(brand, flavor);
        if (!existing) continue;
        const rec = { ...DEFAULT_VALUES, ...existing } as FormValues;
        const rKey = specImportNameMatchKey(
          r.userNamed ? r.name : cleanSpecCheeseRecipeName(r.name),
        );
        const mixSlots = [1, 2, 3, 4].filter(
          n => String((rec as Record<string, unknown>)[`app${n}Type`] ?? "").trim().toLowerCase() === "mix",
        );
        const matched = mixSlots.filter(n => {
          const nm = String((rec as Record<string, unknown>)[`app${n}CheeseRecipeName`] ?? "").trim();
          return !nm || specImportNameMatchKey(cleanSpecCheeseRecipeName(nm)) === rKey;
        });
        if (matched.length === 0) continue;
        registerBrandFlavor(brand, flavor);
        markTouched(brand, flavor);
        for (const slot of matched) {
          (rec as Record<string, unknown>)[`app${slot}CheeseRecipeName`] = r.name;
          (rec as Record<string, unknown>)[`app${slot}CheeseRecipe`] = rows;
        }
        saveProfile(brand, flavor, rec);
        continue;
      }
      registerBrandFlavor(brand, flavor);
      markTouched(brand, flavor);
      const values: FormValues = { ...DEFAULT_VALUES, ...(loadProfile(brand, flavor) ?? {}) };
      if (r.kind === "dough") {
        values.doughRecipeName = r.name;
        values.doughRecipe = rows;
        // Weight/per-tray are PER-FLAVOR: only this recipe's own explicit spec
        // targets take its values verbatim; a profile tied on by the name
        // re-link keeps its existing values (backfill blank fields only).
        const relinked = nameRelinked.has(`${brand.toLowerCase()}\u0000${flavor.toLowerCase()}`);
        // Relink-only tie onto a sheet with MULTIPLE same-named variant rows:
        // the doughball numbers are per-customer and ambiguous — blank-backfill
        // would let whichever variant row is processed FIRST win (e.g. Costco's
        // 20/tray written onto a Corner Booth 24/tray profile). Only the row
        // whose doughball weight equals the profile's known weight may
        // contribute; with no known weight, write no doughball numbers at all.
        const variantAmbiguous =
          relinked &&
          (doughNameCounts.get(specImportNameMatchKey((r.name ?? "").trim())) ?? 0) > 1;
        if (variantAmbiguous) {
          const wt = Number(values.targetDoughballWeight ?? 0);
          const rowMatches =
            wt > 0 && r.doughballOz != null && Math.abs(Number(r.doughballOz) - wt) <= 0.005;
          if (!rowMatches) {
            saveProfile(brand, flavor, values);
            continue;
          }
        }
        if (r.doughballOz != null && (!relinked || !(Number(values.targetDoughballWeight ?? 0) > 0))) {
          values.targetDoughballWeight = r.doughballOz;
        }
        // Crusts-per-batch yield — fallback only; when the dough rows + doughball
        // weight are both present the run form derives the yield and zeroes this.
        // Per-variant like weight/per-tray: relinked ties backfill blanks only.
        if (
          r.doughBatchYield != null && r.doughBatchYield > 0 &&
          (!relinked || !(Number(values.doughBatchYield ?? 0) > 0))
        ) {
          values.doughBatchYield = r.doughBatchYield;
        }
        if (
          r.doughballsPerTray != null && r.doughballsPerTray > 0 &&
          (!relinked || !(Number(values.doughballsPerTray ?? 0) > 0))
        ) {
          values.doughballsPerTray = r.doughballsPerTray;
        }
      } else if (r.kind === "sauce") {
        values.frontlineRecipeName = r.name;
        values.frontlineRecipe = rows;
      } else {
        // Place the cheese blend on the applicator slot(s) it actually belongs to.
        // The profile loop already re-typed real cheese applicators to "cheese"
        // (slots 2 & 4 for a two-cheese product); write this blend's rows to every
        // cheese slot whose name matches (or is still blank). Only fall back to the
        // legacy r.app/slot-1 guess when the profile has NO cheese applicator at all
        // (e.g. a standalone cheese sheet with no applicator grid).
        // A user-typed rename is used verbatim — never re-cleaned at tie time.
        const rKey = specImportNameMatchKey(
          r.userNamed ? r.name : cleanSpecCheeseRecipeName(r.name),
        );
        const cheeseSlots = [1, 2, 3, 4].filter(
          n => String((values as Record<string, unknown>)[`app${n}Type`] ?? "").trim().toLowerCase() === "cheese",
        );
        const matched = cheeseSlots.filter(n => {
          const nm = String((values as Record<string, unknown>)[`app${n}CheeseRecipeName`] ?? "").trim();
          return !nm || specImportNameMatchKey(cleanSpecCheeseRecipeName(nm)) === rKey;
        });
        const targetSlots = matched.length
          ? matched
          : cheeseSlots.length
            ? []
            : [r.app != null && r.app >= 1 && r.app <= 4 ? r.app : 1];
        const cleanName = r.userNamed
          ? r.name
          : cleanSpecCheeseRecipeName(r.name) || r.name;
        for (const slot of targetSlots) {
          (values as Record<string, unknown>)[`app${slot}CheeseRecipeName`] = cleanName;
          (values as Record<string, unknown>)[`app${slot}CheeseRecipe`] = rows;
        }
      }
      saveProfile(brand, flavor, values);
    }
  }

  // ── Mirror a single cheese blend across multiple cheese applicators ──
  // A product can run two "Cheese" applicators on the SAME blend at different
  // per-pizza weights (weight lives on the applicator). The spec then defines
  // the blend once and the tie loop above fills only one slot, leaving the other
  // cheese applicator blank. Fill those blanks from the lone blend so both
  // stations show the recipe (no-op when 2+ distinct blends — user resolves).
  for (const { brand, flavor } of touchedProfiles.values()) {
    const saved = loadProfile(brand, flavor);
    if (!saved) continue;
    const values: FormValues = { ...DEFAULT_VALUES, ...saved };
    const rec = values as Record<string, unknown>;
    const slots = [1, 2, 3, 4].map((n) => ({
      type: String(rec[`app${n}Type`] ?? ""),
      cheeseRecipeName: String(rec[`app${n}CheeseRecipeName`] ?? ""),
      cheeseRecipe: (rec[`app${n}CheeseRecipe`] as RecipeRow[] | undefined) ?? [],
    }));
    const mirrored = mirrorSingleCheeseAcrossApplicators(slots);
    if (mirrored === slots) continue;
    mirrored.forEach((s, i) => {
      rec[`app${i + 1}CheeseRecipeName`] = s.cheeseRecipeName;
      rec[`app${i + 1}CheeseRecipe`] = s.cheeseRecipe;
    });
    saveProfile(brand, flavor, values);
  }

  // ── Register brands/flavors + new option-list entries ──
  if (newBrands.length) {
    saveList(BRANDS_KEY, mergeListInsensitive(loadList(BRANDS_KEY, []), newBrands).sort((a, b) => a.localeCompare(b)));
    saveBrandFlavors(bf);
  }
  if (newAppTypes.length) {
    saveList(INGREDIENT_TYPES_KEY, mergeListInsensitive(loadList(INGREDIENT_TYPES_KEY, DEFAULT_INGREDIENT_TYPES), newAppTypes).sort((a, b) => a.localeCompare(b)));
  }
  if (newPepTypes.length) {
    saveList(PEP_TYPES_KEY, mergeListInsensitive(loadList(PEP_TYPES_KEY, DEFAULT_PEP_TYPES), newPepTypes));
  }

  // Spec-named dough/sauce with NO backing recipe: not in this import (any
  // non-reference recipe of the kind that loose-matches counts, even one this
  // apply skipped for having no rows) and not among the local presets. These
  // are reported to the caller, which creates empty-components placeholder
  // entries in the server pool so the names show up under Manage Lists →
  // Dough/Sauce Recipes instead of existing only on the profile.
  if (out && placeholderCandidates.length) {
    const doughPresetKeys = Object.keys(loadDoughRecipePresets());
    const saucePresetKeys = Object.keys(loadFrontlineRecipePresets());
    const backed = (c: SpecImportRecipePlaceholder): boolean => {
      for (const r of parsed.recipes) {
        if (r.referenceOnly) continue;
        if (r.kind !== c.kind) continue;
        if (specImportNamedRecipeNamesEqual(r.name, c.name)) return true;
      }
      const presets = c.kind === "dough" ? doughPresetKeys : saucePresetKeys;
      return presets.some((k) => specImportNamedRecipeNamesEqual(k, c.name));
    };
    out.recipePlaceholders = placeholderCandidates.filter((c) => !backed(c));
  }

  // Every brand+flavor profile this import wrote (spec fields and/or recipe
  // ties). The caller uses this to reload any OPEN run form for a touched
  // profile — otherwise the stale form re-saves the pre-import values over the
  // freshly imported profile on the next navigation/autosave (the "re-imported
  // my specs but nothing changed" clobber).
  return { touchedProfiles: [...touchedProfiles.values()], crustProfiles: crustProfilesList };
}

/** Re-export so the importer glue can pass the alias type through to clients. */
export type { SpecImportAlias };
