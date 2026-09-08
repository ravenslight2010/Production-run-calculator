import { and, eq, desc } from "drizzle-orm";
import {
  dailySyncTable,
  operationalIntentLedgerTable,
  completedRunHistoryTable,
} from "@workspace/db";
import { syncSnapshotId } from "./syncContract";
import type { Scope } from "./requestScope";
import {
  buildOperationalProjection,
  computeAutoTrackSchedule,
  computeServerCalc,
  applyTemporaryOverrides,
  type AutoTrackScheduleInput,
} from "@workspace/live-calc";

export const SYNC_HEALTH_CONTRACT_VERSION = 1 as const;
export const SYNC_HEALTH_MAX_LEDGER_ROWS = 100;
export const SYNC_HEALTH_MAX_HISTORY_ROWS = 100;

export type SyncHealthCheckStatus = "healthy" | "warning" | "failing" | "unknown";
export type SyncHealthStatus = "healthy" | "warning" | "failing";

export type SyncHealthCheck = {
  name: "canonical-document" | "snapshot-revision" | "operational-projection" | "command-history";
  status: SyncHealthCheckStatus;
  summary: string;
  nextAction: string;
};

export type SyncHealthReport = {
  contractVersion: typeof SYNC_HEALTH_CONTRACT_VERSION;
  scope: Scope;
  date: string;
  checkedAt: string;
  status: SyncHealthStatus;
  nextAction: string;
  checks: SyncHealthCheck[];
  bounds: {
    maxLedgerRows: number;
    maxHistoryRows: number;
  };
  evidence: {
    dailyRowPresent: boolean;
    canonicalRevision: number | null;
    snapshotId: string | null;
    ledgerRowsScanned: number;
    ledgerRowsTruncated: boolean;
    historyRowsScanned: number;
    historyRowsTruncated: boolean;
  };
};

type Executor = Pick<typeof import("@workspace/db").db, "select">;

function overallStatus(checks: SyncHealthCheck[]): SyncHealthStatus {
  if (checks.some((check) => check.status === "failing")) return "failing";
  if (checks.some((check) => check.status === "warning" || check.status === "unknown")) return "warning";
  return "healthy";
}

function reportNextAction(status: SyncHealthStatus): string {
  if (status === "failing") {
    return "Review the named invariant and use the separate data-heal or incident workflow; this check did not repair anything.";
  }
  if (status === "warning") {
    return "Review the named invariant and rerun the check after canonical sync evidence is available.";
  }
  return "No action required; rerun after a material sync or operational change.";
}

function isSyncDocument(value: unknown): value is {
  dayState?: { runs?: unknown[]; currentIndex?: number };
  runValues?: Record<string, Record<string, unknown>>;
  operationalProjection?: unknown;
} {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/**
 * Read-only, deliberately redacted runtime checks for the manager diagnostics
 * surface. The returned report contains identities, counts, and classifications
 * only; it never returns a sync document, command body, recipe, or history
 * snapshot.
 */
export async function buildSyncHealthReport(
  executor: Executor,
  scope: Scope,
  date: string,
  at = new Date(),
): Promise<SyncHealthReport> {
  const [rows, ledgerRows, historyRows] = await Promise.all([
    executor.select({
      date: dailySyncTable.date,
      data: dailySyncTable.data,
      canonicalRevision: dailySyncTable.canonicalRevision,
    }).from(dailySyncTable).where(and(
      eq(dailySyncTable.scope, scope),
      eq(dailySyncTable.date, date),
    )).limit(1),
    executor.select({
      sequence: operationalIntentLedgerTable.sequence,
      outcome: operationalIntentLedgerTable.outcome,
      snapshot: operationalIntentLedgerTable.snapshot,
    }).from(operationalIntentLedgerTable).where(and(
      eq(operationalIntentLedgerTable.scope, scope),
      eq(operationalIntentLedgerTable.date, date),
    )).orderBy(desc(operationalIntentLedgerTable.sequence)).limit(SYNC_HEALTH_MAX_LEDGER_ROWS + 1),
    executor.select({
      snapshot: completedRunHistoryTable.snapshot,
      snapshotHash: completedRunHistoryTable.snapshotHash,
    }).from(completedRunHistoryTable).where(and(
      eq(completedRunHistoryTable.scope, scope),
      eq(completedRunHistoryTable.date, date),
    )).orderBy(desc(completedRunHistoryTable.completedAt)).limit(SYNC_HEALTH_MAX_HISTORY_ROWS + 1),
  ]);

  const row = rows[0];
  const data = row?.data;
  const hasDocument = Boolean(row && isSyncDocument(data));
  const snapshotId = hasDocument ? syncSnapshotId(data) : null;
  const canonicalRevision = row
    ? Number.isSafeInteger(row.canonicalRevision) && row.canonicalRevision >= 0
      ? row.canonicalRevision
      : null
    : null;
  const ledgerTruncated = ledgerRows.length > SYNC_HEALTH_MAX_LEDGER_ROWS;
  const historyTruncated = historyRows.length > SYNC_HEALTH_MAX_HISTORY_ROWS;
  const boundedLedger = ledgerRows.slice(0, SYNC_HEALTH_MAX_LEDGER_ROWS);
  const boundedHistory = historyRows.slice(0, SYNC_HEALTH_MAX_HISTORY_ROWS);

  const checks: SyncHealthCheck[] = [];
  checks.push({
    name: "canonical-document",
    status: !row
      ? "warning"
      : hasDocument
        ? "healthy"
        : "failing",
    summary: !row
      ? "No canonical daily sync row exists for this production date."
      : hasDocument
        ? "The scoped canonical daily sync row is present."
        : "The canonical daily sync row is not a JSON object.",
    nextAction: !row
      ? "Confirm the selected production date before treating the absence as an incident."
      : hasDocument
        ? "No action required."
        : "Open a data-health or incident review; do not repair from this screen.",
  });

  checks.push({
    name: "snapshot-revision",
    status: !row || !hasDocument
      ? "unknown"
      : canonicalRevision === null
        ? "failing"
        : "healthy",
    summary: !row || !hasDocument
      ? "Snapshot and revision identity cannot be verified without a canonical document."
      : canonicalRevision === null
        ? "The server-owned canonical revision is missing or invalid."
        : `Canonical revision ${canonicalRevision} has a stable snapshot identity.`,
    nextAction: !row || !hasDocument
      ? "Review the canonical-document check first."
      : canonicalRevision === null
        ? "Open an incident review; the sentinel does not change revision metadata."
        : "No action required.",
  });

  const currentRun = isSyncDocument(data) && data.dayState && Array.isArray(data.dayState.runs)
    ? data.dayState.runs[data.dayState.currentIndex ?? 0]
    : undefined;
  const runRecord = currentRun && typeof currentRun === "object" && !Array.isArray(currentRun)
    ? currentRun as Record<string, unknown>
    : undefined;
  const hasRunValues = !!runRecord
    && typeof runRecord.id === "string"
    && !!data && isSyncDocument(data)
    && !!data.runValues
    && typeof data.runValues[runRecord.id] === "object";
  let projectionStatus: SyncHealthCheckStatus = "unknown";
  let projectionSummary = "Operational projection evidence is unavailable without a canonical document.";
  let projectionNextAction = "Review the canonical-document check first.";
  if (row && hasDocument && currentRun === undefined) {
    projectionStatus = "warning";
    projectionSummary = "The canonical day has no selected run; no operational projection is expected.";
    projectionNextAction = "No action required.";
  } else if (row && hasDocument && hasRunValues && runRecord && typeof data?.runValues === "object") {
    try {
      const payload = data as Parameters<typeof computeServerCalc>[0];
      const serverCalc = computeServerCalc(payload, ["Pepperoni Stick", "Pepperoni Stick - NATURAL"], at.getTime());
      const runId = runRecord.id as string;
      const rawValues = data.runValues?.[runId] ?? {};
      const schedule = serverCalc
        ? computeAutoTrackSchedule({
          runId,
          metaUpdatedAt: typeof runRecord.metaUpdatedAt === "number" ? runRecord.metaUpdatedAt : undefined,
          startedAt: typeof runRecord.startedAt === "number" ? runRecord.startedAt : undefined,
          pausedAt: typeof runRecord.pausedAt === "number" ? runRecord.pausedAt : undefined,
          endedAt: typeof runRecord.endedAt === "number" ? runRecord.endedAt : undefined,
          stoppages: Array.isArray(runRecord.stoppages) ? runRecord.stoppages as AutoTrackScheduleInput["stoppages"] : undefined,
          v: applyTemporaryOverrides(rawValues) as unknown as AutoTrackScheduleInput["v"],
          calc: serverCalc.calc,
          progress: rawValues,
          nowMs: at.getTime(),
        })
        : null;
      const projection = serverCalc && schedule
        ? buildOperationalProjection({
          payload: payload as Parameters<typeof buildOperationalProjection>[0]["payload"],
          serverCalc,
          schedule,
          nowMs: at.getTime(),
          calculationRevision: canonicalRevision ?? 0,
        })
        : null;
      const stored = data.operationalProjection;
      const storedMatches = !stored || (
        typeof stored === "object"
        && !Array.isArray(stored)
        && (stored as Record<string, unknown>).runId === projection?.runId
        && (stored as Record<string, unknown>).calculationRevision === projection?.calculationRevision
      );
      if (!projection) {
        projectionStatus = "failing";
        projectionSummary = "The selected canonical run has values, but the server could not derive its operational projection.";
        projectionNextAction = "Open an incident review for the projection calculation; this check did not fill it in.";
      } else if (!storedMatches) {
        projectionStatus = "failing";
        projectionSummary = "Stored operational projection identity does not match the projection derived from canonical state.";
        projectionNextAction = "Open an incident review for the projection mismatch; do not repair it from this screen.";
      } else {
        projectionStatus = "healthy";
        projectionSummary = "The server derived an operational projection from the canonical run and its values.";
        projectionNextAction = "No action required.";
      }
    } catch {
      projectionStatus = "failing";
      projectionSummary = "The server could not derive an operational projection from the selected canonical run.";
      projectionNextAction = "Open an incident review for the projection calculation; this check did not fill it in.";
    }
  } else if (row && hasDocument) {
    projectionStatus = "failing";
    projectionSummary = "The selected canonical run is missing its server-observable run values.";
    projectionNextAction = "Open an incident review for the incomplete operational state; this check did not fill it in.";
  }
  checks.push({
    name: "operational-projection",
    status: projectionStatus,
    summary: projectionSummary,
    nextAction: projectionNextAction,
  });

  const invalidLedger = boundedLedger.find((item) =>
    !Number.isSafeInteger(item.sequence)
    || !["accepted", "conflicted", "review-required"].includes(item.outcome)
    || (item.outcome === "accepted" && !item.snapshot),
  );
  const invalidHistory = boundedHistory.find((item) => {
    if (!item.snapshot || typeof item.snapshot !== "object" || Array.isArray(item.snapshot)) return true;
    try {
      return item.snapshotHash !== syncSnapshotId(item.snapshot);
    } catch {
      return true;
    }
  });
  checks.push({
    name: "command-history",
    status: invalidLedger || invalidHistory
      ? "failing"
      : ledgerTruncated || historyTruncated
        ? "warning"
        : "healthy",
    summary: invalidLedger
      ? "A bounded command receipt has an invalid outcome, sequence, or accepted snapshot."
      : invalidHistory
        ? "A bounded completed-run history row has a snapshot hash mismatch or unusable snapshot."
        : ledgerTruncated || historyTruncated
          ? "The command/history evidence exceeded the bounded scan; only a prefix was checked."
          : `Checked ${boundedLedger.length} command receipt${boundedLedger.length === 1 ? "" : "s"} and ${boundedHistory.length} completed histor${boundedHistory.length === 1 ? "y row" : "y rows"}.`,
    nextAction: invalidLedger || invalidHistory
      ? "Open an incident or data-review workflow; the sentinel reports mismatches but never repairs them."
      : ledgerTruncated || historyTruncated
        ? "Review the bounded-result warning and rerun with a narrower production date if needed."
        : "No action required.",
  });

  const status = overallStatus(checks);
  return {
    contractVersion: SYNC_HEALTH_CONTRACT_VERSION,
    scope,
    date,
    checkedAt: at.toISOString(),
    status,
    nextAction: reportNextAction(status),
    checks,
    bounds: {
      maxLedgerRows: SYNC_HEALTH_MAX_LEDGER_ROWS,
      maxHistoryRows: SYNC_HEALTH_MAX_HISTORY_ROWS,
    },
    evidence: {
      dailyRowPresent: Boolean(row),
      canonicalRevision,
      snapshotId,
      ledgerRowsScanned: boundedLedger.length,
      ledgerRowsTruncated: ledgerTruncated,
      historyRowsScanned: boundedHistory.length,
      historyRowsTruncated: historyTruncated,
    },
  };
}