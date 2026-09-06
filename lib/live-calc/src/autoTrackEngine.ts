export type SuggestedDoughStagingReturn = { trays: number | null; batches: number | null };
export function suggestedDoughStaging(traysNeeded: number, batchesNeeded: number): SuggestedDoughStagingReturn {
  return {
    trays: traysNeeded > 0 ? Math.max(1, Math.round(Math.min(40, traysNeeded))) : null,
    batches: batchesNeeded > 0 ? Math.min(3, Math.max(1, Math.ceil(Math.min(3, batchesNeeded)))) : null,
  };
}
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
export function getAutoTrackTiming(
  ppm: number,
  pizzasPerCase: number,
  perTray: number,
  perBatch: number,
  machine?: { spinSec: number; hopperSec: number },
): AutoTrackTiming {
  const caseMs = ppm > 0 && pizzasPerCase > 0 ? clampWebPeriodMs(pizzasPerCase / ppm * 60000) : 0;
  const trayMs = ppm > 0 && perTray > 0 ? clampWebPeriodMs(perTray / ppm * 60000) : 0;
  const lineBatchMs = ppm > 0 && perBatch > 0 ? perBatch / ppm * 60000 : 0;
  const hopperMs = machine && Number.isFinite(machine.hopperSec) && machine.hopperSec > 0
    ? clampWebPeriodMs(machine.hopperSec * 1000) : 0;
  const effectiveDrainMs = Math.max(hopperMs, lineBatchMs);
  const spinMs = machine && Number.isFinite(machine.spinSec) && machine.spinSec > 0
    ? machine.spinSec * 1000 : 0;
  return {
    caseMs,
    trayMs,
    trayProductionMs: trayMs > 0 ? trayMs / 2 : 0,
    batchConsumptionMs: effectiveDrainMs > 0 ? clampWebPeriodMs(effectiveDrainMs / 4) : 0,
    batchProductionMs: spinMs > 0 ? clampWebPeriodMs(spinMs) :
      lineBatchMs > 0 ? clampWebPeriodMs(lineBatchMs) : 0,
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
  expectedCasesRaw: number;
  trays: null;
  batches: null;
};
export function computeAutoTrackSuggestion(input: AutoTrackSuggestionInput): AutoTrackSuggestion | null {
  if (
    !["running", "paused"].includes(input.runStatus) && !input.drainActive ||
    input.ppm <= 0 || input.casesPerSkid <= 0 || input.pizzasPerCase <= 0
  ) return null;
  const elapsedAfterTunnelMin = Math.max(0, input.elapsedBatchSec / 60 - input.freezerTime);
  const expectedCasesRaw = input.packagingDrainActive
    ? Math.floor(Math.max(0, input.packagingDrainElapsedSec) * input.ppm / (input.pizzasPerCase * 60))
    : Math.floor(elapsedAfterTunnelMin * input.ppm / input.pizzasPerCase);
  const expectedCases = input.casesNeeded > 0
    ? Math.min(input.casesNeeded, expectedCasesRaw) : expectedCasesRaw;
  return {
    skids: Math.min(Math.floor(input.casesNeeded / input.casesPerSkid), Math.floor(expectedCases / input.casesPerSkid)),
    casesOnSkid: Math.min(input.casesPerSkid, expectedCases % input.casesPerSkid),
    expectedCases, expectedCasesRaw, trays: null, batches: null,
  };
}
export type AppSlotKey = "app1" | "app2" | "app3" | "app4";
export function computeAppSlotInfo(input: {
  type: string;
  recipe: Array<{ lbs: number }> | undefined;
  batchLbs: number;
  ozPerPizza: number;
  required: number;
  ppm: number;
}) {
  const recipeLbs = (input.recipe ?? []).reduce((sum, row) => sum + (Number(row.lbs) || 0), 0);
  const effectiveBatchLbs = recipeLbs > 0 ? recipeLbs : input.batchLbs;
  const type = String(input.type).trim();
  return {
    recipeLbs,
    effectiveBatchLbs,
    cadence: effectiveBatchLbs > 0 && input.ozPerPizza > 0 && input.ppm > 0
      ? effectiveBatchLbs * 16 / input.ozPerPizza / input.ppm * 60 : 0,
    validForClaim: !!type && !type.toLowerCase().includes("mix") &&
      effectiveBatchLbs > 0 && input.ozPerPizza > 0 && input.required > 0 && input.ppm > 0,
  };
}
export function computeNetSecondDue(input: { currentDue: number; anchor: number; cadence: number }): number {
  return input.currentDue > 0 ? input.currentDue : input.anchor + input.cadence;
}

export type CaseClaimMutation = {
  field: "skidsCompleted" | "casesOnCurrentSkid";
  from: number;
  to: number;
};
export function buildCaseClaimMutations(input: {
  skidsFrom: number; skidsTo: number; casesFrom: number; casesTo: number;
}): CaseClaimMutation[] {
  return [
    { field: "skidsCompleted", from: input.skidsFrom, to: input.skidsTo },
    { field: "casesOnCurrentSkid", from: input.casesFrom, to: input.casesTo },
  ];
}
export type CaseTickWriteDecision =
  | { action: "seed"; newTotal: number; caseClaimRetryReset: true; formResetSkippedNew: boolean }
  | { action: "write"; newTotal: number; caseClaimRetryReset: false; formResetSkippedNew: boolean }
  | { action: "reset-skip"; newTotal: number; caseClaimRetryReset: false; formResetSkippedNew: true }
  | { action: "none"; newTotal: number; caseClaimRetryReset: false; formResetSkippedNew: boolean };
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
    const exited = input.packagingDrainActive
      ? (input.prevExpected >= 0 ? Math.max(0, input.expectedRaw - input.prevExpected) : 0)
      : (input.prevFreezer >= 0 ? Math.max(0, input.prevFreezer - input.nextFreezer) : 0);
    const target = input.curTotal + exited;
    const newTotal = input.casesNeeded > 0
      ? Math.min(target, Math.max(input.curTotal, input.casesNeeded)) : target;
    return {
      action: newTotal !== input.curTotal ? "write" : "none",
      newTotal,
      caseClaimRetryReset: false,
      formResetSkippedNew: input.formResetSkipped,
    };
  }
  if (input.prevExpected < 0) {
    if ((input.curTotal === 0 || input.caseClaimRetry) && input.expectedCases > input.curTotal) {
      return {
        action: "seed",
        newTotal: input.casesNeeded > 0 ? Math.min(input.casesNeeded, input.expectedCases) : input.expectedCases,
        caseClaimRetryReset: true,
        formResetSkippedNew: input.formResetSkipped,
      };
    }
    return {
      action: "none", newTotal: input.curTotal, caseClaimRetryReset: false,
      formResetSkippedNew: input.formResetSkipped,
    };
  }
  const deltaCases = Math.floor(Math.max(0, input.expectedRaw - input.prevExpected));
  if (deltaCases > 0) {
    if (!input.formResetSkipped && input.curTotal === 0 && input.prevExpected > cps) {
      return {
        action: "reset-skip", newTotal: input.curTotal,
        caseClaimRetryReset: false, formResetSkippedNew: true,
      };
    }
    const target = input.curTotal + deltaCases;
    const newTotal = input.casesNeeded > 0
      ? Math.min(target, Math.max(input.curTotal, input.casesNeeded)) : target;
    return {
      action: newTotal !== input.curTotal ? "write" : "none",
      newTotal, caseClaimRetryReset: false, formResetSkippedNew: false,
    };
  }
  return {
    action: "none", newTotal: input.curTotal,
    caseClaimRetryReset: false, formResetSkippedNew: false,
  };
}