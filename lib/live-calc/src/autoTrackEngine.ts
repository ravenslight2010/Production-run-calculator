// Pure auto-track decision math (refactor step 6b foundation).
//
// The web auto-track hook (artifacts/run-calculator/src/hooks/useAutoTrack.ts)
// contains ~1,600 lines mixing React refs/timers with the math that decides
// WHEN each counter is due and WHAT it writes. This module extracts the pure
// parts so they can be unit-tested in isolation and eventually shared with the
// server (Steps 6b/6c). It is a verbatim extraction — the hook delegates here
// with zero behavior change.
//
// Unit convention (kept exactly as the web hook):
//   - Wall-clock channel timings are milliseconds.
//   - Net-second channels (sauce barrel, applicator batches) use RUN SECONDS
//     of pause-aware elapsed time; pauses consume no net time.

/** Suggested dough staging for a run — the same numbers the "Suggest" button
 * applies to the Trays on Line / Batches Ready steppers. Derived from the
 * CURRENT deficit (traysNeeded/batchesNeeded), capped to a sane staging
 * quantity (40 trays / 3 batches). This suggestion is not a persisted tray
 * capacity: traysOnLine remains an uncapped aggregate so automatic tracking
 * never discards valid staged dough. Kept at verbatim parity with mobile
 * RunContext's suggestedDoughStaging. */
export type SuggestedDoughStagingReturn = { trays: number | null; batches: number | null };

export function suggestedDoughStaging(
  traysNeeded: number,
  batchesNeeded: number,
): SuggestedDoughStagingReturn {
  return {
    trays: traysNeeded > 0
      ? Math.max(1, Math.round(Math.min(40, traysNeeded)))
      : null,
    batches: batchesNeeded > 0
      ? Math.min(3, Math.max(1, Math.ceil(Math.min(3, batchesNeeded))))
      : null,
  };
}

// Each counter ticks at its own natural production pace, clamped to a sane
// range: never faster than once per 1s (the app clock resolution) and never
// slower than once per hour (a stalled/garbage rate must not freeze the
// counter forever).
//
// NOTE: distinct from autoTrackSchedule.ts's clampPeriodMs (server semantics:
// invalid -> 0, floor 2s). Web behavior is invalid -> 1h, floor 1s. Keep the
// names distinct to prevent cross-contamination.
export function clampWebPeriodMs(ms: number): number {
  if (!Number.isFinite(ms) || ms <= 0) return 60 * 60 * 1000;
  return Math.min(60 * 60 * 1000, Math.max(1000, ms));
}

export interface AutoTrackTiming {
  caseMs: number;
  trayMs: number;
  trayProductionMs: number;
  batchConsumptionMs: number;
  batchProductionMs: number;
  hopperMs: number;
}

/**
 * The single cadence contract shared by auto-track scheduling and countdown UI.
 * Consumption remains quarter-batch internally so fractional inventory movement
 * stays visible; the UI labels that event as such rather than calling it a
 * full-batch completion.
 */
export function getAutoTrackTiming(
  ppm: number,
  pizzasPerCase: number,
  perTray: number,
  perBatch: number,
  machine?: { spinSec: number; hopperSec: number },
): AutoTrackTiming {
  const caseMs = ppm > 0 && pizzasPerCase > 0
    ? clampWebPeriodMs((pizzasPerCase / ppm) * 60000)
    : 0;
  const trayMs = ppm > 0 && perTray > 0
    ? clampWebPeriodMs((perTray / ppm) * 60000)
    : 0;
  const lineBatchMs = ppm > 0 && perBatch > 0
    ? (perBatch / ppm) * 60000
    : 0;
  const hopperMs = machine && Number.isFinite(machine.hopperSec) && machine.hopperSec > 0
    ? clampWebPeriodMs(machine.hopperSec * 1000)
    : 0;
  const effectiveDrainMs = Math.max(hopperMs, lineBatchMs);
  const batchConsumptionMs = effectiveDrainMs > 0
    ? clampWebPeriodMs(effectiveDrainMs / 4)
    : 0;
  const spinMs = machine && Number.isFinite(machine.spinSec) && machine.spinSec > 0
    ? machine.spinSec * 1000
    : 0;
  const batchProductionMs = spinMs > 0
    ? clampWebPeriodMs(spinMs)
    : (lineBatchMs > 0 ? clampWebPeriodMs(lineBatchMs) : 0);
  return {
    caseMs,
    trayMs,
    trayProductionMs: trayMs > 0 ? trayMs / 2 : 0,
    batchConsumptionMs,
    batchProductionMs,
    hopperMs,
  };
}

export type AutoTrackSuggestionInput = {
  runStatus: "pending" | "running" | "paused" | "ended";
  drainActive: boolean;
  packagingDrainActive: boolean;
  packagingDrainElapsedSec: number;
  ppm: number;
  casesPerSkid: number;
  pizzasPerCase: number;
  casesNeeded: number;
  freezerTime: number;
  elapsedBatchSec: number;
};

export type AutoTrackSuggestion = {
  skids: number;
  casesOnSkid: number;
  expectedCases: number;
  /** Unclamped time-based total — drives the incremental delta below. */
  expectedCasesRaw: number;
  trays: null;
  batches: null;
};

/** The autoTrackSuggestion memo, pure. Cases are clamped at display/write time
 * to the run's total need; the RAW total is the incremental-delta source so a
 * downward manual correction can still climb again. */
export function computeAutoTrackSuggestion(
  input: AutoTrackSuggestionInput,
): AutoTrackSuggestion | null {
  const ok =
    (input.runStatus === "running" || input.runStatus === "paused" || input.drainActive) &&
    input.ppm > 0 &&
    input.casesPerSkid > 0 &&
    input.pizzasPerCase > 0;
  if (!ok) return null;

  const maxSkids = Math.floor(input.casesNeeded / input.casesPerSkid);
  const elapsedMin = input.elapsedBatchSec / 60;
  const elapsedMinAfterTunnel = Math.max(0, elapsedMin - Number(input.freezerTime));
  // Clamp to the run's total need so skids/cases freeze at their final state
  // once production is complete instead of cycling past it (modulo wrap).
  const expectedCasesRaw = input.packagingDrainActive
    ? Math.floor((Math.max(0, input.packagingDrainElapsedSec) * input.ppm) / (input.pizzasPerCase * 60))
    : Math.floor((elapsedMinAfterTunnel * input.ppm) / input.pizzasPerCase);
  const expectedCases = input.casesNeeded > 0 ? Math.min(input.casesNeeded, expectedCasesRaw) : expectedCasesRaw;

  return {
    skids: Math.min(maxSkids, Math.floor(expectedCases / input.casesPerSkid)),
    casesOnSkid: Math.min(input.casesPerSkid, expectedCases % input.casesPerSkid),
    expectedCases,
    // Unclamped time-based total — drives the INCREMENTAL delta below so that a
    // downward manual correction (e.g. after the estimate ran ahead and hit the
    // casesNeeded clamp) can still climb again. The clamp lives only on what is
    // displayed/written, not on the delta source.
    expectedCasesRaw,
    // Tray/batch suggestions are handled incrementally in the write effect;
    // returning null here means the UI falls back to the calc-based suggestion.
    trays: null,
    batches: null,
  };
}

export type AppSlotKey = "app1" | "app2" | "app3" | "app4";

export type AppSlotInfo = {
  recipeLbs: number;
  effectiveBatchLbs: number;
  /** Seconds per applicator batch; 0/invalid disables the slot. */
  cadence: number;
  /** Claim gate: non-empty non-mix type, positive effective batch/oz/required/ppm. */
  validForClaim: boolean;
};

/** Per-applicator-slot math shared by the anchor-rebase effect, the claim
 * effect, and (later) server-side scheduling. Cadence is computed whenever the
 * numeric inputs are positive regardless of the type/mix claim gate, matching
 * both existing hook effects. */
export function computeAppSlotInfo(input: {
  type: string;
  recipe: Array<{ lbs: number }> | undefined;
  batchLbs: number;
  ozPerPizza: number;
  required: number;
  ppm: number;
}): AppSlotInfo {
  const recipeLbs = (input.recipe ?? []).reduce((sum, row) => sum + (Number(row.lbs) || 0), 0);
  const effectiveBatchLbs = recipeLbs > 0 ? recipeLbs : input.batchLbs;
  const type = String(input.type).trim();
  return {
    recipeLbs,
    effectiveBatchLbs,
    cadence: effectiveBatchLbs > 0 && input.ozPerPizza > 0 && input.ppm > 0
      ? (effectiveBatchLbs * 16 / input.ozPerPizza / input.ppm) * 60
      : 0,
    validForClaim: !!type &&
      !type.toLowerCase().includes("mix") &&
      effectiveBatchLbs > 0 && input.ozPerPizza > 0 && input.required > 0 && input.ppm > 0,
  };
}

/** Net-second channel due time: a pending armed due wins; otherwise rebase
 * from the persisted anchor + cadence. Pauses consume no net time. */
export function computeNetSecondDue(input: {
  currentDue: number;
  anchor: number;
  cadence: number;
}): number {
  return input.currentDue > 0 ? input.currentDue : input.anchor + input.cadence;
}

export type CaseClaimMutation = {
  field: "skidsCompleted" | "casesOnCurrentSkid";
  from: number;
  to: number;
};

export function buildCaseClaimMutations(input: {
  skidsFrom: number;
  skidsTo: number;
  casesFrom: number;
  casesTo: number;
}): CaseClaimMutation[] {
  return [
    { field: "skidsCompleted", from: input.skidsFrom, to: input.skidsTo },
    { field: "casesOnCurrentSkid", from: input.casesFrom, to: input.casesTo },
  ];
}

export type SauceClaimMutation = {
  field: "sauceBarrelsMade" | "sauceBarrelAnchorNetSec" | "sauceBarrelCorrectionGeneration";
  from: number;
  to: number;
};

export function buildSauceClaimMutations(input: {
  countFrom: number;
  countTo: number;
  anchorFrom: number;
  anchorTo: number;
  correctionGeneration: number;
}): SauceClaimMutation[] {
  return [
    { field: "sauceBarrelsMade", from: input.countFrom, to: input.countTo },
    { field: "sauceBarrelAnchorNetSec", from: input.anchorFrom, to: input.anchorTo },
    { field: "sauceBarrelCorrectionGeneration", from: input.correctionGeneration, to: input.correctionGeneration },
  ];
}

export type AppSlotClaimMutation = {
  field:
    | "app1BatchesMade" | "app1BatchAnchorNetSec" | "app1BatchCorrectionGeneration"
    | "app2BatchesMade" | "app2BatchAnchorNetSec" | "app2BatchCorrectionGeneration"
    | "app3BatchesMade" | "app3BatchAnchorNetSec" | "app3BatchCorrectionGeneration"
    | "app4BatchesMade" | "app4BatchAnchorNetSec" | "app4BatchCorrectionGeneration";
  from: number;
  to: number;
};

export function buildAppSlotClaimMutations(input: {
  slot: AppSlotKey;
  madeFrom: number;
  madeTo: number;
  anchorFrom: number;
  anchorTo: number;
  correctionGeneration: number;
}): AppSlotClaimMutation[] {
  return [
    { field: `${input.slot}BatchesMade`, from: input.madeFrom, to: input.madeTo },
    { field: `${input.slot}BatchAnchorNetSec`, from: input.anchorFrom, to: input.anchorTo },
    { field: `${input.slot}BatchCorrectionGeneration`, from: input.correctionGeneration, to: input.correctionGeneration },
  ];
}

// ── Per-tick write decisions (engine PR #2) ─────────────────────────────────
// These mirror the useAutoTrack write effect exactly. Each returns the
// decision/values; the hook owns the ref mutations and commitAutomatic calls.
// The server reuses the same math for Step 6c (server-owned tick execution).

export type CaseTickWriteDecision =
  | { action: "seed"; newTotal: number; caseClaimRetryReset: true; formResetSkippedNew: boolean }
  | { action: "write"; newTotal: number; caseClaimRetryReset: false; formResetSkippedNew: boolean }
  | { action: "reset-skip"; newTotal: number; caseClaimRetryReset: false; formResetSkippedNew: true }
  | { action: "none"; newTotal: number; caseClaimRetryReset: false; formResetSkippedNew: boolean };

/** Cases/skids per-tick write decision (drain path, first-tick seed, and the
 * incremental delta with its stale-delta reset guard). All case bookkeeping
 * (due, expected baseline, freezer baseline) advances unconditionally in the
 * caller BEFORE this runs, so the inputs here are the PRE-tick baselines plus
 * the newly advanced freezer value. */
export function computeCaseTickWrite(input: {
  prevExpected: number;
  expectedRaw: number;
  expectedCases: number;
  prevFreezer: number;
  nextFreezer: number;
  curTotal: number;
  casesPerSkid: number;
  casesNeeded: number;
  drainActive: boolean;
  packagingDrainActive: boolean;
  caseClaimRetry: boolean;
  formResetSkipped: boolean;
}): CaseTickWriteDecision {
  const cps = input.casesPerSkid;
  if (input.drainActive || input.packagingDrainActive) {
    // Ended runs use the Freeze tunnel WIP drop. During a paused packaging
    // drain, tunnel WIP is frozen at pause, so use the pause-relative stage
    // clock instead. Both paths baseline first, preventing reload/sync
    // adoption from replaying old output.
    const exited = input.packagingDrainActive
      ? (input.prevExpected >= 0 ? Math.max(0, input.expectedRaw - input.prevExpected) : 0)
      : (input.prevFreezer >= 0 ? Math.max(0, input.prevFreezer - input.nextFreezer) : 0);
    if (exited > 0) {
      const target = input.curTotal + exited;
      const newTotal = input.casesNeeded > 0 ? Math.min(target, Math.max(input.curTotal, input.casesNeeded)) : target;
      if (newTotal !== input.curTotal) {
        return { action: "write", newTotal, caseClaimRetryReset: false, formResetSkippedNew: input.formResetSkipped };
      }
    }
    return { action: "none", newTotal: input.curTotal, caseClaimRetryReset: false, formResetSkippedNew: input.formResetSkipped };
  }
  if (input.prevExpected < 0) {
    // First tick after a (re)start/switch: seed the absolute count only when
    // there is no progress yet. If progress already exists (reload / switching
    // into a run that's already going / a prior manual entry), just baseline.
    if ((input.curTotal === 0 || input.caseClaimRetry) && input.expectedCases > input.curTotal) {
      const seedTotal = input.casesNeeded > 0 ? Math.min(input.casesNeeded, input.expectedCases) : input.expectedCases;
      return { action: "seed", newTotal: seedTotal, caseClaimRetryReset: true, formResetSkippedNew: input.formResetSkipped };
    }
    return { action: "none", newTotal: input.curTotal, caseClaimRetryReset: false, formResetSkippedNew: input.formResetSkipped };
  }
  const deltaCases = Math.floor(Math.max(0, input.expectedRaw - input.prevExpected));
  if (deltaCases > 0) {
    // Stale-delta catch-up guard: if the form shows 0 cases but prevExpected
    // is positive, the form was reset while the expected baseline was still
    // ahead. Skip this one tick so the next tick has a fresh baseline and
    // writes ~1 case. If the operator corrected to 0, the flag lets the very
    // next tick proceed.
    if (!input.formResetSkipped && input.curTotal === 0 && input.prevExpected > cps) {
      return { action: "reset-skip", newTotal: input.curTotal, caseClaimRetryReset: false, formResetSkippedNew: true };
    }
    const target = input.curTotal + deltaCases;
    // Never pull a value down below what the operator already has on the floor.
    const newTotal = input.casesNeeded > 0 ? Math.min(target, Math.max(input.curTotal, input.casesNeeded)) : target;
    return {
      action: newTotal !== input.curTotal ? "write" : "none",
      newTotal,
      caseClaimRetryReset: false,
      formResetSkippedNew: false,
    };
  }
  return { action: "none", newTotal: input.curTotal, caseClaimRetryReset: false, formResetSkippedNew: false };
}

export type TrayTickResult = {
  prodDueMsNew: number;
  consDueMsNew: number;
  lastMsNew: number;
  delta: number;
  remainderNew: number;
  seededNew: boolean;
  /** Non-null only when the one-shot seed write should fire this tick. */
  seed: { from: number; to: number } | null;
};

/** Tray per-tick production/consumption decision. Mirrors the tray block of
 * the hook's write effect: production (+1 half-period out of phase) while the
 * run still has a tray deficit or ready batches; consumption floors whole
 * trays with a fractional remainder carry; one-shot suggested-staging seed for
 * an untouched 0 counter. */
export function computeTrayTick(input: {
  nowMs: number;
  prodDueMs: number;
  consDueMs: number;
  lastMs: number;
  periodMs: number;
  suppressed: boolean;
  feedComplete: boolean;
  deficitOpen: boolean;
  seeded: boolean;
  current: number;
  seed: number | null;
  ppm: number;
  perTray: number;
  remainder: number;
}): TrayTickResult {
  let prodDueMsNew = input.prodDueMs;
  let consDueMsNew = input.consDueMs;
  let lastMsNew = input.lastMs;
  let remainderNew = input.remainder;
  let delta = 0;
  let seededNew = input.seeded;
  let seed: { from: number; to: number } | null = null;

  // Production tick: first encounter arms half a period out of phase with
  // consumption (no write); otherwise +1 per completed period.
  if (prodDueMsNew === 0) {
    prodDueMsNew = input.nowMs + input.periodMs / 2;
  } else if (input.nowMs >= prodDueMsNew) {
    prodDueMsNew = input.nowMs + input.periodMs;
    if (!input.suppressed && !input.feedComplete && input.deficitOpen) {
      delta += 1;
    }
  }

  // Consumption tick.
  if (input.nowMs >= consDueMsNew) {
    // Consumption for the actual duration since this counter's last tick
    // (capped to 2 periods to avoid huge jumps); assume one full period on
    // the first tick.
    const durationMin = lastMsNew > 0
      ? Math.min((input.periodMs * 2) / 60000, (input.nowMs - lastMsNew) / 60000)
      : input.periodMs / 60000;
    consDueMsNew = input.nowMs + input.periodMs;
    lastMsNew = input.nowMs;
    if (!input.suppressed && !input.feedComplete) {
      // One-shot seed: an untouched 0 counter gets the suggested staging so it
      // has real stock to track.
      if (!seededNew) {
        seededNew = true;
        if (input.current === 0 && input.seed !== null) {
          seed = { from: input.current, to: input.seed };
        }
      }
      if (seed === null) {
        // Fractional tray consumption carried between ticks so sub-unit
        // depletion accumulates instead of being lost to Math.floor.
        const traysExact = (durationMin * input.ppm) / input.perTray + remainderNew;
        const traysConsumed = Math.floor(traysExact);
        remainderNew = traysExact - traysConsumed;
        delta -= traysConsumed;
      }
    }
  }

  return { prodDueMsNew, consDueMsNew, lastMsNew, delta, remainderNew, seededNew, seed };
}

export type BatchTickResult = {
  prodDueMsNew: number;
  consDueMsNew: number;
  lastMsNew: number;
  delta: number;
  seededNew: boolean;
  /** Non-null only when the one-shot seed write should fire this tick. */
  seed: { from: number; to: number } | null;
};

/** Batch per-tick production/consumption decision. Mirrors the batch block of
 * the hook's write effect: production +1 once per full batch-time while a
 * deficit remains; consumption is fractional at 1 batch per effective-drain
 * period; the one-shot seed subtracts any tray coverage seeded this same tick
 * so dough-on-hand is not double-counted. */
export function computeBatchTick(input: {
  nowMs: number;
  prodDueMs: number;
  consDueMs: number;
  lastMs: number;
  periodMs: number;
  fullBatchMs: number;
  effDrainMs: number;
  suppressed: boolean;
  feedComplete: boolean;
  deficitOpen: boolean;
  seeded: boolean;
  current: number;
  traysSeededAmount: number;
  traysNeeded: number;
  batchesNeeded: number;
}): BatchTickResult {
  let prodDueMsNew = input.prodDueMs;
  let consDueMsNew = input.consDueMs;
  let lastMsNew = input.lastMs;
  let delta = 0;
  let seededNew = input.seeded;
  let seed: { from: number; to: number } | null = null;

  // Production tick: the first mixed batch lands one full batch-time in.
  if (prodDueMsNew === 0) {
    prodDueMsNew = input.nowMs + input.fullBatchMs;
  } else if (input.nowMs >= prodDueMsNew) {
    prodDueMsNew = input.nowMs + input.fullBatchMs;
    if (!input.suppressed && !input.feedComplete && input.deficitOpen) {
      delta += 1;
    }
  }

  // Consumption tick.
  if (input.nowMs >= consDueMsNew) {
    const durationMin = lastMsNew > 0
      ? Math.min((input.periodMs * 2) / 60000, (input.nowMs - lastMsNew) / 60000)
      : input.periodMs / 60000;
    consDueMsNew = input.nowMs + input.periodMs;
    lastMsNew = input.nowMs;
    if (!input.suppressed && !input.feedComplete) {
      // Same one-shot seed as trays: an untouched 0 counter gets staged stock
      // on its first tick (minus any tray coverage already seeded this tick).
      if (!seededNew) {
        seededNew = true;
        const remainingBatchesNeeded = input.traysSeededAmount > 0 && input.traysNeeded > 0
          ? Math.max(0, input.batchesNeeded * (input.traysNeeded - input.traysSeededAmount) / input.traysNeeded)
          : input.batchesNeeded;
        const seedValue = remainingBatchesNeeded > 0
          ? Math.min(3, Math.max(1, Math.ceil(Math.min(3, remainingBatchesNeeded))))
          : null;
        if (input.current === 0 && seedValue !== null) {
          seed = { from: input.current, to: seedValue };
        }
      }
      if (seed === null) {
        // Fractional consumption at 1 batch per effective-drain period.
        delta -= (durationMin * 60000) / input.effDrainMs;
      }
    }
  }

  return { prodDueMsNew, consDueMsNew, lastMsNew, delta, seededNew, seed };
}
