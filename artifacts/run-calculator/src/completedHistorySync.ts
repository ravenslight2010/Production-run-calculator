import { HISTORY_KEY, type FormValues, type HistoryDay, type RunMeta } from "./types";
import { browserRecordStore } from "./adapters/browserRecordStore";

export const COMPLETED_HISTORY_OUTBOX_KEY = "run-calc-completed-history-outbox";
export const COMPLETED_HISTORY_OUTBOX_EVENT = "run-calculator:completed-history-outbox";
export const COMPLETED_HISTORY_CACHE_KEY = "run-calc-completed-history-cache";
export const APPLICATOR_EVIDENCE_OUTBOX_KEY = "run-calc-applicator-evidence-outbox";
export const APPLICATOR_EVIDENCE_CACHE_KEY = "run-calc-applicator-evidence-cache";
export const APPLICATOR_EVIDENCE_CONFLICT_KEY = "run-calc-applicator-evidence-conflicts";
export const APPLICATOR_EVIDENCE_EVENT = "run-calculator:applicator-evidence";
type HistoryScope = "live" | "sandbox";
let activeScope: HistoryScope | null = null;
let retryTimer: number | undefined;
let retryDelayMs = 5_000;
let evidenceRetryTimer: number | undefined;
let evidenceRetryDelayMs = 5_000;
let applicatorEvidenceHydrationError: string | null = null;
type Completion = {
  operationId: string; runId: string; date: string; completedAt: string;
  snapshot: Record<string, unknown>;
};
export type ApplicatorBatchEvidence = {
  id?: string;
  operationId: string;
  date: string;
  runId: string;
  slot: 1 | 2 | 3 | 4;
  source: "automatic-observation" | "manager-finalization" | "manager-correction";
  observedTotal?: number;
  confirmedTotal?: number;
  correctionOf?: string;
  evidenceHash?: string;
  hashContract?: string;
  createdAt?: string;
};
export type ApplicatorFinalization = {
  operationId: string; date: string; runId: string; slot: 1 | 2 | 3 | 4;
  finalTotal: number; correctionOf?: string;
};
export type ApplicatorEvidenceConflict = {
  operationId: string;
  finalization: ApplicatorFinalization;
  error: string;
  canonical?: ApplicatorBatchEvidence;
};
export type ReconciledApplicatorTotal = {
  date: string;
  runId: string;
  slot: 1 | 2 | 3 | 4;
  latestObservedTotal?: number;
  latestConfirmedTotal?: number;
  effectiveTotal?: number;
  provenance: "manager-confirmed" | "automatic-observed" | "unverified";
  observedEvidenceHash?: string;
  confirmedEvidenceHash?: string;
  latestObservedOperationId?: string;
  latestConfirmedOperationId?: string;
};

/**
 * Rebuilds the verifiable total without relying on planned recipe values.
 * Automatic and manager streams are independent: a later manager correction
 * supersedes only the confirmed stream, while the latest accepted automatic
 * observation remains useful for reconciliation.
 */
export function reconcileApplicatorBatchEvidence(
  records: ApplicatorBatchEvidence[],
): ReconciledApplicatorTotal[] {
  const grouped = new Map<string, { observed?: ApplicatorBatchEvidence; confirmed?: ApplicatorBatchEvidence }>();
  for (const record of records) {
    if (!record || !record.runId || !Number.isInteger(record.slot)
      || record.slot < 1 || record.slot > 4) continue;
    const key = `${record.date}\u0000${record.runId}\u0000${record.slot}`;
    const group = grouped.get(key) ?? {};
    const prior = record.source === "automatic-observation" ? group.observed : group.confirmed;
    const priorTime = prior?.createdAt ? Date.parse(prior.createdAt) : -Infinity;
    const recordTime = record.createdAt ? Date.parse(record.createdAt) : -Infinity;
    if (!prior || recordTime >= priorTime) {
      if (record.source === "automatic-observation") group.observed = record;
      else if (record.source === "manager-finalization" || record.source === "manager-correction") group.confirmed = record;
    }
    grouped.set(key, group);
  }
  return [...grouped.entries()].map(([key, group]) => {
    const [date, runId, rawSlot] = key.split("\u0000");
    const slot = Number(rawSlot) as 1 | 2 | 3 | 4;
    const latestObservedTotal = group.observed?.observedTotal;
    const latestConfirmedTotal = group.confirmed?.confirmedTotal;
    return {
      date, runId, slot,
      ...(latestObservedTotal === undefined ? {} : {
        latestObservedTotal,
        latestObservedOperationId: group.observed?.operationId,
        ...(group.observed?.evidenceHash ? { observedEvidenceHash: group.observed.evidenceHash } : {}),
      }),
      ...(latestConfirmedTotal === undefined ? {} : {
        latestConfirmedTotal,
        latestConfirmedOperationId: group.confirmed?.operationId,
        ...(group.confirmed?.evidenceHash ? { confirmedEvidenceHash: group.confirmed.evidenceHash } : {}),
      }),
      ...(latestConfirmedTotal !== undefined ? {
        effectiveTotal: latestConfirmedTotal,
        provenance: "manager-confirmed" as const,
      } : latestObservedTotal !== undefined ? {
        effectiveTotal: latestObservedTotal,
        provenance: "automatic-observed" as const,
      } : {
        provenance: "unverified" as const,
      }),
    };
  }).sort((a, b) => a.date.localeCompare(b.date) || a.runId.localeCompare(b.runId) || a.slot - b.slot);
}
const activeFlushes = new Map<HistoryScope, Promise<void>>();
const activeEvidenceFlushes = new Map<HistoryScope, Promise<void>>();

function scopedKey(base: string, scope: HistoryScope | null = activeScope): string | null {
  return scope ? `${base}.${scope}` : null;
}

function readOutbox(scope: HistoryScope | null = activeScope): Completion[] {
  const key = scopedKey(COMPLETED_HISTORY_OUTBOX_KEY, scope);
  if (!key) return [];
  return browserRecordStore.record(key, () => [], {
    decode: (value) => Array.isArray(value) ? value.filter((item): item is Completion =>
      !!item && typeof item.operationId === "string" && typeof item.runId === "string"
      && typeof item.date === "string" && !!item.snapshot) : null,
  }).read();
}
function writeOutbox(value: Completion[], scope: HistoryScope | null = activeScope): void {
  const key = scopedKey(COMPLETED_HISTORY_OUTBOX_KEY, scope);
  if (!key) return;
  browserRecordStore.record<Completion[]>(key, () => [], { decode: () => null }).write(value);
  if (typeof window !== "undefined") window.dispatchEvent(new Event(COMPLETED_HISTORY_OUTBOX_EVENT));
}

function readScopedCache(scope: HistoryScope | null = activeScope): HistoryDay[] {
  const key = scopedKey(COMPLETED_HISTORY_CACHE_KEY, scope);
  if (!key) return [];
  return browserRecordStore.record(key, () => [], {
    decode: (value) => Array.isArray(value) ? value as HistoryDay[] : null,
  }).read();
}

function writeScopedCache(days: HistoryDay[], scope: HistoryScope | null = activeScope): void {
  const key = scopedKey(COMPLETED_HISTORY_CACHE_KEY, scope);
  if (!key) return;
  browserRecordStore.record<HistoryDay[]>(key, () => [], { decode: () => null }).write(days);
}

function evidenceKey(base: string, scope: HistoryScope | null = activeScope): string | null {
  return scope ? `${base}.${scope}` : null;
}
function readEvidence(scope: HistoryScope | null = activeScope): ApplicatorBatchEvidence[] {
  const key = evidenceKey(APPLICATOR_EVIDENCE_CACHE_KEY, scope);
  if (!key) return [];
  return browserRecordStore.record(key, () => [], {
    decode: (value) => Array.isArray(value) ? value as ApplicatorBatchEvidence[] : null,
  }).read();
}
function writeEvidence(value: ApplicatorBatchEvidence[], scope: HistoryScope | null = activeScope): void {
  const key = evidenceKey(APPLICATOR_EVIDENCE_CACHE_KEY, scope);
  if (key) {
    browserRecordStore.record<ApplicatorBatchEvidence[]>(key, () => [], { decode: () => null }).write(value);
    if (typeof window !== "undefined") window.dispatchEvent(new Event(APPLICATOR_EVIDENCE_EVENT));
  }
}
function readEvidenceOutbox(scope: HistoryScope | null = activeScope): ApplicatorFinalization[] {
  const key = evidenceKey(APPLICATOR_EVIDENCE_OUTBOX_KEY, scope);
  if (!key) return [];
  return browserRecordStore.record(key, () => [], {
    decode: (value) => Array.isArray(value) ? value.filter((item): item is ApplicatorFinalization =>
      !!item && typeof item.operationId === "string" && typeof item.date === "string"
      && typeof item.runId === "string" && Number.isInteger(item.slot)
      && Number.isInteger(item.finalTotal)) : null,
  }).read();
}
function writeEvidenceOutbox(value: ApplicatorFinalization[], scope: HistoryScope | null = activeScope): void {
  const key = evidenceKey(APPLICATOR_EVIDENCE_OUTBOX_KEY, scope);
  if (key) {
    browserRecordStore.record<ApplicatorFinalization[]>(key, () => [], { decode: () => null }).write(value);
    if (typeof window !== "undefined") window.dispatchEvent(new Event(APPLICATOR_EVIDENCE_EVENT));
  }
}
function readEvidenceConflicts(scope: HistoryScope | null = activeScope): ApplicatorEvidenceConflict[] {
  const key = evidenceKey(APPLICATOR_EVIDENCE_CONFLICT_KEY, scope);
  if (!key) return [];
  return browserRecordStore.record(key, () => [], {
    decode: (value) => Array.isArray(value) ? value as ApplicatorEvidenceConflict[] : null,
  }).read();
}
function writeEvidenceConflicts(value: ApplicatorEvidenceConflict[], scope: HistoryScope | null = activeScope): void {
  const key = evidenceKey(APPLICATOR_EVIDENCE_CONFLICT_KEY, scope);
  if (key) {
    browserRecordStore.record<ApplicatorEvidenceConflict[]>(key, () => [], { decode: () => null }).write(value);
    if (typeof window !== "undefined") window.dispatchEvent(new Event(APPLICATOR_EVIDENCE_EVENT));
  }
}

export function setCompletedHistoryScope(scope: HistoryScope | null): void {
  activeScope = scope;
  if (retryTimer !== undefined && typeof window !== "undefined") window.clearTimeout(retryTimer);
  if (evidenceRetryTimer !== undefined && typeof window !== "undefined") window.clearTimeout(evidenceRetryTimer);
  retryTimer = undefined;
  evidenceRetryTimer = undefined;
  retryDelayMs = 5_000;
  evidenceRetryDelayMs = 5_000;
  if (scope && readEvidenceOutbox(scope).length > 0) void flushApplicatorEvidenceOutbox();
  if (typeof window !== "undefined") window.dispatchEvent(new Event(COMPLETED_HISTORY_OUTBOX_EVENT));
}

/** Durable, unbounded local queue. Identity is stable across reload/retry. */
export function queueCompletedRun(date: string, run: RunMeta, values: FormValues): void {
  if (!activeScope || !run.id || !run.endedAt) return;
  const scope = activeScope;
  const operationId = `completed:${date}:${run.id}`;
  const outbox = readOutbox(scope);
  if (outbox.some((item) => item.operationId === operationId)) return;
  const snapshot = {
    dayState: { date, runs: [run], currentIndex: 0 },
    runValues: { [run.id]: values },
  };
  writeOutbox([...outbox, {
    operationId, runId: run.id, date, completedAt: new Date(run.endedAt).toISOString(), snapshot,
  }], scope);
  void flushCompletedHistoryOutbox();
}

/** Durable manager-attestation queue. The operation key is stable across
 * reloads; the server remains the append-only authority. */
export function queueApplicatorBatchFinalization(input: ApplicatorFinalization): void {
  if (!activeScope) return;
  const outbox = readEvidenceOutbox();
  if (outbox.some((item) => item.operationId === input.operationId)) return;
  writeEvidenceConflicts(readEvidenceConflicts().filter((candidate) =>
    candidate.finalization.date !== input.date
    || candidate.finalization.runId !== input.runId
    || candidate.finalization.slot !== input.slot));
  writeEvidenceOutbox([...outbox, input]);
  void flushApplicatorEvidenceOutbox();
}

async function drainApplicatorEvidenceOutbox(scope: HistoryScope): Promise<void> {
  while (true) {
    const item = readEvidenceOutbox(scope)[0];
    if (!item) break;
    let response: Response;
    try {
      response = await fetch("/api/applicator-batch-evidence/finalize", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(item),
      });
    } catch {
      scheduleApplicatorEvidenceRetry(scope);
      return;
    }
    const body = await response.json().catch(() => null) as {
      acknowledged?: boolean;
      error?: string;
      canonical?: ApplicatorBatchEvidence;
    } | null;
    if (response.ok && body?.acknowledged) {
      if (body.canonical && typeof body.canonical.operationId === "string") {
        const evidence = readEvidence(scope).filter((candidate) => candidate.operationId !== body.canonical!.operationId);
        writeEvidence([...evidence, body.canonical], scope);
      }
      writeEvidenceOutbox(readEvidenceOutbox(scope).filter((candidate) => candidate.operationId !== item.operationId), scope);
      continue;
    }
    if (response.status >= 500 || response.status === 429) {
      scheduleApplicatorEvidenceRetry(scope);
      return;
    }
    // Validation, authorization, and immutable conflicts require manager action
    // rather than retrying forever. Retain the unresolved input and canonical
    // winner visibly, then continue draining later independent submissions.
    const conflicts = readEvidenceConflicts(scope).filter((candidate) => candidate.operationId !== item.operationId);
    if (body?.canonical && typeof body.canonical.operationId === "string") {
      const evidence = readEvidence(scope).filter((candidate) => candidate.operationId !== body.canonical!.operationId);
      writeEvidence([...evidence, body.canonical], scope);
    }
    writeEvidenceConflicts([...conflicts, {
      operationId: item.operationId,
      finalization: item,
      error: body?.error ?? `Evidence submission failed (${response.status})`,
      ...(body?.canonical ? { canonical: body.canonical } : {}),
    }], scope);
    writeEvidenceOutbox(readEvidenceOutbox(scope).filter((candidate) => candidate.operationId !== item.operationId), scope);
  }
  evidenceRetryDelayMs = 5_000;
}

function scheduleApplicatorEvidenceRetry(scope: HistoryScope): void {
  if (typeof window === "undefined" || activeScope !== scope
    || evidenceRetryTimer !== undefined || readEvidenceOutbox(scope).length === 0) return;
  evidenceRetryTimer = window.setTimeout(() => {
    evidenceRetryTimer = undefined;
    void flushApplicatorEvidenceOutbox();
  }, evidenceRetryDelayMs);
  evidenceRetryDelayMs = Math.min(evidenceRetryDelayMs * 2, 60_000);
}

export function flushApplicatorEvidenceOutbox(): Promise<void> {
  const scope = activeScope;
  if (!scope) return Promise.resolve();
  const active = activeEvidenceFlushes.get(scope);
  if (active) return active;
  const flush = drainApplicatorEvidenceOutbox(scope).finally(() => { activeEvidenceFlushes.delete(scope); });
  activeEvidenceFlushes.set(scope, flush);
  return flush;
}

export function loadApplicatorBatchEvidenceForActiveScope(): ApplicatorBatchEvidence[] {
  return readEvidence();
}
export function pendingApplicatorBatchFinalizations(): ApplicatorFinalization[] {
  return readEvidenceOutbox();
}
export function unresolvedApplicatorEvidenceConflicts(): ApplicatorEvidenceConflict[] {
  return readEvidenceConflicts();
}
export function applicatorEvidenceHydrationErrorMessage(): string | null {
  return applicatorEvidenceHydrationError;
}

const MAX_EVIDENCE_HYDRATION_RECORDS = 10_000;
async function fetchAllApplicatorEvidence(): Promise<ApplicatorBatchEvidence[]> {
  const records: ApplicatorBatchEvidence[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 20; page++) {
    const params = new URLSearchParams({ limit: "500" });
    if (cursor) params.set("cursor", cursor);
    const response = await fetch(`/api/applicator-batch-evidence?${params.toString()}`);
    if (!response.ok) throw new Error(`Applicator evidence history unavailable (${response.status})`);
    const body = await response.json() as { evidence?: ApplicatorBatchEvidence[]; nextCursor?: string };
    if (!Array.isArray(body.evidence)) throw new Error("Applicator evidence history response was invalid");
    records.push(...body.evidence);
    if (records.length > MAX_EVIDENCE_HYDRATION_RECORDS) {
      throw new Error("Applicator evidence history exceeds the client safety cap");
    }
    cursor = body.nextCursor;
    if (!cursor) return records;
  }
  throw new Error("Applicator evidence history pagination exceeded the client safety cap");
}

/**
 * Starting one run finalizes every competing active run and durably queues each
 * immutable completion before the caller publishes the new mutable day state.
 */
export function startRunAndQueueCompetingCompletions(args: {
  date: string;
  runs: RunMeta[];
  currentIndex: number;
  now: number;
  loadValues: (runId: string) => FormValues;
}): { runs: RunMeta[]; autoEnded: RunMeta[] } {
  const selected = args.runs[args.currentIndex];
  if (!selected) return { runs: args.runs, autoEnded: [] };
  const runs = args.runs.map((run, index) => (
    index === args.currentIndex
      ? { ...run, startedAt: args.now, endedAt: undefined }
      : run.startedAt && !run.endedAt
        ? { ...run, endedAt: args.now, pausedAt: undefined }
        : run
  ));
  const autoEnded = runs.filter((run, index) => (
    index !== args.currentIndex
    && run.endedAt === args.now
    && args.runs[index]?.startedAt
    && !args.runs[index]?.endedAt
  ));
  for (const run of autoEnded) {
    queueCompletedRun(args.date, run, args.loadValues(run.id));
  }
  return { runs, autoEnded };
}

async function drainCompletedHistoryOutbox(scope: HistoryScope): Promise<void> {
  for (const item of readOutbox(scope)) {
    let response: Response;
    try {
      response = await fetch("/api/completed-history", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(item),
      });
    } catch { return; }
    if (response.status === 409) {
      const body = await response.json().catch(() => null) as {
        canonical?: { date: string; runId: string; snapshot: unknown };
      } | null;
      // The immutable server winner is authoritative. Cache it locally and
      // retire this impossible upload; auth/transient failures remain pending.
      if (!body?.canonical) return;
      const canonical = completedHistoryDays([body.canonical]);
      const merged = mergeCanonicalCompletedHistory(readScopedCache(scope), canonical);
      writeScopedCache(merged, scope);
      if (activeScope === scope) {
        try { localStorage.setItem(HISTORY_KEY, JSON.stringify(merged)); } catch {}
      }
      writeOutbox(readOutbox(scope).filter((candidate) => candidate.operationId !== item.operationId), scope);
      continue;
    }
    if (!response.ok) {
      scheduleRetry(scope);
      return;
    }
    const body = await response.json().catch(() => null);
    if (!body?.acknowledged) return;
    writeOutbox(readOutbox(scope).filter((candidate) => candidate.operationId !== item.operationId), scope);
  }
  retryDelayMs = 5_000;
}

function scheduleRetry(scope: HistoryScope): void {
  if (typeof window === "undefined" || activeScope !== scope
    || retryTimer !== undefined || readOutbox(scope).length === 0) return;
  retryTimer = window.setTimeout(() => {
    retryTimer = undefined;
    void flushCompletedHistoryOutbox();
  }, retryDelayMs);
  retryDelayMs = Math.min(retryDelayMs * 2, 60_000);
}

/** Sends one at a time; concurrent startup/online drains share one owner. */
export function flushCompletedHistoryOutbox(): Promise<void> {
  const scope = activeScope;
  if (!scope) return Promise.resolve();
  const active = activeFlushes.get(scope);
  if (active) return active;
  const flush = drainCompletedHistoryOutbox(scope).finally(() => { activeFlushes.delete(scope); });
  activeFlushes.set(scope, flush);
  return flush;
}

export function pendingCompletedHistoryCount(): number { return readOutbox().length; }

/** Immediate scope-safe display state, available even while the API is offline. */
export function loadCompletedHistoryForActiveScope(): HistoryDay[] {
  const pending = completedHistoryDays(readOutbox().map((item) => ({
    date: item.date,
    runId: item.runId,
    snapshot: item.snapshot,
  })));
  return mergeCanonicalCompletedHistory(readScopedCache(), pending);
}

export function completedHistoryDays(records: Array<{ date: string; runId: string; snapshot: unknown }>): HistoryDay[] {
  const days = new Map<string, HistoryDay>();
  for (const record of records) {
    const snapshot = record.snapshot as { dayState?: { runs?: RunMeta[] }; runValues?: Record<string, FormValues> };
    const run = snapshot?.dayState?.runs?.find((candidate) => candidate.id === record.runId);
    if (!run) continue;
    const prior = days.get(record.date) ?? { date: record.date, runs: [], runValues: {} };
    const byId = new Map(prior.runs.map((candidate) => [candidate.id, candidate]));
    byId.set(run.id, run);
    days.set(record.date, { date: record.date, runs: [...byId.values()], runValues: { ...prior.runValues, ...snapshot.runValues } });
  }
  return [...days.values()].sort((a, b) => b.date.localeCompare(a.date));
}

/** Server immutable records win; local-only days remain so offline work is visible. */
export function mergeCanonicalCompletedHistory(local: HistoryDay[], canonical: HistoryDay[]): HistoryDay[] {
  const byDate = new Map(local.map((day) => [day.date, day]));
  for (const day of canonical) {
    const localDay = byDate.get(day.date);
    const runs = new Map((localDay?.runs ?? []).map((run) => [run.id, run]));
    for (const run of day.runs) runs.set(run.id, run);
    byDate.set(day.date, { date: day.date, runs: [...runs.values()], runValues: { ...(localDay?.runValues ?? {}), ...day.runValues } });
  }
  return [...byDate.values()].sort((a, b) => b.date.localeCompare(a.date));
}

export async function hydrateCompletedHistory(local: HistoryDay[], save: (days: HistoryDay[]) => void): Promise<void> {
  void local;
  const scope = activeScope;
  if (!scope) return;
  try {
    const response = await fetch("/api/completed-history");
    if (!response.ok) return;
    const body = await response.json() as { history?: Array<{ date: string; runId: string; snapshot: unknown }> };
    let evidence: ApplicatorBatchEvidence[] | undefined;
    try {
      evidence = await fetchAllApplicatorEvidence();
    } catch (error) {
      applicatorEvidenceHydrationError = error instanceof Error ? error.message : "Applicator evidence history could not be loaded";
    }
    if (evidence) {
      applicatorEvidenceHydrationError = null;
      writeEvidence(evidence, scope);
    }
    const pending = completedHistoryDays(readOutbox(scope).map((item) => ({
      date: item.date, runId: item.runId, snapshot: item.snapshot,
    })));
    const merged = mergeCanonicalCompletedHistory(
      mergeCanonicalCompletedHistory(readScopedCache(scope), pending),
      completedHistoryDays(body.history ?? []),
    );
    writeScopedCache(merged, scope);
    if (activeScope === scope) save(merged);
  } catch (error) {
    applicatorEvidenceHydrationError = error instanceof Error ? error.message : "Applicator evidence history could not be loaded";
    if (typeof window !== "undefined") window.dispatchEvent(new Event(APPLICATOR_EVIDENCE_EVENT));
  }
}