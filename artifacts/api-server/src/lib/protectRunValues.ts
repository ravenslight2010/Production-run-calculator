// Per-run + run-list protective merge AND payload sanitization for the shared
// day-state sync row.
//
// Background: the daily_sync row is a single blob shared by every device on a
// scope+date. Historically PUT /sync was blind last-writer-wins: the incoming
// payload replaced the stored blob wholesale. That produced TWO distinct,
// recurring data-loss bugs:
//
//   1. Empty run VALUE over a populated one. A client bug could emit an
//      all-default ("empty") run value paired with that run's REAL edit stamp
//      (the form is transiently all-default during mount / right after a
//      programmatic form.reset() while the durable stamp still carries the real
//      edit time). With blind LWW that empty value persisted and re-infected
//      every device on the next read — "I entered it, refreshed, it vanished".
//
//   2. Whole RUNS disappearing. A device that briefly holds a SHORTER run list
//      (right after a refresh that adopted a transient state, or before it has
//      seen a peer's just-added runs) would push that short dayState.runs list,
//      and blind LWW replaced everyone's run list with it. The dropped runs were
//      never deleted by anyone — confirmed in production as runs with edit stamps
//      but NO deletion tombstone and no run object on any day.
//
// This module makes the server an ADDITIVE, tombstone-aware register merge so
// neither a run's value NOR the run itself can be dropped by a single push
// unless that run was explicitly deleted:
//
//   - Run VALUES are a per-run last-writer-wins register keyed on the per-run
//     edit stamp (runValuesUpdatedAt). An incoming value is accepted ONLY when
//     its stamp is STRICTLY NEWER than what's stored; equal/older stamps keep the
//     stored value (this blocks the empty-value-with-equal-stamp corruption). A
//     run present in the store but omitted from the push keeps its stored value.
//
//   - The run LIST (dayState.runs) is union-merged by run id: incoming runs
//     first (the pusher's current ordering), then any stored run the push
//     omitted, appended so it is never lost. Runs whose id appears in EITHER
//     side's deletedItems.runs tombstone list are filtered out, so legitimate
//     deletions still take effect and aren't resurrected.
//
//   - DAILY RESET escape hatch: a genuine reset/rollover bumps dayState.resetAt
//     strictly forward and intentionally starts the day fresh (empty runs/values
//     are expected and correct). When the incoming resetAt is strictly greater
//     than the stored resetAt we adopt the incoming payload WHOLESALE — matching
//     the clients' reset semantics — so the reset's empty state actually clears
//     the stored day instead of being additively "protected" back in. During
//     normal same-day editing resetAt is stable, so the additive protection
//     above applies.
//
// Healing: when a client detects an empty-over-populated value on receive it
// re-pushes the good value with a FRESHLY BUMPED stamp (Date.now()), strictly
// newer than the corrupted row's stamp, so this merge accepts it and the fix
// propagates to every peer.
//
// Every other payload field (master-data lists, overlays, the rest of dayState)
// is still adopted from the incoming payload and additively reconciled
// client-side on receive, so this change stays surgical.

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function asNumber(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function runIdOf(r: unknown): string | null {
  if (isPlainObject(r) && typeof r.id === "string" && r.id) return r.id;
  return null;
}

// Structural deep-equality mirroring the web client's storage.deepEqual:
// objects compare key-order-independently, arrays compare by index. Used only to
// recognize the all-default ("blank") run value below.
function deepEqualValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return a === b;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!deepEqualValue(a[i], b[i])) return false;
    return true;
  }
  if (typeof a === "object" && typeof b === "object") {
    const ak = Object.keys(a as object);
    const bk = Object.keys(b as object);
    if (ak.length !== bk.length) return false;
    for (const k of ak) {
      if (!Object.prototype.hasOwnProperty.call(b, k)) return false;
      if (!deepEqualValue((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) return false;
    }
    return true;
  }
  return a === b;
}

// Canonical all-default ("blank") run values. These are exactly what a client
// emits for a run it has no real data for: web `loadRunValues` returns
// DEFAULT_VALUES for an unknown id, and the form holds this shape transiently
// during mount / right after a programmatic form.reset(). They MUST stay in
// sync with `DEFAULT_VALUES` in artifacts/run-calculator/src/types.ts (and the
// mobile app's equivalent when parity resumes).
//
// IMPORTANT — fails safe by design: these are only ever used to RECOGNIZE an
// empty value so we can refuse to let it overwrite a populated one. Recognition
// is an EXACT deep-equality match, so drift (a field added to the clients'
// default but not here) only DEGRADES protection — an unrecognized blank falls
// through to the existing stamp logic, i.e. status quo. It can NEVER produce a
// false positive that rejects a real edit (a real edit is, by definition, not
// deep-equal to the blank), so an out-of-date copy can never cause data loss.
//
// Two templates because the client defaults changed over time:
//   - LEGACY_BLANK_RUN_VALUE: the older client field set, where the pep
//     batch-lbs fields defaulted to 25. Stored rows / stale clients can still
//     carry this shape.
//   - CURRENT_BLANK_RUN_VALUE: today's DEFAULT_VALUES — all quantity fields 0
//     (only speedAdjustment is 1.0), including the pep "B"-slot and timer
//     fields added since.
// Additionally, a current-shape value whose ONLY difference is all four pep
// batch fields at 25 (the exact legacy default signature) is blank — mirroring
// the web's isAllDefaultRunValue. A lone 25 (some but not all four) is treated
// as a real user-typed weight.
const LEGACY_BLANK_RUN_VALUE: Record<string, unknown> = {
  casesNeeded: 0,
  crustsPerCycle: 0,
  cycleSpeed: 0,
  speedAdjustment: 1.0,
  approxLineSpeed: 0,
  freezerTime: 0,
  pizzasPerCase: 0,
  casesPerSkid: 0,
  casesPerLayer: 0,
  doughballsPerTray: 0,
  crustsPerStack: 0,
  doughBatchYield: 0,
  crustsPerCase: 0,
  skidsCompleted: 0,
  casesOnCurrentSkid: 0,
  traysOnLine: 0,
  batchesReady: 0,
  carryOverDone: false,
  sauceOzPerPizza: 0,
  sauceBarrelLbs: 0,
  app1OzPerPizza: 0,
  app1BatchLbs: 0,
  app2OzPerPizza: 0,
  app2BatchLbs: 0,
  app3OzPerPizza: 0,
  app3BatchLbs: 0,
  app4OzPerPizza: 0,
  app4BatchLbs: 0,
  pep1Sticks: 0,
  pep1OzPerPizza: 0,
  pep1BatchLbs: 25,
  pep2Sticks: 0,
  pep2OzPerPizza: 0,
  pep2BatchLbs: 25,
  app1Type: "",
  app2Type: "",
  app3Type: "",
  app4Type: "",
  pep1Type: "",
  pep2Type: "",
  dieType: "",
  allergen: "none",
  doughRecipeName: "",
  targetDoughballWeight: 0,
  doughRecipe: [],
  app1CheeseRecipeName: "",
  app1CheeseRecipe: [],
  app2CheeseRecipeName: "",
  app2CheeseRecipe: [],
  app3CheeseRecipeName: "",
  app3CheeseRecipe: [],
  app4CheeseRecipeName: "",
  app4CheeseRecipe: [],
  frontlineRecipeName: "",
  frontlineRecipe: [],
  cartoned: "yes",
  cartonsPerCase: 0,
  circles: "none",
  shipper: "",
  skidStacking: "",
  gripSheets: "none",
  slipSheets: "no",
};

// Today's DEFAULT_VALUES shape (all-zero quantities; speedAdjustment 1.0).
const CURRENT_BLANK_RUN_VALUE: Record<string, unknown> = {
  casesNeeded: 0,
  crustsPerCycle: 0,
  cycleSpeed: 0,
  speedAdjustment: 1.0,
  approxLineSpeed: 0,
  freezerTime: 0,
  pizzasPerCase: 0,
  casesPerSkid: 0,
  casesPerLayer: 0,
  doughballsPerTray: 0,
  crustsPerStack: 0,
  doughBatchYield: 0,
  crustsPerCase: 0,
  skidsCompleted: 0,
  casesOnCurrentSkid: 0,
  traysOnLine: 0,
  batchesReady: 0,
  mixerLowSec: 330,
  mixerHighSec: 180,
  hopperSec: 70,
  carryOverDone: false,
  sauceOzPerPizza: 0,
  sauceBarrelLbs: 0,
  sauceBarrelsMade: 0,
  sauceBarrelAnchorNetSec: 0,
  sauceBarrelCorrectionGeneration: 0,
  app1BatchesMade: 0,
  app1BatchAnchorNetSec: 0,
  app1BatchCorrectionGeneration: 0,
  app2BatchesMade: 0,
  app2BatchAnchorNetSec: 0,
  app2BatchCorrectionGeneration: 0,
  app3BatchesMade: 0,
  app3BatchAnchorNetSec: 0,
  app3BatchCorrectionGeneration: 0,
  app4BatchesMade: 0,
  app4BatchAnchorNetSec: 0,
  app4BatchCorrectionGeneration: 0,
  app1OzPerPizza: 0,
  app1BatchLbs: 0,
  app2OzPerPizza: 0,
  app2BatchLbs: 0,
  app3OzPerPizza: 0,
  app3BatchLbs: 0,
  app4OzPerPizza: 0,
  app4BatchLbs: 0,
  pep1Sticks: 0,
  pep1OzPerPizza: 0,
  pep1BatchLbs: 0,
  pep2Sticks: 0,
  pep2OzPerPizza: 0,
  pep2BatchLbs: 0,
  pep1Combined: true,
  pep1TypeB: "",
  pep2TypeB: "",
  pep1SticksB: 0,
  pep1OzPerPizzaB: 0,
  pep1BatchLbsB: 0,
  pep2SticksB: 0,
  pep2OzPerPizzaB: 0,
  pep2BatchLbsB: 0,
  app1Type: "",
  app2Type: "",
  app3Type: "",
  app4Type: "",
  pep1Type: "",
  pep2Type: "",
  dieType: "",
  allergen: "none",
  doughRecipeName: "",
  targetDoughballWeight: 0,
  doughRecipe: [],
  app1CheeseRecipeName: "",
  app1CheeseRecipe: [],
  app2CheeseRecipeName: "",
  app2CheeseRecipe: [],
  app3CheeseRecipeName: "",
  app3CheeseRecipe: [],
  app4CheeseRecipeName: "",
  app4CheeseRecipe: [],
  frontlineRecipeName: "",
  frontlineRecipe: [],
  cartoned: "cartoned",
  labelPosition: "",
  cartonsPerCase: 0,
  labelsPerRoll: 0,
  topLabelsPerRoll: 0,
  bottomLabelsPerRoll: 0,
  circles: "none",
  shipper: "",
  skidStacking: "",
  gripSheets: "none",
  slipSheets: "no",
  preTunnelMin: 2.5,
  postTunnelMin: 2.5,
  tempFreezerTime: 0,
  tempCrustsPerCycle: 0,
  tempCycleSpeed: 0,
};

// The four pep batch fields whose OLD default was 25. Only the exact
// all-four-at-25 signature is legacy-blank; a lone 25 is a real typed weight.
const LEGACY_PEP_BATCH_FIELDS = [
  "pep1BatchLbs",
  "pep2BatchLbs",
  "pep1BatchLbsB",
  "pep2BatchLbsB",
] as const;

// Fields whose default moved from 0 to a non-zero factory-typical value.
// A blank run may carry EITHER shape depending on when the client saved it —
// normalize 0 to the current default before comparing.
// Keep in lockstep with the web's MACHINE_TIME_DEFAULTS and
// PRE_POST_TUNNEL_DEFAULT_MIN (types.ts).
const MACHINE_TIME_DEFAULTS: Record<string, number> = {
  mixerLowSec: 330,
  mixerHighSec: 180,
  hopperSec: 70,
  // Tunnel stage pre/post dwell times (minutes). Default moved from 0 to 2.5;
  // old stored profiles carry 0 until the one-time boot heal runs.
  preTunnelMin: 2.5,
  postTunnelMin: 2.5,
};

// True when a run value is an exact all-default/blank template (see above):
// the current default shape (machine times 0 or default), the old-field-set
// legacy template, or the current shape carrying the exact four-field legacy
// pep-25 signature.
function isBlankRunValue(v: unknown): boolean {
  if (!isPlainObject(v)) return false;
  if (deepEqualValue(v, LEGACY_BLANK_RUN_VALUE)) return true;
  const withMachineDefaults: Record<string, unknown> = { ...v };
  // Older clients legitimately omit canonical Sauce progress because those
  // fields did not exist yet. Missing is equivalent to the zero default for
  // blank-run detection, preserving the empty-over-populated safety guard
  // during a rolling client upgrade.
  for (const field of [
    "sauceBarrelsMade",
    "sauceBarrelAnchorNetSec",
    "sauceBarrelCorrectionGeneration",
    "app1BatchesMade",
    "app1BatchAnchorNetSec",
    "app1BatchCorrectionGeneration",
    "app2BatchesMade",
    "app2BatchAnchorNetSec",
    "app2BatchCorrectionGeneration",
    "app3BatchesMade",
    "app3BatchAnchorNetSec",
    "app3BatchCorrectionGeneration",
    "app4BatchesMade",
    "app4BatchAnchorNetSec",
    "app4BatchCorrectionGeneration",
  ]) {
    if (!(field in withMachineDefaults)) withMachineDefaults[field] = 0;
  }
  for (const [k, def] of Object.entries(MACHINE_TIME_DEFAULTS)) {
    if (withMachineDefaults[k] === 0) withMachineDefaults[k] = def;
  }
  if (deepEqualValue(withMachineDefaults, CURRENT_BLANK_RUN_VALUE)) return true;
  if (LEGACY_PEP_BATCH_FIELDS.every((f) => v[f] === 25)) {
    const normalized: Record<string, unknown> = { ...withMachineDefaults };
    for (const f of LEGACY_PEP_BATCH_FIELDS) normalized[f] = 0;
    return deepEqualValue(normalized, CURRENT_BLANK_RUN_VALUE);
  }
  return false;
}

// Collect the set of tombstoned run ids from a payload's deletedItems.runs.
function tombstonedRunIds(payload: Record<string, unknown>): Set<string> {
  const out = new Set<string>();
  const di = isPlainObject(payload.deletedItems) ? payload.deletedItems : {};
  for (const id of asArray((di as Record<string, unknown>).runs)) {
    if (typeof id === "string" && id) out.add(id);
  }
  return out;
}

// ── Delete/un-delete stamp maps (namespace → lowercased name → epoch ms) ─────
// The web client arbitrates deletion tombstones with per-name LWW stamps
// (`deletedStamps` / `undeletedStamps`): an un-delete stamped after the delete
// keeps a deliberately re-added name visible even though the tombstone itself
// is merged by pure union. The stored blob is otherwise adopted wholesale from
// the last pusher, so a STALE client (an old bundle that doesn't know these
// fields) would silently strip the stamps from the shared row and every peer
// would re-hide the re-added names. Preserve them here: per-name MAX merge of
// incoming and stored, and never let a payload that omits the maps delete them.
function mergeStampMap(a: unknown, b: unknown): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  for (const src of [a, b]) {
    if (!isPlainObject(src)) continue;
    for (const [ns, names] of Object.entries(src)) {
      if (!isPlainObject(names)) continue;
      const bucket = out[ns] ?? {};
      for (const [name, ts] of Object.entries(names)) {
        const n = asNumber(ts);
        if (n > 0 && n > asNumber(bucket[name])) bucket[name] = n;
      }
      if (Object.keys(bucket).length > 0) out[ns] = bucket;
    }
  }
  return out;
}

function withMergedStamps(
  out: Record<string, unknown>,
  incoming: Record<string, unknown>,
  existing: Record<string, unknown> | undefined,
): Record<string, unknown> {
  // History is a cold, independently mergeable section. New live payloads may
  // omit it to reduce request/broadcast cost; omission must not erase the
  // server's retained history. An explicit value (including []) remains
  // authoritative for reset/import flows.
  if (
    !Object.prototype.hasOwnProperty.call(incoming, "history") &&
    existing &&
    Object.prototype.hasOwnProperty.call(existing, "history")
  ) {
    out.history = existing.history;
  }
  const del = mergeStampMap(incoming.deletedStamps, existing?.deletedStamps);
  const undel = mergeStampMap(incoming.undeletedStamps, existing?.undeletedStamps);
  if (Object.keys(del).length > 0) out.deletedStamps = del;
  else delete out.deletedStamps; // scrub junk carried in by the incoming spread
  if (Object.keys(undel).length > 0) out.undeletedStamps = undel;
  else delete out.undeletedStamps;
  return out;
}

function preserveAndInvalidateAutoTrackCoordination(
  protectedPayload: unknown,
  existingCoordination: unknown,
  existingPayload: Record<string, unknown>,
): unknown {
  if (!isPlainObject(protectedPayload) || !isPlainObject(existingCoordination)) return protectedPayload;
  const priorValues = isPlainObject(existingPayload.runValues) ? existingPayload.runValues : {};
  const nextValues = isPlainObject(protectedPayload.runValues) ? protectedPayload.runValues : {};
  const coordinationRuns = isPlainObject(existingCoordination.runs)
    ? { ...existingCoordination.runs }
    : {};
  const now = Date.now();

  for (const [runId, rawNext] of Object.entries(nextValues)) {
    if (!isPlainObject(rawNext)) continue;
    const rawPrior = priorValues[runId];
    if (!isPlainObject(rawPrior)) continue;
    const runCoordination = isPlainObject(coordinationRuns[runId])
      ? { ...coordinationRuns[runId] }
      : {};
    const changedChannels = new Set<string>();
    if (
      asNumber(rawNext.skidsCompleted) !== asNumber(rawPrior.skidsCompleted)
      || asNumber(rawNext.casesOnCurrentSkid) !== asNumber(rawPrior.casesOnCurrentSkid)
    ) changedChannels.add("case");
    if (asNumber(rawNext.traysOnLine) !== asNumber(rawPrior.traysOnLine)) {
      changedChannels.add("tray-consume");
      changedChannels.add("tray-produce");
    }
    if (asNumber(rawNext.batchesReady) !== asNumber(rawPrior.batchesReady)) {
      changedChannels.add("batch-consume");
      changedChannels.add("batch-produce");
    }
    if (
      asNumber(rawNext.sauceBarrelsMade) !== asNumber(rawPrior.sauceBarrelsMade)
      || asNumber(rawNext.sauceBarrelAnchorNetSec) !== asNumber(rawPrior.sauceBarrelAnchorNetSec)
      || asNumber(rawNext.sauceBarrelCorrectionGeneration) !== asNumber(rawPrior.sauceBarrelCorrectionGeneration)
    ) {
      changedChannels.add("sauce-barrel");
    }
    for (const slot of [1, 2, 3, 4]) {
      const prefix = `app${slot}Batch`;
      if (
        asNumber(rawNext[`${prefix}esMade`]) !== asNumber(rawPrior[`${prefix}esMade`])
        || asNumber(rawNext[`${prefix}AnchorNetSec`]) !== asNumber(rawPrior[`${prefix}AnchorNetSec`])
        || asNumber(rawNext[`${prefix}CorrectionGeneration`]) !== asNumber(rawPrior[`${prefix}CorrectionGeneration`])
      ) changedChannels.add(`app${slot}-batch`);
    }
    if (changedChannels.size === 0) continue;
    const stamp = asNumber(
      isPlainObject(protectedPayload.runValuesUpdatedAt)
        ? protectedPayload.runValuesUpdatedAt[runId]
        : now,
    );
    for (const channel of changedChannels) {
      if (!Object.prototype.hasOwnProperty.call(runCoordination, channel)) continue;
      runCoordination[channel] = {
        generation: `manual:${stamp}`,
        sequence: 0,
        // Sauce and applicator coordination use pause-aware net-production
        // seconds, not epoch milliseconds. Zero tells clients to rebuild the
        // next identity from the corrected canonical anchor and current cadence.
        nextDueAt: channel === "sauce-barrel" || /^app[1-4]-batch$/.test(channel) ? 0 : now,
        updatedAt: now,
      };
    }
    coordinationRuns[runId] = runCoordination;
  }
  return {
    ...protectedPayload,
    autoTrackCoordination: {
      ...existingCoordination,
      runs: coordinationRuns,
    },
  };
}

/**
 * Merge `incoming` against the already-stored `existing` payload so that:
 *   - a run's stored VALUE only changes on a strictly-newer-stamped edit, and
 *   - a stored RUN is never dropped by a push that omits it (additive run list),
 *   - unless the run was explicitly deleted (tombstoned), or the caller is
 *     replacing a future scheduled-day row.
 * Returns a new payload object. Non-object payloads are returned unchanged.
 */
export function protectRunValues(
  incoming: unknown,
  existing: unknown,
  options: { allowRunListReplacement?: boolean } = {},
): unknown {
  if (!isPlainObject(incoming)) return incoming;
  // Nothing stored yet (first write for this scope+date): the payload was
  // already sanitized by the route, but still canonicalize the legacy
  // runValues pair from packagingProgress before storing/returning it.
  if (!isPlainObject(existing)) {
    const progress = mergePackagingProgress(
      incoming.packagingProgress,
      undefined,
      tombstonedRunIds(incoming),
    );
    // Preserve the established first-write identity behavior for legacy
    // payloads that do not carry the new independent register.
    if (!progress) return incoming;
    const out: Record<string, unknown> = { ...incoming };
    const outVals = isPlainObject(incoming.runValues)
      ? { ...incoming.runValues }
      : {};
    overlayPackagingIntoRunValues(outVals, progress);
    out.packagingProgress = progress;
    out.runValues = outVals;
    return withMergedStamps(out, incoming, undefined);
  }

  // Timer coordination is server-authoritative. An ordinary snapshot can
  // echo this field, but cannot replace or remove the state advanced by the
  // locked auto-track claim endpoint.
  const incomingDayForCoordination = isPlainObject(incoming.dayState) ? incoming.dayState : undefined;
  const existingDayForCoordination = isPlainObject(existing.dayState) ? existing.dayState : undefined;
  const replacesCoordinatedDay =
    options.allowRunListReplacement
    && asNumber(existingDayForCoordination?.resetAt) > 0
    && asNumber(incomingDayForCoordination?.resetAt) > asNumber(existingDayForCoordination?.resetAt);
  if (
    !replacesCoordinatedDay
    && Object.prototype.hasOwnProperty.call(existing, "autoTrackCoordination")
  ) {
    const existingWithoutCoordination = { ...existing };
    delete existingWithoutCoordination.autoTrackCoordination;
    const protectedPayload = protectRunValues(incoming, existingWithoutCoordination, options);
    return preserveAndInvalidateAutoTrackCoordination(
      protectedPayload,
      existing.autoTrackCoordination,
      existing,
    );
  }

  const inDay = isPlainObject(incoming.dayState) ? incoming.dayState : undefined;
  const exDay = isPlainObject(existing.dayState) ? existing.dayState : undefined;

  // A future scheduled-day replacement bumps resetAt strictly forward and
  // intentionally replaces that future row. Current-day writes must NOT use this
  // escape hatch: a fresh/stale device can have a newer local reset marker before
  // it adopts today's shared row, and a marker alone is not a deletion.
  //
  // GUARD: only honor this when the STORED row already carries a real reset
  // baseline (exReset > 0). A missing / 0 stored resetAt (a legacy row, or a peer
  // that pushed without one — seen in production as an active day's row with a
  // NULL resetAt) must NOT make every normal same-day push — which carries the
  // day's stable, REAL resetAt — look like a "strictly newer reset" and
  // wholesale-clobber the shared day. That false positive bypassed all the
  // additive protection below and re-opened the loss ("a reset blanked everything
  // I entered"). With no stored baseline we fall through to the additive merge,
  // which preserves the runs AND populates resetAt from the incoming payload so
  // the next comparison is sound (a genuine reset then clears on the next push).
  const exReset = asNumber(exDay?.resetAt);
  const inReset = asNumber(inDay?.resetAt);
  // Even on a wholesale reset adoption, the delete/un-delete stamp maps are
  // factory-wide master-data history, not day-state — carry them across so a
  // reset (or a stale client's reset push) can't erase un-delete decisions.
  //
  // ADDITIONAL GUARD: apply the same isBlankRunValue protection to runValues
  // even during a wholesale reset. A rollover push (resetAt bumped forward)
  // that fetched a stale or still-empty scheduled row can arrive with
  // all-default run values while the live row already has real data entered
  // by another device today (casesNeeded, line settings, etc.). Without this
  // guard those values are erased wholesale. Mirror the per-run
  // empty-over-populated logic from the additive path: keep the stored value
  // and advance its stamp so the surviving value wins on every peer.
  if (options.allowRunListReplacement && exReset > 0 && inReset > exReset) {
    const inVals = isPlainObject(incoming.runValues) ? incoming.runValues : {};
    const inUpd  = isPlainObject(incoming.runValuesUpdatedAt) ? incoming.runValuesUpdatedAt : {};
    const exVals = isPlainObject(existing.runValues) ? existing.runValues : {};
    const exUpd  = isPlainObject(existing.runValuesUpdatedAt) ? existing.runValuesUpdatedAt : {};
    const outVals: Record<string, unknown> = {};
    const outUpd:  Record<string, unknown> = {};
    // Incoming run IDs are authoritative for the new day (the reset supplies
    // the run list). Only protect values for runs the reset explicitly includes.
    for (const id of Object.keys(inVals)) {
      const inStamp = asNumber(inUpd[id]);
      const exStamp = asNumber(exUpd[id]);
      if (
        isPlainObject(exVals[id]) &&
        isBlankRunValue(inVals[id]) &&
        !isBlankRunValue(exVals[id])
      ) {
        // Rollover brought blank/default values for a run that already has
        // real data on this row — preserve the real data and advance the
        // stamp so the surviving value wins the per-run LWW on every peer.
        outVals[id] = exVals[id];
        outUpd[id]  = Math.max(inStamp, exStamp, Date.now());
      } else {
        outVals[id] = inVals[id];
        if (inStamp > 0) outUpd[id] = inStamp;
      }
    }
    const base: Record<string, unknown> = {
      ...(incoming as Record<string, unknown>),
      runValues: outVals,
      runValuesUpdatedAt: outUpd,
    };
    // packagingProgress: reset retains only incoming run IDs, but still applies
    // precedence where the same run exists on both sides.
    const resetTombstoned = tombstonedRunIds(incoming as Record<string, unknown>);
    // Any run NOT in incoming's authoritative run LIST is implicitly dropped
    // by the reset. Do not infer membership from runValues: an orphan value
    // must not retain metadata, while a listed run may legitimately have no
    // value entry yet.
    const inRunIds = new Set(
      (
        inDay && Array.isArray(inDay.runs)
          ? inDay.runs
          : []
      )
        .map((run) =>
          isPlainObject(run) && typeof run.id === "string" ? run.id : "",
        )
        .filter(Boolean),
    );
    const resetProgress = mergePackagingProgress(
      (incoming as Record<string, unknown>).packagingProgress,
      (existing as Record<string, unknown>).packagingProgress,
      new Set([...resetTombstoned, ...(
        // Filter BOTH incoming and stored progress entries whose ids are not in
        // the reset's run list. An incoming-only orphan must not survive merely
        // because it was absent from the stored map.
        (() => {
          const inProg = isPlainObject((incoming as Record<string, unknown>).packagingProgress)
            ? (incoming as Record<string, unknown>).packagingProgress as Record<string, unknown>
            : {};
          const exProg = isPlainObject((existing as Record<string, unknown>).packagingProgress)
            ? (existing as Record<string, unknown>).packagingProgress as Record<string, unknown>
            : {};
          return [...new Set([...Object.keys(inProg), ...Object.keys(exProg)])]
            .filter((id) => !inRunIds.has(id));
        })()
      )]),
    );
    if (resetProgress) {
      overlayPackagingIntoRunValues(outVals, resetProgress);
      base.packagingProgress = resetProgress;
    } else {
      delete base.packagingProgress;
    }
    return withMergedStamps(base, incoming, existing);
  }

  const inVals = isPlainObject(incoming.runValues) ? incoming.runValues : {};
  const inUpd = isPlainObject(incoming.runValuesUpdatedAt) ? incoming.runValuesUpdatedAt : {};
  const exVals = isPlainObject(existing.runValues) ? existing.runValues : {};
  const exUpd = isPlainObject(existing.runValuesUpdatedAt) ? existing.runValuesUpdatedAt : {};

  // Tombstones from BOTH sides — a delete may have been seen by only one peer.
  const tombstoned = tombstonedRunIds(incoming);
  for (const id of tombstonedRunIds(existing)) tombstoned.add(id);

  // ── Additively union the run LIST by id ────────────────────────────────────
  // Incoming order first, then stored-only runs appended; tombstoned runs out.
  //
  // Per-run lifecycle LWW: each run object may carry a `metaUpdatedAt` stamp,
  // bumped by the clients whenever the run's lifecycle/metadata (startedAt,
  // pausedAt, endedAt, stoppages, notes, …) actually changed locally. When BOTH
  // sides have the same run id, keep the strictly-newer-stamped copy — so a
  // stale peer's push can't clobber a just-started run back to "unstarted" on
  // the shared row. Absent/equal stamps keep the old incoming-wins behavior.
  const metaStampOf = (r: unknown): number =>
    isPlainObject(r) ? asNumber(r.metaUpdatedAt) : 0;
  const isEndedRun = (r: unknown): boolean =>
    isPlainObject(r) && asNumber(r.endedAt) > 0;
  const runById = new Map<string, unknown>();
  const runOrder: string[] = [];
  for (const r of asArray(inDay?.runs)) {
    const id = runIdOf(r);
    if (!id || tombstoned.has(id) || runById.has(id)) continue;
    runById.set(id, r);
    runOrder.push(id);
  }
  for (const r of asArray(exDay?.runs)) {
    const id = runIdOf(r);
    if (!id || tombstoned.has(id)) continue;
    if (!runById.has(id)) {
      runById.set(id, r);
      runOrder.push(id);
    } else if (
      isEndedRun(r) && !isEndedRun(runById.get(id))
      || (
        isEndedRun(r) === isEndedRun(runById.get(id))
        && metaStampOf(r) > metaStampOf(runById.get(id))
      )
    ) {
      // Stored copy is strictly newer than the incoming one — keep it.
      runById.set(id, r);
    }
  }
  const mergedRuns: unknown[] = runOrder.map((id) => runById.get(id));

  // ── Per-run VALUE register merge (strictly-newer-stamp wins), additive ──────
  const outVals: Record<string, unknown> = {};
  const outUpd: Record<string, unknown> = {};
  const valueIds = new Set<string>([...Object.keys(exVals), ...Object.keys(inVals)]);
  for (const id of valueIds) {
    if (tombstoned.has(id)) continue; // a deleted run keeps no value
    const exStamp = asNumber(exUpd[id]);
    const inStamp = asNumber(inUpd[id]);
    const inHas = Object.prototype.hasOwnProperty.call(inVals, id);
    const exHas = Object.prototype.hasOwnProperty.call(exVals, id);
    if (inHas && inStamp > exStamp) {
      if (exHas && isBlankRunValue(inVals[id]) && !isBlankRunValue(exVals[id])) {
        // Empty-over-populated, even with a strictly-newer stamp. The original
        // stamp-only guard assumed the empty-value corruption ALWAYS carried an
        // EQUAL stamp (a transient all-default form re-emit pushed with the run's
        // durable stamp). But the system also produces populated-yet-UNSTAMPED
        // stored values — imports and the daily-rollover adopt run values without
        // calling markRunValuesUpdated, so exStamp is 0 (confirmed in production:
        // populated runValues with an empty runValuesUpdatedAt). A stale-but-
        // positive client stamp then beats exStamp 0 and an all-default value
        // wipes real data, re-infecting every peer on the next read (the
        // recurring "I entered it, refreshed, it vanished" loss). Mirror the
        // clients' isEmptyOverPopulated guard at this authoritative chokepoint:
        // keep the real value, but ADVANCE its stamp past the corrupt push so the
        // surviving value strictly wins on every peer (and heals the offending
        // client on its next read instead of stalemating on its stale stamp).
        outVals[id] = exVals[id];
        outUpd[id] = inStamp;
      } else {
        // Genuine, strictly-newer edit.
        outVals[id] = inVals[id];
        outUpd[id] = inStamp;
        // Field-level preservation: casesNeeded is the planned production target,
        // set once from the schedule and never modified during a live run. A peer
        // that synced the run without the schedule will have casesNeeded=0, and
        // any edit by that peer — even a genuine one — carries a 0 that would
        // silently wipe the target on every device. isBlankRunValue only blocks
        // a FULLY all-default run, not a partially-populated one. Protect
        // casesNeeded specifically: if the incoming edit has it at 0 but the
        // stored value has a positive target, preserve the stored target.
        if (
          exHas &&
          asNumber((inVals[id] as Record<string, unknown>).casesNeeded) === 0 &&
          asNumber((exVals[id] as Record<string, unknown>).casesNeeded) > 0
        ) {
          outVals[id] = {
            ...(outVals[id] as Record<string, unknown>),
            casesNeeded: asNumber((exVals[id] as Record<string, unknown>).casesNeeded),
          };
        }
      }
    } else if (exHas) {
      // Keep stored: preserves runs the push omitted and rejects equal/older
      // (incl. empty-value-with-equal-stamp) corruption.
      outVals[id] = exVals[id];
      outUpd[id] = exStamp;
    } else if (inHas) {
      // A brand-new run only the pusher has a value for yet.
      outVals[id] = inVals[id];
      outUpd[id] = inStamp;
    }
  }

  // Rebuild dayState with the merged run list, keeping every other incoming
  // dayState field (shiftNotes, overlays, resetAt, date, …). If the push omitted
  // dayState entirely, fall back to the stored one so its runs aren't lost.
  const base = inDay ?? exDay;
  // Merge prepPhase: prepStartedAt = earliest non-null (once started, never
  // un-started), batch counts = MAX (monotonically increasing), prepCarriedOver
  // = sticky true (once a run has been started with carry-over, keep it).
  const mergedPrepPhase = (() => {
    const toNum = (v: unknown) =>
      typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0;
    const inp =
      inDay && typeof inDay === "object"
        ? ((inDay as Record<string, unknown>).prepPhase as Record<string, unknown> | undefined)
        : undefined;
    const exp =
      exDay && typeof exDay === "object"
        ? ((exDay as Record<string, unknown>).prepPhase as Record<string, unknown> | undefined)
        : undefined;
    if (!inp && !exp) return undefined;
    const i = (inp && typeof inp === "object") ? inp : {};
    const e = (exp && typeof exp === "object") ? exp : {};
    const iSt = typeof i.prepStartedAt === "number" ? i.prepStartedAt : null;
    const eSt = typeof e.prepStartedAt === "number" ? e.prepStartedAt : null;
    const prepStartedAt =
      iSt !== null && eSt !== null
        ? Math.min(iSt, eSt)
        : iSt ?? eSt ?? null;
    return {
      prepStartedAt,
      prepBatchesDough: Math.max(toNum(i.prepBatchesDough), toNum(e.prepBatchesDough)),
      prepBatchesSauce: Math.max(toNum(i.prepBatchesSauce), toNum(e.prepBatchesSauce)),
      prepCarriedOver: !!(i.prepCarriedOver || e.prepCarriedOver),
    };
  })();
  const outDay = base
    ? { ...base, runs: mergedRuns, ...(mergedPrepPhase ? { prepPhase: mergedPrepPhase } : {}) }
    : undefined;

  const out: Record<string, unknown> = {
    ...incoming,
    runValues: outVals,
    runValuesUpdatedAt: outUpd,
  };
  if (outDay) out.dayState = outDay;

  // ── Additive union for master-data name registries ────────────────────────
  // These fields are maintained as additive name lists that grow as items are
  // added across devices. A fresh device (no localStorage) pushes empty arrays,
  // which would otherwise overwrite the server's populated lists via the
  // `...incoming` spread above — every other device would then see all their
  // brands/recipes vanish on the next SSE receive.
  //
  // Union-merge: include names from BOTH the incoming push AND the stored row.
  // The client already applies tombstones (deletedItems) on receive, so deleted
  // names are filtered out in the UI even if they persist in the union. The
  // brand→flavor map is merged per-brand with the same union semantics.
  const exData = existing as Record<string, unknown>;
  const ADDITIVE_LIST_FIELDS = [
    "brands",
    "ingredientTypes",
    "pepTypes",
    "cheeseRecipeNames",
    "mixRecipeNames",
    "doughRecipeNames",
    "frontlineRecipeNames",
  ] as const;
  for (const field of ADDITIVE_LIST_FIELDS) {
    const inArr = asArray(out[field]).filter((s): s is string => typeof s === "string");
    const exArr = asArray(exData[field]).filter((s): s is string => typeof s === "string");
    if (exArr.length > 0) {
      // Case-insensitive union: prefer the first-seen casing for each name
      // (inArr = incoming push, which comes from the client and has correct
      // capitalisation). A plain new Set() is case-sensitive and would keep
      // both "Aldo's" and "aldo's" as separate entries.
      const seen = new Map<string, string>();
      for (const s of [...inArr, ...exArr]) {
        const k = s.trim().toLowerCase();
        if (!seen.has(k)) seen.set(k, s.trim());
      }
      out[field] = [...seen.values()];
    }
  }
  // BrandFlavors: Record<brand, flavor[]> — union per-brand flavor arrays.
  const outBf = isPlainObject(out.brandFlavors) ? (out.brandFlavors as Record<string, unknown>) : {};
  const exBf  = isPlainObject(exData.brandFlavors) ? (exData.brandFlavors as Record<string, unknown>) : {};
  if (Object.keys(exBf).length > 0) {
    const mergedBf: Record<string, string[]> = {};
    const allBrands = new Set([...Object.keys(outBf), ...Object.keys(exBf)]);
    for (const brand of allBrands) {
      const inFlavors = Array.isArray(outBf[brand]) ? (outBf[brand] as unknown[]).filter((s): s is string => typeof s === "string") : [];
      const exFlavors = Array.isArray(exBf[brand]) ? (exBf[brand] as unknown[]).filter((s): s is string => typeof s === "string") : [];
      mergedBf[brand] = [...new Set([...inFlavors, ...exFlavors])];
    }
    out.brandFlavors = mergedBf;
  }

  // ── packagingProgress map merge ───────────────────────────────────────────
  // Merge independently from runValues using correctionGeneration/updatedAt
  // precedence rules (see mergePackagingProgress). Tombstoned runs drop metadata.
  const mergedProgress = mergePackagingProgress(
    (incoming as Record<string, unknown>).packagingProgress,
    exData.packagingProgress,
    tombstoned,
  );
  if (mergedProgress) {
    // Overlay winning counters into canonical runValues after the whole-value merge.
    overlayPackagingIntoRunValues(outVals, mergedProgress);
    out.packagingProgress = mergedProgress;
  } else {
    delete out.packagingProgress;
  }

  return withMergedStamps(out, incoming, existing);
}

// ── packagingProgress merge ───────────────────────────────────────────────────
// Optional top-level map: Record<runId, PackagingProgressEntry>.
// Each entry records live packaging counters for one run:
//   { skidsCompleted, casesOnCurrentSkid, correctionGeneration, updatedAt, manualOverrideUntil }
// Precedence rules (independent of runValues LWW stamps):
//   - Higher correctionGeneration always wins regardless of updatedAt.
//   - Same generation: higher updatedAt wins.
//   - Exact tie (same generation AND same updatedAt): keep stored entry.
//   - Missing incoming metadata cannot clobber established stored metadata.
//   - Tombstoned runs drop their metadata entry.
// After the whole-value merge, the winning (skidsCompleted, casesOnCurrentSkid)
// from packagingProgress are overlaid into the corresponding runValues entry so
// both maps stay in sync.

export interface PackagingProgressEntry {
  skidsCompleted: number;
  casesOnCurrentSkid: number;
  correctionGeneration: number;
  updatedAt: number;
  manualOverrideUntil: number;
}

function sanitizePackagingProgressEntry(v: unknown): PackagingProgressEntry | null {
  if (!isPlainObject(v)) return null;
  const fin = (x: unknown): x is number =>
    typeof x === "number" && Number.isFinite(x) && x >= 0;
  if (
    !fin(v.skidsCompleted) ||
    !fin(v.casesOnCurrentSkid) ||
    !fin(v.correctionGeneration) ||
    !fin(v.updatedAt) ||
    !fin(v.manualOverrideUntil)
  ) {
    return null;
  }
  return {
    skidsCompleted: v.skidsCompleted,
    casesOnCurrentSkid: v.casesOnCurrentSkid,
    correctionGeneration: v.correctionGeneration,
    updatedAt: v.updatedAt,
    manualOverrideUntil: v.manualOverrideUntil,
  };
}

// Merge a single incoming entry against a stored one using the precedence rules.
// Returns the winning entry, or null if neither side has a valid entry.
function mergePackagingEntry(
  incoming: PackagingProgressEntry | null,
  stored: PackagingProgressEntry | null,
): PackagingProgressEntry | null {
  if (!incoming && !stored) return null;
  if (!incoming) return stored;
  if (!stored) return incoming;
  // Higher correctionGeneration always wins.
  if (incoming.correctionGeneration > stored.correctionGeneration) return incoming;
  if (stored.correctionGeneration > incoming.correctionGeneration) return stored;
  // Same generation: higher updatedAt wins.
  if (incoming.updatedAt > stored.updatedAt) return incoming;
  if (stored.updatedAt > incoming.updatedAt) return stored;
  // Exact tie: keep stored.
  return stored;
}

// Merge packagingProgress maps from incoming and stored, respecting tombstones.
// Returns the merged map or undefined when both sides have nothing.
function mergePackagingProgress(
  incoming: unknown,
  stored: unknown,
  tombstoned: Set<string>,
): Record<string, PackagingProgressEntry> | undefined {
  const inMap = isPlainObject(incoming) ? incoming : null;
  const exMap = isPlainObject(stored) ? stored : null;
  if (!inMap && !exMap) return undefined;

  const out: Record<string, PackagingProgressEntry> = {};

  // Collect all known run ids from both sides.
  const allIds = new Set<string>([
    ...Object.keys(inMap ?? {}),
    ...Object.keys(exMap ?? {}),
  ]);

  for (const id of allIds) {
    if (tombstoned.has(id)) continue;
    const inEntry = inMap ? sanitizePackagingProgressEntry(inMap[id]) : null;
    const exEntry = exMap ? sanitizePackagingProgressEntry(exMap[id]) : null;
    // Missing incoming metadata cannot clobber established stored metadata:
    // if incoming has no entry for this id but stored does, keep stored.
    const winner = mergePackagingEntry(inEntry, exEntry);
    if (winner) out[id] = winner;
  }

  return Object.keys(out).length > 0 ? out : undefined;
}

// After the whole-value merge, overlay the winning packaging counters into
// the runValues map so both remain consistent.
function overlayPackagingIntoRunValues(
  outVals: Record<string, unknown>,
  progress: Record<string, PackagingProgressEntry>,
): void {
  for (const [id, entry] of Object.entries(progress)) {
    if (!isPlainObject(outVals[id])) continue;
    outVals[id] = {
      ...(outVals[id] as Record<string, unknown>),
      skidsCompleted: entry.skidsCompleted,
      casesOnCurrentSkid: entry.casesOnCurrentSkid,
    };
  }
}

// ── Sync payload sanitizer ────────────────────────────────────────────────────
// Strips unknown top-level keys and enforces size/content limits on additive
// name-list fields before the payload enters the protective merge or the DB.
// This closes the injection vector where an authenticated user could push
// arbitrary top-level keys or flood list fields (up to the 10 MB body limit)
// that every connected SSE client would then receive.

/** Maximum number of entries allowed in any name-list array. */
const MAX_LIST_ENTRIES = 500;
/** Maximum characters allowed in a single name-list string. */
const MAX_LIST_STRING_LEN = 200;
/** Maximum characters allowed in dayState.shiftNotes. */
const MAX_SHIFT_NOTES_LEN = 2000;
/** Maximum number of runs allowed in dayState.runs (and runValues). */
const MAX_RUNS = 50;
/**
 * Maximum aggregate JSON size (bytes) for the sanitized payload.
 * A legitimate day-state blob (full recipes, run values, master-data lists for
 * one facility) is well under 200 KB. 512 KB gives generous headroom while
 * bounding the shared-state DoS risk from known complex fields (templates,
 * history, presets, profiles, run values, …) that are not individually capped.
 */
const MAX_AGGREGATE_BYTES = 512 * 1024;

// All top-level keys a legitimate sync push may contain (union of web + mobile
// types.ts / payloadTypes.ts). Any key NOT in this set is stripped before the
// payload reaches upsertProtected or the DB.
const KNOWN_TOP_LEVEL_KEYS = new Set<string>([
  "syncVersion", "completeness", "baseSnapshotId",
  "dayState",
  "runValues",
  "runValuesUpdatedAt",
  "brands",
  "brandFlavors",
  "ingredientTypes",
  "templates",
  "history",
  "pepTypes",
  "dieTypes",
  "circles",
  "shipper",
  "skidStacking",
  "gripSheets",
  "cheeseIngredients",
  "doughIngredients",
  "frontlineIngredients",
  "mixIngredients",
  "doughRecipeNames",
  "doughRecipePresets",
  "frontlineRecipeNames",
  "frontlineRecipePresets",
  "cheeseRecipeNames",
  "cheeseRecipePresets",
  "mixRecipeNames",
  "brandProfiles",
  "crustProfiles",
  "mergedAway",
  "deletedItems",
  "deletedStamps",
  "undeletedStamps",
  "packagingProgress",
]);

// Name-list fields that are additive string arrays — each entry is a single
// user-visible name (brand, recipe, ingredient type, etc.). These are the
// fields most exposed to flooding: a single push can inject 10 MB of strings
// that every SSE subscriber receives. Cap both total entry count and per-entry
// length.
const ADDITIVE_STRING_ARRAY_KEYS = new Set<string>([
  "brands",
  "ingredientTypes",
  "pepTypes",
  "dieTypes",
  "circles",
  "shipper",
  "skidStacking",
  "gripSheets",
  "cheeseIngredients",
  "doughIngredients",
  "frontlineIngredients",
  "mixIngredients",
  "doughRecipeNames",
  "frontlineRecipeNames",
  "cheeseRecipeNames",
  "mixRecipeNames",
]);

// Known sub-keys of the dayState object. Any other key is stripped so clients
// cannot inject arbitrary content into the shared day-state under dayState.*.
const KNOWN_DAYSTATE_KEYS = new Set<string>([
  "runs",
  "shiftNotes",
  "runToTime",
  "resetAt",
  "date",
  "substitutions",
  "substitutionLog",
  "stagedItems",
  "prepPhase",
]);

function capStringArray(arr: unknown[]): string[] {
  return arr
    .filter((s): s is string => typeof s === "string")
    .slice(0, MAX_LIST_ENTRIES)
    .map((s) => s.slice(0, MAX_LIST_STRING_LEN));
}

/**
 * Strip unknown top-level keys from a sync payload and enforce size/content
 * limits on additive name-list fields and known dayState sub-fields.
 *
 * This is a defence-in-depth gate applied BEFORE protectRunValues so that
 * attacker-controlled keys and oversized lists never reach the DB or SSE
 * broadcast path. The function is intentionally permissive about the SHAPE of
 * fields it does not understand (objects, arrays of objects, etc.) — it only
 * enforces the whitelist and limits for the high-risk list fields.
 */
export function sanitizeSyncPayload(payload: unknown): unknown {
  if (!isPlainObject(payload)) return payload;

  const out: Record<string, unknown> = {};

  for (const key of Object.keys(payload)) {
    if (!KNOWN_TOP_LEVEL_KEYS.has(key)) continue; // drop unknown keys

    const val = payload[key];

    if (ADDITIVE_STRING_ARRAY_KEYS.has(key)) {
      // Cap count and per-entry length for name-list string arrays.
      out[key] = capStringArray(asArray(val));
    } else if (key === "brandFlavors") {
      // Record<brand, flavor[]> — cap both brand count and per-brand flavors.
      if (isPlainObject(val)) {
        const bf: Record<string, string[]> = {};
        const brands = Object.keys(val).slice(0, MAX_LIST_ENTRIES);
        for (const brand of brands) {
          const cappedBrand = brand.slice(0, MAX_LIST_STRING_LEN);
          bf[cappedBrand] = capStringArray(asArray(val[brand]));
        }
        out[key] = bf;
      }
    } else if (key === "dayState") {
      // Strip unknown dayState sub-keys and cap free-text fields + run count.
      if (isPlainObject(val)) {
        const ds: Record<string, unknown> = {};
        for (const dsk of Object.keys(val)) {
          if (!KNOWN_DAYSTATE_KEYS.has(dsk)) continue; // drop unknown dayState keys
          if (dsk === "shiftNotes") {
            // Cap free-text notes to prevent bloat via dayState injection.
            ds[dsk] = typeof val[dsk] === "string"
              ? (val[dsk] as string).slice(0, MAX_SHIFT_NOTES_LEN)
              : undefined;
          } else if (dsk === "runs") {
            // Cap run count: a facility will never legitimately have more than
            // MAX_RUNS runs in a single day. Truncate rather than reject so that
            // a marginal client push doesn't lose partial data.
            ds[dsk] = asArray(val[dsk]).slice(0, MAX_RUNS);
          } else {
            ds[dsk] = val[dsk];
          }
        }
        out[key] = ds;
      }
    } else if (key === "runValues" || key === "runValuesUpdatedAt") {
      // Cap the number of run-value entries to MAX_RUNS so this map cannot be
      // used to store an unbounded number of run objects.
      if (isPlainObject(val)) {
        const capped: Record<string, unknown> = {};
        let count = 0;
        for (const [k, v] of Object.entries(val)) {
          if (count >= MAX_RUNS) break;
          capped[k] = v;
          count++;
        }
        out[key] = capped;
      }
    } else if (key === "packagingProgress") {
      // Cap at MAX_RUNS entries; each entry must have only finite nonnegative
      // numeric fields — sanitize each entry strictly.
      if (isPlainObject(val)) {
        const capped: Record<string, PackagingProgressEntry> = {};
        let count = 0;
        for (const [k, v] of Object.entries(val)) {
          if (count >= MAX_RUNS) break;
          const entry = sanitizePackagingProgressEntry(v);
          if (entry) {
            capped[k] = entry;
            count++;
          }
        }
        out[key] = capped;
      }
    } else {
      // All other known keys (objects, presets, history, etc.) pass through
      // as-is; the protective merge handles the structural invariants for the
      // ones that matter (runValues, deletedItems, stamps).
      out[key] = val;
    }
  }

  // Final aggregate size guard: after all structural sanitization, ensure the
  // remaining payload is within the allowed UTF-8 byte budget. Complex known
  // fields (templates, history, presets, profiles) are not individually capped
  // above, so this catches any remaining bulk injection through those paths.
  // Use Buffer.byteLength (UTF-8 bytes) rather than .length (UTF-16 code units)
  // so that Unicode-heavy payloads can't sneak past by packing multi-byte chars.
  // Return null to signal "too large" to the caller — the route rejects with 400.
  try {
    if (Buffer.byteLength(JSON.stringify(out), "utf8") > MAX_AGGREGATE_BYTES) {
      return null;
    }
  } catch {
    return null; // un-serialisable payload — reject
  }

  return out;
}

/**
 * Returns true when `sanitizeSyncPayload` signalled that the payload was too
 * large (it returns null in that case). Use at the route level to reject with
 * 400 before persisting or broadcasting.
 */
export function isSyncPayloadTooLarge(sanitized: unknown): sanitized is null {
  return sanitized === null;
}

/** Maximum number of namespaces in a stamp map (deletedStamps / undeletedStamps). */
const MAX_STAMP_NAMESPACES = 50;
/** Maximum number of name entries per namespace in a stamp map. */
const MAX_STAMP_ENTRIES_PER_NS = 500;

// "Bulk optional" fields that can be trimmed from the merged blob when the
// aggregate byte limit is exceeded after the union merge. These fields are
// historical / master-data caches that clients always re-send on the next push;
// trimming them degrades performance slightly but never loses run data.
const TRIMMABLE_BULK_FIELDS = [
  "history",
  "templates",
  "doughRecipePresets",
  "frontlineRecipePresets",
  "cheeseRecipePresets",
  "brandProfiles",
  "crustProfiles",
  "mergedAway",
  // brandFlavors is a derived lookup rebuilt from profiles on every push, so
  // it is safe to drop under budget pressure. It must be here (not only capped
  // by entry count) because 500 brands × 500 flavors × 200 chars can reach
  // ~50 MB — far beyond the 512 KB merged-blob budget.
  "brandFlavors",
] as const;

/**
 * Apply the same structural caps as `sanitizeSyncPayload` to the MERGED blob
 * produced by `protectRunValues`. This prevents incremental growth via
 * successive disjoint pushes that each individually satisfy the incoming caps.
 *
 * Unlike `sanitizeSyncPayload`, this function:
 *   - Never rejects with null (the merge is already committed; hard-reject
 *     would lose run data). Instead it caps in place.
 *   - Does NOT apply the top-level key whitelist (protectRunValues only ever
 *     produces known keys).
 *   - Trims bulk optional fields when the aggregate size still exceeds the
 *     budget after structural capping, preserving run/value data.
 */
export function capMergedResult(merged: unknown): unknown {
  if (!isPlainObject(merged)) return merged;

  const out: Record<string, unknown> = { ...(merged as Record<string, unknown>) };

  // Cap additive string arrays.
  for (const field of ADDITIVE_STRING_ARRAY_KEYS) {
    if (field in out) {
      out[field] = asArray(out[field])
        .filter((s): s is string => typeof s === "string")
        .slice(0, MAX_LIST_ENTRIES)
        .map((s) => s.slice(0, MAX_LIST_STRING_LEN));
    }
  }

  // Cap brandFlavors.
  if (isPlainObject(out.brandFlavors)) {
    const bf: Record<string, string[]> = {};
    const brands = Object.keys(out.brandFlavors as object).slice(0, MAX_LIST_ENTRIES);
    for (const brand of brands) {
      const cappedBrand = brand.slice(0, MAX_LIST_STRING_LEN);
      bf[cappedBrand] = asArray((out.brandFlavors as Record<string, unknown>)[brand])
        .filter((s): s is string => typeof s === "string")
        .slice(0, MAX_LIST_ENTRIES)
        .map((s) => s.slice(0, MAX_LIST_STRING_LEN));
    }
    out.brandFlavors = bf;
  }

  // Cap dayState.runs.
  if (isPlainObject(out.dayState)) {
    const ds = out.dayState as Record<string, unknown>;
    if (Array.isArray(ds.runs) && ds.runs.length > MAX_RUNS) {
      out.dayState = { ...ds, runs: ds.runs.slice(0, MAX_RUNS) };
    }
  }

  // Cap runValues / runValuesUpdatedAt.
  for (const key of ["runValues", "runValuesUpdatedAt"] as const) {
    if (isPlainObject(out[key])) {
      const entries = Object.entries(out[key] as object);
      if (entries.length > MAX_RUNS) {
        const capped: Record<string, unknown> = {};
        for (const [k, v] of entries.slice(0, MAX_RUNS)) capped[k] = v;
        out[key] = capped;
      }
    }
  }

  // Cap packagingProgress at MAX_RUNS entries; re-sanitize each entry to
  // ensure only finite nonneg numeric fields survive incremental merges.
  if (isPlainObject(out.packagingProgress)) {
    const entries = Object.entries(out.packagingProgress as object);
    const capped: Record<string, PackagingProgressEntry> = {};
    let count = 0;
    for (const [k, v] of entries) {
      if (count >= MAX_RUNS) break;
      const entry = sanitizePackagingProgressEntry(v);
      if (entry) {
        capped[k] = entry;
        count++;
      }
    }
    if (count > 0) {
      out.packagingProgress = capped;
    } else {
      delete out.packagingProgress;
    }
  }

  // Cap deletedItems.runs (run tombstone list) — union-merged by protectRunValues;
  // successive disjoint pushes accumulate ids without this cap.
  if (isPlainObject(out.deletedItems)) {
    const di = out.deletedItems as Record<string, unknown>;
    if (Array.isArray(di.runs) && di.runs.length > MAX_RUNS) {
      out.deletedItems = { ...di, runs: di.runs.slice(0, MAX_RUNS) };
    }
  }

  // Cap deletion/un-deletion stamp maps. These are union-merged by
  // `withMergedStamps`, so successive disjoint pushes accumulate entries
  // unboundedly without this cap. Apply per-namespace and per-entry limits
  // plus key/value type guards (values must be non-negative timestamps).
  for (const stampKey of ["deletedStamps", "undeletedStamps"] as const) {
    if (isPlainObject(out[stampKey])) {
      const src = out[stampKey] as Record<string, unknown>;
      const cappedMap: Record<string, Record<string, number>> = {};
      let nsCount = 0;
      for (const [ns, names] of Object.entries(src)) {
        if (nsCount >= MAX_STAMP_NAMESPACES) break;
        if (!isPlainObject(names)) continue;
        const cappedNs: Record<string, number> = {};
        let entryCount = 0;
        for (const [name, ts] of Object.entries(names)) {
          if (entryCount >= MAX_STAMP_ENTRIES_PER_NS) break;
          const n = asNumber(ts);
          if (n > 0) {
            cappedNs[name.slice(0, MAX_LIST_STRING_LEN)] = n;
            entryCount++;
          }
        }
        if (Object.keys(cappedNs).length > 0) {
          cappedMap[ns.slice(0, MAX_LIST_STRING_LEN)] = cappedNs;
          nsCount++;
        }
      }
      out[stampKey] = cappedMap;
    }
  }

  // Aggregate size guard — pass 1: strip bulk optional fields one by one until
  // the blob fits within the budget. This degrades performance (clients
  // re-upload on the next push) but preserves run data integrity.
  for (const field of TRIMMABLE_BULK_FIELDS) {
    try {
      if (Buffer.byteLength(JSON.stringify(out), "utf8") <= MAX_AGGREGATE_BYTES) break;
    } catch {
      // un-serialisable — keep trimming
    }
    if (field in out) {
      delete out[field];
    }
  }

  // Aggregate size guard — pass 2: drop stamp maps if still over budget.
  // Stamp entries are advisory (deletion UI) — dropping them causes cosmetic
  // glitches but never corrupts production data.
  for (const stampKey of ["deletedStamps", "undeletedStamps"] as const) {
    try {
      if (Buffer.byteLength(JSON.stringify(out), "utf8") <= MAX_AGGREGATE_BYTES) break;
    } catch {
      // keep trimming
    }
    if (stampKey in out) {
      delete out[stampKey];
    }
  }

  // Aggregate size guard — pass 3 (comprehensive hard guarantee): enforce the
  // 512 KB limit across ALL retained fields, including any legacy-row values
  // that were merged from the DB without ever passing through the incoming
  // sanitizer (e.g. an existing oversized shiftNotes, substitutions array, or
  // stagedItems object written before this guard existed). The trimming cascade
  // removes content in priority order — most expendable first — so run data
  // is the last thing ever dropped.
  function overBudget(): boolean {
    try {
      return Buffer.byteLength(JSON.stringify(out), "utf8") > MAX_AGGREGATE_BYTES;
    } catch {
      return true; // un-serialisable → must trim
    }
  }

  // 3a: Cap shiftNotes in the merged dayState. Legacy rows may have been written
  //     before the incoming sanitizer was in place and could hold uncapped values.
  if (isPlainObject(out.dayState)) {
    const ds = out.dayState as Record<string, unknown>;
    if (typeof ds.shiftNotes === "string" && ds.shiftNotes.length > MAX_SHIFT_NOTES_LEN) {
      out.dayState = { ...ds, shiftNotes: ds.shiftNotes.slice(0, MAX_SHIFT_NOTES_LEN) };
    }
  }

  // 3b: Drop optional dayState sub-fields one by one (least critical first).
  //     These fields are useful for the shift but clients re-derive them locally;
  //     dropping them causes cosmetic degradation but preserves run integrity.
  const DROPPABLE_DAYSTATE_KEYS = [
    "substitutionLog",
    "substitutions",
    "stagedItems",
    "prepPhase",
    "runToTime",
    "shiftNotes",
    "date",
  ] as const;
  if (overBudget() && isPlainObject(out.dayState)) {
    const ds = { ...(out.dayState as Record<string, unknown>) };
    for (const k of DROPPABLE_DAYSTATE_KEYS) {
      if (!overBudget()) break;
      // Need to re-stringify with each drop; reassign out.dayState so overBudget() sees it.
      delete ds[k];
      out.dayState = ds;
    }
  }

  // 3c: Trim runValues entries from the tail (they're large objects).
  while (overBudget() && isPlainObject(out.runValues)) {
    const keys = Object.keys(out.runValues as object);
    if (keys.length === 0) break;
    const updated = { ...(out.runValues as Record<string, unknown>) };
    delete updated[keys[keys.length - 1]!];
    out.runValues = updated;
  }

  // Mirror: trim runValuesUpdatedAt to match runValues key count.
  if (isPlainObject(out.runValues) && isPlainObject(out.runValuesUpdatedAt)) {
    const remaining = new Set(Object.keys(out.runValues as object));
    const trimmed: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(out.runValuesUpdatedAt as object)) {
      if (remaining.has(k)) trimmed[k] = v;
    }
    out.runValuesUpdatedAt = trimmed;
  }

  // 3d: Trim dayState.runs from the tail if still over budget.
  while (overBudget() && isPlainObject(out.dayState)) {
    const runs = (out.dayState as Record<string, unknown>).runs;
    if (!Array.isArray(runs) || runs.length === 0) break;
    out.dayState = { ...(out.dayState as Record<string, unknown>), runs: runs.slice(0, -1) };
  }

  // 3e: Absolute last resort — if a single run object is itself enormous (or
  //     some other retained mandatory field is very large), clear runs entirely
  //     rather than ever writing an oversized row. The clients will re-send their
  //     local run data on the next push and the merge will restore it.
  if (overBudget()) {
    if (isPlainObject(out.dayState)) {
      const ds = out.dayState as Record<string, unknown>;
      out.dayState = { runs: [], resetAt: typeof ds.resetAt === "number" ? ds.resetAt : 0 };
    }
    out.runValues = {};
    out.runValuesUpdatedAt = {};
  }

  // 3f: True hard guarantee — after all cascade steps, strip any remaining
  //     top-level keys (except the minimum needed for run recovery) until the
  //     blob actually fits. This is the unconditional backstop that makes the
  //     512 KB limit a real invariant rather than a best-effort bound.
  if (overBudget()) {
    // Drop every top-level key except the core run-recovery fields.
    const ESSENTIAL_KEYS = new Set(["dayState", "runValues", "runValuesUpdatedAt", "dayStateUpdatedAt"]);
    const allKeys = Object.keys(out);
    for (const k of allKeys) {
      if (ESSENTIAL_KEYS.has(k)) continue;
      delete out[k];
      if (!overBudget()) break;
    }
  }

  return out;
}
