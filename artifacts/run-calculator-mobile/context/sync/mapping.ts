// Bidirectional mapping between the mobile app's local state shape and the web
// app's `SyncPayload` contract. All functions here are pure.
//
// Key reconciliations (mobile <-> web):
//   - lineSpeedPPM        <-> approxLineSpeed
//   - doughballWeightOz   <-> targetDoughballWeight
//   - run.progress.*      <-> folded into runValues[id] (WebFormValues)
//   - run.progress.subTab <-> RunMeta.subTab
//   - settings.{brand,flavor,notes}/run.stoppages <-> RunMeta.*
//   - Stoppage shapes differ (incompatible `type` enums) -> mapped, not raw.
//
// Mobile-only fields (doughBatchLbs, stopReasons, supervisorPin, autoTrack,
// mixRecipePresets, scheduled) stay local. Web-only payload fields (templates,
// history, presets, profiles, ingredientTypes, crustProfiles, mixIngredients,
// *RecipeNames) are preserved verbatim via raw-payload passthrough so neither
// platform clobbers the other.

import {
  DEFAULT_PROGRESS,
  DEFAULT_SETTINGS,
  renameIngredientList,
  renameIngredientSettings,
  renamePepList,
  renamePepSettings,
  todayStr,
  type RecipeRow,
  type RunProgress,
  type RunSettings,
  type RunState,
  type Stoppage,
} from "../RunContext";
import type {
  SyncPayload,
  WebFormValues,
  WebRecipeRow,
  WebRunMeta,
  WebStoppage,
} from "./payloadTypes";
import { normalizeAllergen } from "@workspace/allergen";
import type { IngredientSubstitution, SubstitutionLogEntry } from "@workspace/inventory-math";

// The slice of AppState that participates in sync.
export interface SyncableState {
  runs: RunState[];
  currentIndex: number;
  shiftNotes: string;
  runToTime: string;
  date: string;
  resetAt: number;
  brands: string[];
  brandFlavors: Record<string, string[]>;
  pepTypes: string[];
  dieTypes: string[];
  cheeseIngredients: string[];
  doughIngredients: string[];
  frontlineIngredients: string[];
  mergedAway: string[];
  deletedItems: Record<string, string[]>;
  substitutions: IngredientSubstitution[];
  substitutionLog: SubstitutionLogEntry[];
  stagedItems: Record<string, boolean>;
}

export type SyncableStatePatch = Partial<SyncableState>;

// ── Stoppage mapping ─────────────────────────────────────────────────────────

const MOBILE_STOP_LABEL: Record<Stoppage["type"], string> = {
  jam: "Equipment jam",
  changeover: "Changeover",
  break: "Break",
  other: "Other",
};

function mobileStoppageToWeb(s: Stoppage): WebStoppage {
  return {
    id: s.id,
    startedAt: s.startedAt,
    endedAt: s.endedAt,
    reason: s.reason && s.reason.trim() ? s.reason : MOBILE_STOP_LABEL[s.type],
    // Mobile "break" is a planned pause; everything else is an unplanned stop.
    type: s.type === "break" ? "pause" : "stop",
  };
}

function webStoppageToMobile(s: WebStoppage): Stoppage {
  return {
    id: s.id,
    startedAt: s.startedAt,
    endedAt: s.endedAt,
    reason: s.reason,
    type: s.type === "pause" ? "break" : "other",
  };
}

function cloneRows(rows: RecipeRow[] | WebRecipeRow[] | undefined): WebRecipeRow[] {
  return (rows ?? []).map((r) => ({ ingredient: r.ingredient, lbs: r.lbs }));
}

// ── Mobile run -> web (RunMeta + WebFormValues) ──────────────────────────────

// Serialize a mobile run to a web RunMeta. `rawMeta` is the prior remote meta
// for the same run id (if any); web-only fields the mobile app doesn't model
// (pausedAt, actualCases, wasteLbs, gapType, gapNote) are carried over from it
// so a mobile write doesn't clobber them.
export function runToMeta(run: RunState, rawMeta?: WebRunMeta): WebRunMeta {
  // Push the strongest lifecycle stamp we know of: our own (bumped on local
  // start/end/stoppage changes) or the last remote copy's. Carrying the remote
  // stamp forward on non-lifecycle pushes keeps them tied with the stored row,
  // so the server's tie→incoming rule still lets settings/notes edits through.
  const metaStamp = Math.max(run.metaUpdatedAt ?? 0, rawMeta?.metaUpdatedAt ?? 0);
  return {
    ...(rawMeta ?? {}),
    id: run.id,
    brand: run.settings.brand,
    flavor: run.settings.flavor,
    startedAt: run.startedAt,
    endedAt: run.endedAt,
    subTab: run.progress.subTab,
    notes: run.settings.notes,
    stoppages: (run.stoppages ?? []).map(mobileStoppageToWeb),
    ...(metaStamp > 0 ? { metaUpdatedAt: metaStamp } : {}),
  };
}

export function runToFormValues(run: RunState): WebFormValues {
  const s = run.settings;
  const p = run.progress;
  return {
    casesNeeded: s.casesNeeded,
    crustsPerCycle: s.crustsPerCycle,
    cycleSpeed: s.cycleSpeed,
    speedAdjustment: s.speedAdjustment,
    approxLineSpeed: s.lineSpeedPPM,
    freezerTime: s.freezerTime,
    pizzasPerCase: s.pizzasPerCase,
    casesPerSkid: s.casesPerSkid,
    casesPerLayer: s.casesPerLayer,
    doughballsPerTray: s.doughballsPerTray,
    crustsPerStack: s.crustsPerStack,
    doughBatchYield: s.doughBatchYield,
    crustsPerCase: s.crustsPerCase,
    skidsCompleted: p.skidsCompleted,
    casesOnCurrentSkid: p.casesOnCurrentSkid,
    traysOnLine: p.traysOnLine,
    batchesReady: p.batchesReady,
    carryOverDone: p.carryOverDone,
    sauceOzPerPizza: s.sauceOzPerPizza,
    sauceBarrelLbs: s.sauceBarrelLbs,
    app1OzPerPizza: s.app1OzPerPizza,
    app1BatchLbs: s.app1BatchLbs,
    app2OzPerPizza: s.app2OzPerPizza,
    app2BatchLbs: s.app2BatchLbs,
    app3OzPerPizza: s.app3OzPerPizza,
    app3BatchLbs: s.app3BatchLbs,
    app4OzPerPizza: s.app4OzPerPizza,
    app4BatchLbs: s.app4BatchLbs,
    pep1Sticks: s.pep1Sticks,
    pep1OzPerPizza: s.pep1OzPerPizza,
    pep1BatchLbs: s.pep1BatchLbs,
    pep2Sticks: s.pep2Sticks,
    pep2OzPerPizza: s.pep2OzPerPizza,
    pep2BatchLbs: s.pep2BatchLbs,
    app1Type: s.app1Type,
    app2Type: s.app2Type,
    app3Type: s.app3Type,
    app4Type: s.app4Type,
    pep1Type: s.pep1Type,
    pep2Type: s.pep2Type,
    dieType: s.dieType,
    doughRecipeName: s.doughRecipeName,
    targetDoughballWeight: s.doughballWeightOz,
    doughRecipe: cloneRows(s.doughRecipe),
    app1CheeseRecipeName: s.app1CheeseRecipeName,
    app1CheeseRecipe: cloneRows(s.app1CheeseRecipe),
    app2CheeseRecipeName: s.app2CheeseRecipeName,
    app2CheeseRecipe: cloneRows(s.app2CheeseRecipe),
    app3CheeseRecipeName: s.app3CheeseRecipeName,
    app3CheeseRecipe: cloneRows(s.app3CheeseRecipe),
    app4CheeseRecipeName: s.app4CheeseRecipeName,
    app4CheeseRecipe: cloneRows(s.app4CheeseRecipe),
    frontlineRecipeName: s.frontlineRecipeName,
    frontlineRecipe: cloneRows(s.frontlineRecipe),
    cartoned: s.cartoned,
    cartonsPerCase: s.cartonsPerCase,
    circles: s.circles,
    shipper: s.shipper,
    skidStacking: s.skidStacking,
    gripSheets: s.gripSheets,
    slipSheets: s.slipSheets,
    allergen: s.allergen,
  };
}

// ── Web (RunMeta + WebFormValues) -> mobile run ──────────────────────────────

function num(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function str(v: unknown, fallback: string): string {
  return typeof v === "string" ? v : fallback;
}

function rows(v: unknown): RecipeRow[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((r): r is WebRecipeRow => !!r && typeof r === "object")
    .map((r) => ({ ingredient: str(r.ingredient, ""), lbs: num(r.lbs, 0) }));
}

// Builds mobile RunSettings from a web FormValues, preserving mobile-only fields
// (e.g. doughBatchLbs) from the previous run's settings when present.
export function formValuesToSettings(
  fv: WebFormValues | undefined,
  meta: WebRunMeta,
  prev: RunSettings | undefined,
): RunSettings {
  const base = prev ?? DEFAULT_SETTINGS;
  const v = (fv ?? {}) as Partial<WebFormValues>;
  return renameIngredientSettings(renamePepSettings({
    ...base,
    brand: str(meta.brand, base.brand),
    flavor: str(meta.flavor, base.flavor),
    notes: meta.notes !== undefined ? str(meta.notes, base.notes) : base.notes,
    dieType: str(v.dieType, base.dieType),
    casesNeeded: num(v.casesNeeded, base.casesNeeded),
    pizzasPerCase: num(v.pizzasPerCase, base.pizzasPerCase),
    casesPerSkid: num(v.casesPerSkid, base.casesPerSkid),
    casesPerLayer: num(v.casesPerLayer, base.casesPerLayer),
    lineSpeedPPM: num(v.approxLineSpeed, base.lineSpeedPPM),
    crustsPerCycle: num(v.crustsPerCycle, base.crustsPerCycle),
    cycleSpeed: num(v.cycleSpeed, base.cycleSpeed),
    speedAdjustment: num(v.speedAdjustment, base.speedAdjustment),
    freezerTime: num(v.freezerTime, base.freezerTime),
    sauceOzPerPizza: num(v.sauceOzPerPizza, base.sauceOzPerPizza),
    sauceBarrelLbs: num(v.sauceBarrelLbs, base.sauceBarrelLbs),
    app1Type: str(v.app1Type, base.app1Type),
    app1OzPerPizza: num(v.app1OzPerPizza, base.app1OzPerPizza),
    app1BatchLbs: num(v.app1BatchLbs, base.app1BatchLbs),
    app2Type: str(v.app2Type, base.app2Type),
    app2OzPerPizza: num(v.app2OzPerPizza, base.app2OzPerPizza),
    app2BatchLbs: num(v.app2BatchLbs, base.app2BatchLbs),
    app3Type: str(v.app3Type, base.app3Type),
    app3OzPerPizza: num(v.app3OzPerPizza, base.app3OzPerPizza),
    app3BatchLbs: num(v.app3BatchLbs, base.app3BatchLbs),
    app4Type: str(v.app4Type, base.app4Type),
    app4OzPerPizza: num(v.app4OzPerPizza, base.app4OzPerPizza),
    app4BatchLbs: num(v.app4BatchLbs, base.app4BatchLbs),
    pep1Type: str(v.pep1Type, base.pep1Type),
    pep1OzPerPizza: num(v.pep1OzPerPizza, base.pep1OzPerPizza),
    pep1Sticks: num(v.pep1Sticks, base.pep1Sticks),
    pep1BatchLbs: num(v.pep1BatchLbs, base.pep1BatchLbs),
    pep2Type: str(v.pep2Type, base.pep2Type),
    pep2OzPerPizza: num(v.pep2OzPerPizza, base.pep2OzPerPizza),
    pep2Sticks: num(v.pep2Sticks, base.pep2Sticks),
    pep2BatchLbs: num(v.pep2BatchLbs, base.pep2BatchLbs),
    // doughBatchLbs is mobile-only; preserved from base.
    doughballWeightOz: num(v.targetDoughballWeight, base.doughballWeightOz),
    doughballsPerTray: num(v.doughballsPerTray, base.doughballsPerTray),
    crustsPerStack: num(v.crustsPerStack, base.crustsPerStack),
    crustsPerCase: num(v.crustsPerCase, base.crustsPerCase),
    doughBatchYield: num(v.doughBatchYield, base.doughBatchYield),
    doughRecipeName: str(v.doughRecipeName, base.doughRecipeName),
    doughRecipe: v.doughRecipe !== undefined ? rows(v.doughRecipe) : base.doughRecipe,
    app1CheeseRecipeName: str(v.app1CheeseRecipeName, base.app1CheeseRecipeName),
    app1CheeseRecipe: v.app1CheeseRecipe !== undefined ? rows(v.app1CheeseRecipe) : base.app1CheeseRecipe,
    app2CheeseRecipeName: str(v.app2CheeseRecipeName, base.app2CheeseRecipeName),
    app2CheeseRecipe: v.app2CheeseRecipe !== undefined ? rows(v.app2CheeseRecipe) : base.app2CheeseRecipe,
    app3CheeseRecipeName: str(v.app3CheeseRecipeName, base.app3CheeseRecipeName),
    app3CheeseRecipe: v.app3CheeseRecipe !== undefined ? rows(v.app3CheeseRecipe) : base.app3CheeseRecipe,
    app4CheeseRecipeName: str(v.app4CheeseRecipeName, base.app4CheeseRecipeName),
    app4CheeseRecipe: v.app4CheeseRecipe !== undefined ? rows(v.app4CheeseRecipe) : base.app4CheeseRecipe,
    frontlineRecipeName: str(v.frontlineRecipeName, base.frontlineRecipeName),
    frontlineRecipe: v.frontlineRecipe !== undefined ? rows(v.frontlineRecipe) : base.frontlineRecipe,
    cartoned: str(v.cartoned, base.cartoned),
    cartonsPerCase: num(v.cartonsPerCase, base.cartonsPerCase),
    circles: str(v.circles, base.circles),
    shipper: str(v.shipper, base.shipper),
    skidStacking: str(v.skidStacking, base.skidStacking),
    gripSheets: str(v.gripSheets, base.gripSheets),
    slipSheets: str(v.slipSheets, base.slipSheets),
    allergen: normalizeAllergen(v.allergen),
  }));
}

function formValuesToProgress(
  fv: WebFormValues | undefined,
  meta: WebRunMeta,
  prev: RunProgress | undefined,
): RunProgress {
  const base = prev ?? DEFAULT_PROGRESS;
  const v = (fv ?? {}) as Partial<WebFormValues>;
  return {
    skidsCompleted: num(v.skidsCompleted, base.skidsCompleted),
    casesOnCurrentSkid: num(v.casesOnCurrentSkid, base.casesOnCurrentSkid),
    traysOnLine: num(v.traysOnLine, base.traysOnLine),
    batchesReady: num(v.batchesReady, base.batchesReady),
    carryOverDone: typeof v.carryOverDone === "boolean" ? v.carryOverDone : base.carryOverDone,
    subTab: meta.subTab ?? base.subTab,
  };
}

function metaToRun(
  meta: WebRunMeta,
  fv: WebFormValues | undefined,
  prev: RunState | undefined,
): RunState {
  return {
    id: meta.id,
    settings: formValuesToSettings(fv, meta, prev?.settings),
    progress: formValuesToProgress(fv, meta, prev?.progress),
    stoppages: (Array.isArray(meta.stoppages) ? meta.stoppages : [])
      .filter((s): s is WebStoppage => !!s && typeof s === "object")
      .map(webStoppageToMobile),
    startedAt: meta.startedAt,
    endedAt: meta.endedAt,
    isRunning: !!meta.startedAt && !meta.endedAt && !meta.pausedAt,
    metaUpdatedAt:
      typeof meta.metaUpdatedAt === "number" ? meta.metaUpdatedAt : undefined,
  };
}

// ── Full state <-> payload ───────────────────────────────────────────────────

export function appStateToPayload(
  state: SyncableState,
  lastRaw: SyncPayload | null,
  // Per-run edit timestamps. Passed ONLY when building the payload to actually
  // PUT/broadcast; omitted everywhere a stable signature is needed (echo/no-op
  // detection) so timestamps never perturb the signature. Defaults to {} so the
  // signature path is constant.
  runValuesUpdatedAt: Record<string, number> = {},
): SyncPayload {
  const rawMetaById = new Map<string, WebRunMeta>(
    (lastRaw?.dayState?.runs ?? []).map((m) => [m.id, m]),
  );
  const runs = state.runs.map((run) => runToMeta(run, rawMetaById.get(run.id)));
  const runValues: Record<string, WebFormValues> = {};
  for (const run of state.runs) runValues[run.id] = runToFormValues(run);

  // Spread the last remote payload first so web-only fields survive; then
  // override the fields mobile owns.
  return {
    ...(lastRaw ?? {}),
    dayState: {
      runs,
      shiftNotes: state.shiftNotes,
      runToTime: state.runToTime,
      resetAt: state.resetAt,
      date: todayStr(),
      substitutions: state.substitutions ?? [],
      substitutionLog: state.substitutionLog ?? [],
      stagedItems: state.stagedItems ?? {},
    },
    runValues,
    runValuesUpdatedAt,
    brands: state.brands,
    brandFlavors: state.brandFlavors,
    pepTypes: state.pepTypes,
    dieTypes: state.dieTypes,
    cheeseIngredients: state.cheeseIngredients,
    doughIngredients: state.doughIngredients,
    frontlineIngredients: state.frontlineIngredients,
    mergedAway: state.mergedAway ?? [],
    deletedItems: state.deletedItems ?? {},
  };
}

// Per-run edit attribution: given the current per-run form-value strings, the
// last-seen baseline, and whether a baseline has been established yet ("primed"),
// stamp `now` for any run whose value is new-or-changed and return the updated
// timestamp map. Before priming (the very first snapshot after load) nothing is
// stamped — otherwise every loaded/imported run would look like a fresh local
// edit. This is the mobile analogue of the web autosave's markRunValuesUpdated;
// callers own the baseline ref (lastVals) and the primed flag. Pure + importable.
export function diffStampRunEdits(
  nextValStrings: Record<string, string>,
  lastVals: Record<string, string>,
  primed: boolean,
  now: number,
  currentUpdatedAt: Record<string, number>,
  emptyValString?: string,
): { updatedAt: Record<string, number>; stamped: boolean } {
  if (!primed) return { updatedAt: currentUpdatedAt, stamped: false };
  let updatedAt = currentUpdatedAt;
  let stamped = false;
  for (const [id, s] of Object.entries(nextValStrings)) {
    if (lastVals[id] !== s) {
      // Never stamp a run whose serialized value is the all-default/empty run.
      // Mirrors the web autosave, which never stamps an all-DEFAULT form: such a
      // value is always a programmatic reset (rollover, sync-apply echo, init
      // race), never a genuine simultaneous clear of every field. Stamping it
      // would mint a FRESH edit time that wins the per-run lost-update guard on
      // every peer and clobber real run data on the shared day-state row (the
      // recurring "I entered it, waited, refreshed, and it vanished" loss).
      if (emptyValString !== undefined && s === emptyValString) continue;
      updatedAt = { ...updatedAt, [id]: now };
      stamped = true;
    }
  }
  return { updatedAt, stamped };
}

// Namespace for a brand's flavor list in the deletion-tombstone map. Must match
// the web app's `flavorNamespace` exactly so deletions cross-sync.
export function flavorNamespace(brand: string): string {
  return `flavor:${String(brand).trim().toLowerCase()}`;
}

// Union two deletion-tombstone maps (case-insensitive, per namespace). Mirrors
// web's unionDeletedItems.
function unionDeletedItems(
  local: Record<string, string[]>,
  remote: unknown,
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [ns, names] of Object.entries(local ?? {})) {
    out[ns] = [...new Set(names.map((n) => String(n).trim().toLowerCase()))];
  }
  if (remote && typeof remote === "object") {
    for (const [ns, names] of Object.entries(remote as Record<string, unknown>)) {
      if (!Array.isArray(names)) continue;
      const set = new Set(out[ns] ?? []);
      for (const n of names) if (typeof n === "string") set.add(n.trim().toLowerCase());
      out[ns] = [...set];
    }
  }
  return out;
}

// Strip names tombstoned in deletedItems[ns] from a list (case-insensitive).
// Mirrors web's dropDeleted.
function dropDeleted(
  list: string[],
  map: Record<string, string[]>,
  ns: string,
): string[] {
  const del = map[ns];
  if (!del || del.length === 0) return list;
  const set = new Set(del.map((n) => String(n).trim().toLowerCase()));
  return list.filter((n) => !set.has(String(n).trim().toLowerCase()));
}

function unionList(local: string[], remote: unknown): string[] {
  if (!Array.isArray(remote)) return local;
  const set = new Set(local);
  for (const v of remote) if (typeof v === "string") set.add(v);
  return [...set];
}

// Drop names in the tombstone set (case-insensitive). Mirrors web's
// dropMergedAway so a merged-away name can't be resurrected by the union above.
function dropTomb(list: string[], tomb: Set<string>): string[] {
  if (tomb.size === 0) return list;
  return list.filter((n) => !tomb.has(String(n).trim().toLowerCase()));
}

function unionBrandFlavors(
  local: Record<string, string[]>,
  remote: unknown,
): Record<string, string[]> {
  if (!remote || typeof remote !== "object") return local;
  const out: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(local)) out[k] = [...v];
  for (const [brand, flavors] of Object.entries(remote as Record<string, unknown>)) {
    if (!Array.isArray(flavors)) continue;
    const set = new Set(out[brand] ?? []);
    for (const f of flavors) if (typeof f === "string") set.add(f);
    out[brand] = [...set];
  }
  return out;
}

// Order-independent deep equality (objects compare by key, arrays by index).
// Mirrors the web app's storage.deepEqual so the empty-value detection below
// agrees across platforms.
function deepEqual(a: unknown, b: unknown): boolean {
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

// The canonical all-default run value (a fresh run carries no settings/progress).
// runToFormValues ignores the id, so this is deterministic. Used to detect the
// empty-value-with-real-stamp corruption on receive (web parity with
// DEFAULT_VALUES / isEmptyOverPopulated).
const EMPTY_FORM_VALUES: WebFormValues = runToFormValues({
  id: "",
  settings: DEFAULT_SETTINGS,
  progress: DEFAULT_PROGRESS,
  stoppages: [],
  startedAt: undefined,
  endedAt: undefined,
  isRunning: false,
});

export function isEmptyFormValue(fv: WebFormValues | undefined): boolean {
  return fv !== undefined && deepEqual(fv, EMPTY_FORM_VALUES);
}

// Translate an incoming payload into a patch for the mobile AppState. Master-data
// lists are union-merged unconditionally (matches the web app's brand handling).
// The day's runs/dayState are replaced only when the reset guard accepts them:
// the remote date must be today and its resetAt must be >= the local resetAt.
export function applyPayloadToState(
  payload: SyncPayload,
  prev: SyncableState,
  // Local per-run edit timestamps (run id -> ms). Used to reject a stale remote
  // that would clobber a fresher local edit. Defaults to {} (all 0 = no local
  // edits recorded → prior accept-remote behavior).
  localUpdatedAt: Record<string, number> = {},
): {
  patch: SyncableStatePatch;
  acceptedDay: boolean;
  // Merged per-run timestamps (per-id max of local + remote) for the caller to
  // persist as the new local map.
  mergedUpdatedAt: Record<string, number>;
  // True when we kept a strictly-newer local run value over a stale remote, so
  // the caller should re-push to converge peers (web parity).
  rejectedStale: boolean;
} {
  const patch: SyncableStatePatch = {};
  const remoteUpdatedAt = payload.runValuesUpdatedAt ?? {};
  // Merge per-run timestamps (per-id max), independent of whether the day is
  // accepted, so the map always reflects the freshest known edit time.
  const mergedUpdatedAt: Record<string, number> = { ...localUpdatedAt };
  for (const [id, ts] of Object.entries(remoteUpdatedAt)) {
    mergedUpdatedAt[id] = Math.max(mergedUpdatedAt[id] ?? 0, ts);
  }
  let rejectedStale = false;

  // Merge tombstones (union remote+local). A merge removes source names locally,
  // but the additive list unions below would resurrect them from a stale peer.
  // Union the tombstone set and strip those names from every list so a merge
  // sticks (web parity).
  const mergedAway = unionList(prev.mergedAway ?? [], payload.mergedAway);
  patch.mergedAway = mergedAway;
  const tomb = new Set(mergedAway.map((n) => String(n).trim().toLowerCase()));

  // Deletion tombstones (union remote+local). A plain delete removes a name
  // locally, but the additive list unions below would resurrect it from a stale
  // peer. Union the per-namespace tombstone map and strip each list's namespace
  // from its union so a delete sticks (web parity).
  const deletedItems = unionDeletedItems(prev.deletedItems ?? {}, payload.deletedItems);
  patch.deletedItems = deletedItems;

  // Master-data (union, always)
  if (payload.brands) patch.brands = dropDeleted(unionList(prev.brands, payload.brands), deletedItems, "brands");
  if (payload.brandFlavors) {
    const merged = unionBrandFlavors(prev.brandFlavors, payload.brandFlavors);
    const delBrands = new Set((deletedItems.brands ?? []).map((b) => b.trim().toLowerCase()));
    const out: Record<string, string[]> = {};
    for (const [brand, flavors] of Object.entries(merged)) {
      // Drop flavors of a deleted brand entirely.
      if (delBrands.has(brand.trim().toLowerCase())) continue;
      out[brand] = dropDeleted(flavors, deletedItems, flavorNamespace(brand));
    }
    patch.brandFlavors = out;
  }
  // Clean incoming pep types (rename legacy + drop retired) so a legacy peer can't
  // reintroduce "Pep - Cured"/"Pep - Natural"/"Diced Pepperoni" via sync.
  if (payload.pepTypes) patch.pepTypes = dropDeleted(dropTomb(renamePepList(unionList(prev.pepTypes, payload.pepTypes)), tomb), deletedItems, "pepTypes");
  if (payload.dieTypes) patch.dieTypes = dropDeleted(dropTomb(unionList(prev.dieTypes, payload.dieTypes), tomb), deletedItems, "dieTypes");
  if (payload.cheeseIngredients) patch.cheeseIngredients = dropDeleted(dropTomb(renameIngredientList(unionList(prev.cheeseIngredients, payload.cheeseIngredients)), tomb), deletedItems, "cheeseIngredients");
  if (payload.doughIngredients) patch.doughIngredients = dropDeleted(dropTomb(unionList(prev.doughIngredients, payload.doughIngredients), tomb), deletedItems, "doughIngredients");
  if (payload.frontlineIngredients) patch.frontlineIngredients = dropDeleted(dropTomb(unionList(prev.frontlineIngredients, payload.frontlineIngredients), tomb), deletedItems, "frontlineIngredients");

  const ds = payload.dayState;
  const remoteResetAt = ds?.resetAt ?? 0;
  const remoteDate = ds?.date;
  const remoteDateOk = !remoteDate || remoteDate === todayStr();
  const acceptedDay = !!ds && remoteDateOk && remoteResetAt >= prev.resetAt;

  if (acceptedDay && ds) {
    const isReset = remoteResetAt > prev.resetAt;
    // Runs are per-day: on a true daily reset drop the run tombstones — their ids
    // can never match today's fresh runs and would otherwise accumulate forever.
    if (isReset && deletedItems["runs"]) {
      const dm = { ...deletedItems };
      delete dm["runs"];
      patch.deletedItems = dm;
    }
    const delRunSet = new Set(
      ((patch.deletedItems ?? deletedItems)["runs"] ?? []).map((id) =>
        String(id).trim().toLowerCase(),
      ),
    );
    const prevById = new Map(prev.runs.map((r) => [r.id, r]));
    const remoteRuns = (Array.isArray(ds.runs) ? ds.runs : []).filter(
      (meta): meta is WebRunMeta =>
        !!meta && typeof meta === "object" && typeof meta.id === "string",
    );
    const mappedRemote = remoteRuns.map((meta) => {
      const prevRun = prevById.get(meta.id);
      const lTs = localUpdatedAt[meta.id] ?? 0;
      const rTs = remoteUpdatedAt[meta.id] ?? 0;
      // NEVER let an all-default/empty remote value overwrite a populated local
      // run, regardless of stamp (web parity with isEmptyOverPopulated). The
      // corruption pairs an empty value with a REAL, often EQUAL stamp, so the
      // lTs/rTs guard below would otherwise adopt the empty remote and wipe good
      // local data on every reconnect / reload. Keep ours and BUMP the stamp to
      // now so the heal re-push strictly wins the per-run guard on the server and
      // every peer (the corrupted shared row carries the run's real stamp, so a
      // re-push at the same stamp couldn't overwrite it).
      if (
        prevRun &&
        isEmptyFormValue(payload.runValues?.[meta.id]) &&
        !isEmptyFormValue(runToFormValues(prevRun))
      ) {
        rejectedStale = true;
        mergedUpdatedAt[meta.id] = Date.now();
        return prevRun;
      }
      // Local edit strictly newer than this remote — keep our run wholesale so a
      // stale remote can't clobber the just-made edit (web parity). Equal/absent
      // timestamps fall through to the prior accept-remote behavior.
      if (prevRun && lTs > rTs) {
        rejectedStale = true;
        return prevRun;
      }
      const mapped = metaToRun(meta, payload.runValues?.[meta.id], prevRun);
      // Per-run lifecycle LWW (web/server parity): when OUR lifecycle stamp is
      // strictly newer than the remote copy's, overlay our lifecycle fields onto
      // the mapped run — so a just-started run can't be flipped back to
      // "unstarted" by a stale remote. Overlay (not wholesale prevRun) so the
      // remote's newer VALUES still land; re-push heals the shared row.
      if (prevRun && (prevRun.metaUpdatedAt ?? 0) > (meta.metaUpdatedAt ?? 0)) {
        rejectedStale = true;
        return {
          ...mapped,
          startedAt: prevRun.startedAt,
          endedAt: prevRun.endedAt,
          isRunning: prevRun.isRunning,
          stoppages: prevRun.stoppages,
          actualCases: prevRun.actualCases,
          wasteLbs: prevRun.wasteLbs,
          metaUpdatedAt: prevRun.metaUpdatedAt,
        };
      }
      return mapped;
    });
    // Runs are day-state and converge like the substitution/staging overlays below:
    // on a true daily reset adopt the remote runs wholesale; during same-day
    // concurrent editing union by id so a run just added on THIS device that hasn't
    // synced yet survives an incoming payload that predates it (web parity). The
    // run-deletion tombstone strips ids deleted on a peer so the union can't
    // resurrect them.
    const mergedRuns = isReset
      ? mappedRemote
      : (() => {
          const remoteIds = new Set(remoteRuns.map((m) => m.id));
          const localOnly = prev.runs.filter((r) => !remoteIds.has(r.id));
          return [...mappedRemote, ...localOnly].filter(
            (r) => !delRunSet.has(String(r.id).trim().toLowerCase()),
          );
        })();
    // On a true reset adopt the remote runs wholesale (web parity); same-day, keep
    // the ≥1-run guard so a transient empty union never wipes our runs.
    patch.runs = isReset ? mergedRuns : mergedRuns.length > 0 ? mergedRuns : prev.runs;
    patch.currentIndex = Math.max(0, Math.min(prev.currentIndex, patch.runs.length - 1));
    if (ds.shiftNotes !== undefined) patch.shiftNotes = ds.shiftNotes;
    if (ds.runToTime !== undefined) patch.runToTime = ds.runToTime;
    // A true daily reset bumps resetAt strictly forward: adopt the remote day's
    // overlays wholesale so the reset's empty maps clear ours. When resetAt is
    // EQUAL (normal same-day concurrent editing across devices) additively merge
    // the substitution overlay (by id) and the staging checklist (per key) so two
    // devices each ticking a different item / adding a different substitution both
    // survive — same convergence model as the master-data list unions. An
    // un-check / removal won't cross devices (accepted union tradeoff; resets daily).
    const remoteSubs = Array.isArray(ds.substitutions) ? ds.substitutions : [];
    const remoteSubLog = Array.isArray(ds.substitutionLog) ? ds.substitutionLog : [];
    const unionById = <T extends { id: string }>(a: readonly T[], b: readonly T[]): T[] => {
      const byId = new Map<string, T>();
      for (const x of a) byId.set(x.id, x);
      for (const x of b) byId.set(x.id, x); // remote wins for the same id
      return [...byId.values()];
    };
    patch.substitutions = isReset
      ? remoteSubs
      : unionById(prev.substitutions ?? [], remoteSubs);
    patch.substitutionLog = isReset
      ? remoteSubLog
      : unionById(prev.substitutionLog ?? [], remoteSubLog).sort((x, y) => x.ts - y.ts);
    const remoteStaged =
      ds.stagedItems && typeof ds.stagedItems === "object" ? ds.stagedItems : {};
    if (isReset) {
      patch.stagedItems = remoteStaged;
    } else {
      const out: Record<string, boolean> = { ...(prev.stagedItems ?? {}) };
      for (const [k, val] of Object.entries(remoteStaged)) {
        out[k] = !!out[k] || !!val;
      }
      patch.stagedItems = out;
    }
    patch.resetAt = Math.max(prev.resetAt, remoteResetAt);
    patch.date = todayStr();
  }

  return { patch, acceptedDay, mergedUpdatedAt, rejectedStale };
}
