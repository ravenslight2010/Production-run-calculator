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
  return {
    ...(rawMeta ?? {}),
    id: run.id,
    brand: run.settings.brand,
    flavor: run.settings.flavor,
    startedAt: run.startedAt,
    endedAt: run.endedAt,
    subTab: run.progress.subTab,
    notes: run.settings.notes,
    stoppages: run.stoppages.map(mobileStoppageToWeb),
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
function formValuesToSettings(
  fv: WebFormValues | undefined,
  meta: WebRunMeta,
  prev: RunSettings | undefined,
): RunSettings {
  const base = prev ?? DEFAULT_SETTINGS;
  const v = (fv ?? {}) as Partial<WebFormValues>;
  return {
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
  };
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
    stoppages: (meta.stoppages ?? []).map(webStoppageToMobile),
    startedAt: meta.startedAt,
    endedAt: meta.endedAt,
    isRunning: !!meta.startedAt && !meta.endedAt && !meta.pausedAt,
  };
}

// ── Full state <-> payload ───────────────────────────────────────────────────

export function appStateToPayload(
  state: SyncableState,
  lastRaw: SyncPayload | null,
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
    },
    runValues,
    brands: state.brands,
    brandFlavors: state.brandFlavors,
    pepTypes: state.pepTypes,
    dieTypes: state.dieTypes,
    cheeseIngredients: state.cheeseIngredients,
    doughIngredients: state.doughIngredients,
    frontlineIngredients: state.frontlineIngredients,
  };
}

function unionList(local: string[], remote: unknown): string[] {
  if (!Array.isArray(remote)) return local;
  const set = new Set(local);
  for (const v of remote) if (typeof v === "string") set.add(v);
  return [...set];
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

// Translate an incoming payload into a patch for the mobile AppState. Master-data
// lists are union-merged unconditionally (matches the web app's brand handling).
// The day's runs/dayState are replaced only when the reset guard accepts them:
// the remote date must be today and its resetAt must be >= the local resetAt.
export function applyPayloadToState(
  payload: SyncPayload,
  prev: SyncableState,
): { patch: SyncableStatePatch; acceptedDay: boolean } {
  const patch: SyncableStatePatch = {};

  // Master-data (union, always)
  if (payload.brands) patch.brands = unionList(prev.brands, payload.brands);
  if (payload.brandFlavors) patch.brandFlavors = unionBrandFlavors(prev.brandFlavors, payload.brandFlavors);
  if (payload.pepTypes) patch.pepTypes = unionList(prev.pepTypes, payload.pepTypes);
  if (payload.dieTypes) patch.dieTypes = unionList(prev.dieTypes, payload.dieTypes);
  if (payload.cheeseIngredients) patch.cheeseIngredients = unionList(prev.cheeseIngredients, payload.cheeseIngredients);
  if (payload.doughIngredients) patch.doughIngredients = unionList(prev.doughIngredients, payload.doughIngredients);
  if (payload.frontlineIngredients) patch.frontlineIngredients = unionList(prev.frontlineIngredients, payload.frontlineIngredients);

  const ds = payload.dayState;
  const remoteResetAt = ds?.resetAt ?? 0;
  const remoteDate = ds?.date;
  const remoteDateOk = !remoteDate || remoteDate === todayStr();
  const acceptedDay = !!ds && remoteDateOk && remoteResetAt >= prev.resetAt;

  if (acceptedDay && ds) {
    const prevById = new Map(prev.runs.map((r) => [r.id, r]));
    const runs = ds.runs.map((meta) => metaToRun(meta, payload.runValues?.[meta.id], prevById.get(meta.id)));
    patch.runs = runs.length > 0 ? runs : prev.runs;
    patch.currentIndex = Math.max(0, Math.min(prev.currentIndex, patch.runs.length - 1));
    if (ds.shiftNotes !== undefined) patch.shiftNotes = ds.shiftNotes;
    if (ds.runToTime !== undefined) patch.runToTime = ds.runToTime;
    patch.resetAt = Math.max(prev.resetAt, remoteResetAt);
    patch.date = todayStr();
  }

  return { patch, acceptedDay };
}
