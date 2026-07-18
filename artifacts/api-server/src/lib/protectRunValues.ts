// Per-run + run-list protective merge for the shared day-state sync row.
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
  mixerLowSec: 0,
  mixerHighSec: 0,
  hopperSec: 0,
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

// True when a run value is an exact all-default/blank template (see above):
// the current all-zero shape, the old-field-set legacy template, or the
// current shape carrying the exact four-field legacy pep-25 signature.
function isBlankRunValue(v: unknown): boolean {
  if (!isPlainObject(v)) return false;
  if (deepEqualValue(v, CURRENT_BLANK_RUN_VALUE)) return true;
  if (deepEqualValue(v, LEGACY_BLANK_RUN_VALUE)) return true;
  if (LEGACY_PEP_BATCH_FIELDS.every((f) => v[f] === 25)) {
    const normalized: Record<string, unknown> = { ...v };
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
  const del = mergeStampMap(incoming.deletedStamps, existing?.deletedStamps);
  const undel = mergeStampMap(incoming.undeletedStamps, existing?.undeletedStamps);
  if (Object.keys(del).length > 0) out.deletedStamps = del;
  else delete out.deletedStamps; // scrub junk carried in by the incoming spread
  if (Object.keys(undel).length > 0) out.undeletedStamps = undel;
  else delete out.undeletedStamps;
  return out;
}

/**
 * Merge `incoming` against the already-stored `existing` payload so that:
 *   - a run's stored VALUE only changes on a strictly-newer-stamped edit, and
 *   - a stored RUN is never dropped by a push that omits it (additive run list),
 *   - unless the run was explicitly deleted (tombstoned) or the day was reset.
 * Returns a new payload object. Non-object payloads are returned unchanged.
 */
export function protectRunValues(incoming: unknown, existing: unknown): unknown {
  if (!isPlainObject(incoming)) return incoming;
  // Nothing stored yet (first write for this scope+date) — accept as-is.
  if (!isPlainObject(existing)) return incoming;

  const inDay = isPlainObject(incoming.dayState) ? incoming.dayState : undefined;
  const exDay = isPlainObject(existing.dayState) ? existing.dayState : undefined;

  // A true daily reset bumps resetAt strictly forward and intends a fresh day:
  // adopt the incoming payload wholesale (matches the clients' reset semantics)
  // so its empty maps clear the stored day rather than being protected back in.
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
  if (exReset > 0 && inReset > exReset) return withMergedStamps({ ...incoming }, incoming, existing);

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
    } else if (metaStampOf(r) > metaStampOf(runById.get(id))) {
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
  const outDay = base ? { ...base, runs: mergedRuns } : undefined;

  const out: Record<string, unknown> = {
    ...incoming,
    runValues: outVals,
    runValuesUpdatedAt: outUpd,
  };
  if (outDay) out.dayState = outDay;
  return withMergedStamps(out, incoming, existing);
}
