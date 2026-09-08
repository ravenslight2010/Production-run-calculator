import { clampWebPeriodMs, computeBatchTick, computeCaseTickWrite, computeTrayTick, getAutoTrackTiming, suggestedDoughStaging, type AutoTrackTiming } from "./autoTrackEngine";

export type WallClockRunStatus = "pending" | "running" | "paused" | "ended";
export type WallClockChannel = "case" | "tray-consume" | "tray-produce" | "batch-consume" | "batch-produce" | "hopper";
export type WallClockMutation = { field: string; from: number; to: number };
export type WallClockTickEvent = { channel: WallClockChannel; dueAt: number; nextDueAt: number; mutations: WallClockMutation[] };
export interface WallClockBookkeeping {
  caseNextDueMs: number; trayProdNextDueMs: number; trayConsNextDueMs: number; batchProdNextDueMs: number; batchConsNextDueMs: number; hopperNextDueMs: number;
  trayLastMs: number; batchLastMs: number; lastExpectedCases: number; drainFreezer: number; traysRemainder: number;
  traySeeded: boolean; batchSeeded: boolean; formResetSkipped: boolean; caseClaimRetry: boolean; doughPausedAtMs: number; doughResumeAtMs: number;
}
export function createWallClockBookkeeping(): WallClockBookkeeping {
  return { caseNextDueMs: 0, trayProdNextDueMs: 0, trayConsNextDueMs: 0, batchProdNextDueMs: 0, batchConsNextDueMs: 0, hopperNextDueMs: 0, trayLastMs: 0, batchLastMs: 0, lastExpectedCases: -1, drainFreezer: -1, traysRemainder: 0, traySeeded: false, batchSeeded: false, formResetSkipped: false, caseClaimRetry: false, doughPausedAtMs: 0, doughResumeAtMs: 0 };
}
export function rearmWallClockTimers(b: WallClockBookkeeping, nowMs: number, t: AutoTrackTiming): WallClockBookkeeping {
  return { ...b, caseNextDueMs: t.caseMs > 0 ? nowMs + t.caseMs : 0, trayProdNextDueMs: t.trayProductionMs > 0 ? nowMs + t.trayProductionMs : 0, hopperNextDueMs: t.hopperMs > 0 ? nowMs + t.hopperMs : 0, trayConsNextDueMs: t.trayMs > 0 ? nowMs + t.trayMs : 0, trayLastMs: 0, batchConsNextDueMs: t.batchConsumptionMs > 0 ? nowMs + t.batchConsumptionMs : 0, batchLastMs: 0, doughPausedAtMs: 0, doughResumeAtMs: 0 };
}
export type WallClockTickInput = {
  bookkeeping: WallClockBookkeeping; nowMs: number; timing: AutoTrackTiming; runStatus: WallClockRunStatus;
  drainActive: boolean; packagingDrainActive: boolean; packagingAutoTrackActive: boolean; caseSuppressed: boolean; doughSuppressed: boolean;
  calc: { ppm: number; perTray: number; perBatch: number; pressDone: boolean; casesInFreezer: number; traysNeeded: number; batchesNeeded: number };
  v: { pizzasPerCase: number; casesPerSkid: number; casesNeeded: number; traysOnLine: number; batchesReady: number };
  form: { skidsCompleted: number; casesOnCurrentSkid: number; traysOnLine: number; batchesReady: number };
  expectedCasesRaw: number; expectedCases: number;
  serverOwnedChannels?: Partial<Record<WallClockChannel, boolean>>;
};
export function tickWallClock(input: WallClockTickInput): { next: WallClockBookkeeping; events: WallClockTickEvent[] } {
  let next = { ...input.bookkeeping };
  const events: WallClockTickEvent[] = [];
  const caseActive = input.runStatus === "running" && input.packagingAutoTrackActive || input.drainActive || input.packagingDrainActive;
  if (caseActive && input.calc.ppm > 0 && input.v.pizzasPerCase > 0 && input.nowMs >= next.caseNextDueMs) {
    const dueAt = input.nowMs;
    next.caseNextDueMs = input.nowMs + clampWebPeriodMs(input.v.pizzasPerCase / input.calc.ppm * 60000);
    const prevExpected = next.lastExpectedCases, prevFreezer = next.drainFreezer;
    next.lastExpectedCases = input.expectedCasesRaw;
    next.drainFreezer = Math.max(0, Math.floor(input.calc.casesInFreezer));
    if (!input.caseSuppressed && !input.serverOwnedChannels?.case) {
      const d = computeCaseTickWrite({ prevExpected, expectedRaw: input.expectedCasesRaw, expectedCases: input.expectedCases, prevFreezer, nextFreezer: next.drainFreezer, curTotal: (input.form.skidsCompleted || 0) * input.v.casesPerSkid + (input.form.casesOnCurrentSkid || 0), casesPerSkid: input.v.casesPerSkid, casesNeeded: input.v.casesNeeded, drainActive: input.drainActive, packagingDrainActive: input.packagingDrainActive, caseClaimRetry: next.caseClaimRetry, formResetSkipped: next.formResetSkipped });
      if (d.caseClaimRetryReset) next.caseClaimRetry = false;
      next.formResetSkipped = d.formResetSkippedNew;
      if (d.action !== "none" && d.action !== "reset-skip") events.push({ channel: "case", dueAt, nextDueAt: next.caseNextDueMs, mutations: [{ field: "skidsCompleted", from: input.form.skidsCompleted || 0, to: Math.floor(d.newTotal / input.v.casesPerSkid) }, { field: "casesOnCurrentSkid", from: input.form.casesOnCurrentSkid || 0, to: Math.round(d.newTotal % input.v.casesPerSkid) }] });
    }
  }
  // The independent dough pause freezes every dough-owned arm and anchor,
  // including hopper, byte-for-byte. Case bookkeeping above remains live.
  if (next.doughPausedAtMs > 0) {
    return next.doughResumeAtMs > 0 && input.nowMs >= next.doughResumeAtMs ? { next: rearmWallClockTimers(next, input.nowMs, input.timing), events } : { next, events };
  }
  if (input.runStatus === "running" && input.timing.hopperMs > 0) {
    if (next.hopperNextDueMs === 0) next.hopperNextDueMs = input.nowMs + input.timing.hopperMs;
    else if (input.nowMs >= next.hopperNextDueMs) {
      next.hopperNextDueMs = input.nowMs + input.timing.hopperMs;
      if (!input.serverOwnedChannels?.hopper) events.push({ channel: "hopper", dueAt: input.nowMs, nextDueAt: next.hopperNextDueMs, mutations: [] });
    }
  }
  let traysSeededAmount = 0;
  if (input.runStatus === "running" && input.calc.perTray > 0 && input.calc.ppm > 0) {
    const t = computeTrayTick({ nowMs: input.nowMs, prodDueMs: next.trayProdNextDueMs, consDueMs: next.trayConsNextDueMs, lastMs: next.trayLastMs, periodMs: input.timing.trayMs, suppressed: input.doughSuppressed, productionSuppressed: input.serverOwnedChannels?.["tray-produce"], consumptionSuppressed: input.serverOwnedChannels?.["tray-consume"], feedComplete: input.calc.pressDone, deficitOpen: input.calc.traysNeeded > 0 || input.v.batchesReady > 0, seeded: next.traySeeded, current: input.form.traysOnLine || 0, seed: suggestedDoughStaging(input.calc.traysNeeded, input.calc.batchesNeeded).trays, ppm: input.calc.ppm, perTray: input.calc.perTray, remainder: next.traysRemainder });
    next = { ...next, trayProdNextDueMs: t.prodDueMsNew, trayConsNextDueMs: t.consDueMsNew, trayLastMs: t.lastMsNew, traysRemainder: t.remainderNew, traySeeded: t.seededNew };
    if (t.seed) { traysSeededAmount = t.seed.to; events.push({ channel: "tray-consume", dueAt: input.nowMs, nextDueAt: next.trayConsNextDueMs, mutations: [{ field: "traysOnLine", from: t.seed.from, to: t.seed.to }] }); }
    else if (t.delta !== 0) { const channel = t.delta > 0 ? "tray-produce" : "tray-consume"; const to = Math.max(0, input.v.traysOnLine + t.delta); if (to !== input.v.traysOnLine) events.push({ channel, dueAt: input.nowMs, nextDueAt: t.delta > 0 ? next.trayProdNextDueMs : next.trayConsNextDueMs, mutations: [{ field: "traysOnLine", from: input.form.traysOnLine || 0, to }] }); }
  }
  if (input.runStatus === "running" && input.calc.perBatch > 0 && input.calc.ppm > 0) {
    const b = computeBatchTick({ nowMs: input.nowMs, prodDueMs: next.batchProdNextDueMs, consDueMs: next.batchConsNextDueMs, lastMs: next.batchLastMs, periodMs: input.timing.batchConsumptionMs, fullBatchMs: input.timing.batchProductionMs, effDrainMs: Math.max(input.timing.hopperMs, input.calc.perBatch / input.calc.ppm * 60000), suppressed: input.doughSuppressed, productionSuppressed: input.serverOwnedChannels?.["batch-produce"], consumptionSuppressed: input.serverOwnedChannels?.["batch-consume"], feedComplete: input.calc.pressDone, deficitOpen: input.calc.batchesNeeded > 0, seeded: next.batchSeeded, current: input.form.batchesReady || 0, traysSeededAmount, traysNeeded: input.calc.traysNeeded, batchesNeeded: input.calc.batchesNeeded });
    next = { ...next, batchProdNextDueMs: b.prodDueMsNew, batchConsNextDueMs: b.consDueMsNew, batchLastMs: b.lastMsNew, batchSeeded: b.seededNew };
    if (b.seed) events.push({ channel: "batch-consume", dueAt: input.nowMs, nextDueAt: next.batchConsNextDueMs, mutations: [{ field: "batchesReady", from: b.seed.from, to: b.seed.to }] });
    else if (b.delta !== 0) { const channel = b.delta > 0 ? "batch-produce" : "batch-consume"; let to = input.v.batchesReady + b.delta; if (b.delta > 0) to = Math.min(to, Math.max(input.v.batchesReady, 3)); to = Math.max(0, Math.round(to * 100) / 100); if (to !== input.v.batchesReady) events.push({ channel, dueAt: input.nowMs, nextDueAt: b.delta > 0 ? next.batchProdNextDueMs : next.batchConsNextDueMs, mutations: [{ field: "batchesReady", from: input.form.batchesReady || 0, to }] }); }
  }
  return { next, events };
}
export type WallClockDueRefs = { caseDueMs: number; trayProdDueMs: number; trayConsDueMs: number; batchProdDueMs: number; batchConsDueMs: number; hopperDueMs: number };
export type WallClockStoppage = { type?: string; startedAt: number; endedAt?: number };
export function buildRunningSegments(input: { startedAt?: number; pausedAt?: number; endedAt?: number; nowMs: number; stoppages?: WallClockStoppage[] }): Array<{ start: number; end: number }> {
  const startedAt = Number.isFinite(input.startedAt) ? input.startedAt as number : NaN;
  if (!Number.isFinite(startedAt)) return [];
  const pauses = (input.stoppages ?? []).filter(s => (s.type ?? "") === "pause").map(s => ({ start: s.startedAt, end: s.endedAt })).filter(s => Number.isFinite(s.start)).sort((a, b) => a.start - b.start);
  const segments: Array<{ start: number; end: number }> = []; let cursor = startedAt;
  for (const p of pauses) { const end = Math.min(p.start, input.nowMs); if (end > cursor) segments.push({ start: cursor, end }); if (!p.end || p.end >= input.nowMs) { cursor = input.nowMs; break; } cursor = Math.max(cursor, p.end); }
  const horizon = Number.isFinite(input.endedAt) && input.endedAt! < input.nowMs ? input.endedAt! : input.nowMs;
  if (horizon > cursor) segments.push({ start: cursor, end: horizon });
  return segments;
}
export function computeWallClockDueRefs(input: { startedAt?: number; pausedAt?: number; endedAt?: number; nowMs: number; stoppages?: WallClockStoppage[]; timing: AutoTrackTiming }): WallClockDueRefs | null {
  if (!Number.isFinite(input.startedAt)) return null;
  const segments = buildRunningSegments(input); if (!segments.length) return null;
  const advance = (period: number) => !Number.isFinite(period) || period <= 0 ? 0 : segments.reduce((_, s) => s.start + (Math.floor(Math.max(0, s.end - s.start) / period) + 1) * period, 0);
  return { caseDueMs: advance(input.timing.caseMs), trayProdDueMs: advance(input.timing.trayProductionMs), trayConsDueMs: advance(input.timing.trayMs), batchProdDueMs: advance(input.timing.batchProductionMs), batchConsDueMs: advance(input.timing.batchConsumptionMs), hopperDueMs: advance(input.timing.hopperMs) };
}
export type { AutoTrackTiming };
export { getAutoTrackTiming };