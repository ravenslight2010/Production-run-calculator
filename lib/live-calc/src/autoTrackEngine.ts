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
