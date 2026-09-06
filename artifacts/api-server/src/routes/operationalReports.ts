import { and, eq, gte, lte } from "drizzle-orm";
import * as z from "zod";
import {
  aggregateDaySummary,
  type DaySummaryInput,
  type OperationalReport,
} from "@workspace/day-summary";
import {
  db,
  incidentsTable,
  inventoryItemsTable,
  inventoryLotsTable,
  inventoryLedgerTable,
  dailySyncTable,
  completedRunHistoryTable,
  syncConflictLogsTable,
  qualityChecksTable,
} from "@workspace/db";
import {
  deriveOperationalRunView,
  OperationalRunViewError,
  type OperationalSyncSnapshotV1,
} from "@workspace/live-calc";
import { syncSnapshotId } from "./sync";
import { currentScope } from "../lib/requestScope";
import { requireCapability } from "../middlewares/requireCapability";
import { dataHealthWorkspace } from "./profileDataHealth";
import { Router, type IRouter } from "express";

const router: IRouter = Router();

const RunSchema = z.object({
  brand: z.string(),
  flavor: z.string(),
  casesPlanned: z.number().finite(),
  casesProduced: z.number().finite(),
  finished: z.boolean(),
  downtimeMinutes: z.number().finite(),
  stoppageCount: z.number().finite(),
});
const BodySchema = z.object({
  scope: z.enum(["day", "week"]),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
    const parsed = new Date(`${value}T12:00:00Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }, "Invalid calendar date"),
  // Legacy callers may still send runs. Production facts always come from
  // canonical daily_sync rows, so this compatibility field is intentionally ignored.
  runs: z.array(RunSchema).max(600).optional(),
});

function addDays(iso: string, amount: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + amount);
  return d.toISOString().slice(0, 10);
}

export function dateRange(scope: "day" | "week", date: string): [string, string] {
  return scope === "week" ? [addDays(date, -6), date] : [date, date];
}

function datesInRange(start: string, end: string): string[] {
  const dates: string[] = [];
  for (let date = start; date <= end; date = addDays(date, 1)) dates.push(date);
  return dates;
}

export type OperationalReportValidationResult =
  | { ok: true; data: z.infer<typeof BodySchema> }
  | { ok: false; status: number; error: string };

export function validateOperationalReportBody(
  body: unknown,
): OperationalReportValidationResult {
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return { ok: false, status: 400, error: "Invalid operational report input" };
  }
  return { ok: true, data: parsed.data };
}

const OperationalViewQuery = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
    const parsed = new Date(`${value}T12:00:00Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }, "Invalid calendar date"),
  runId: z.string().min(1).max(500),
});

/** Adds transport metadata without modifying the durable canonical JSON payload. */
export function adaptCanonicalOperationalSnapshot(data: unknown): OperationalSyncSnapshotV1 | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  return ({
    ...(data as Record<string, unknown>),
    syncVersion: 1,
    completeness: "complete",
  } as OperationalSyncSnapshotV1);
}

function operationalError(res: import("express").Response, status: number, code: string, message: string): void {
  res.status(status).json({ error: { code, message } });
}

function viewToSummaryRun(view: ReturnType<typeof deriveOperationalRunView>): DaySummaryInput["runs"][number] {
  return {
    brand: view.observed.brand,
    flavor: view.observed.flavor,
    casesPlanned: view.recap.casesNeeded,
    casesProduced: view.recap.casesCompleted,
    finished: view.observed.status === "ended",
    downtimeMinutes: view.observed.stoppages.downtimeSeconds / 60,
    stoppageCount: view.observed.stoppages.count,
  };
}

type HandoffSeverity = "urgent" | "high" | "medium" | "low" | "info";
type HandoffStatus = "open" | "reviewed" | "resolved" | "historical" | "current";
type HandoffSource = "incidents" | "quality" | "inventory" | "sync" | "data-health";
type HandoffItem = {
  id: string; source: HandoffSource; severity: HandoffSeverity; status: HandoffStatus;
  title: string; detail: string; affectedRun: string | null; affectedProduct: string | null;
  occurredAt: string | null; sourcePath: string; historical: boolean;
  attentionState: "blocker" | "review" | "stale" | "info"; nextAction: string;
};
type ShiftHandoffDigest = {
  scope: string; date: string; generatedAt: string; items: HandoffItem[];
  sources: Record<HandoffSource, { availability: "available" | "unavailable"; note?: string; itemCount: number }>;
};
const HandoffQuery = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) });
const safeDate = (value: Date | string | null | undefined): string | null => {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
};
const inventorySeverity = (qty: number, threshold: number): HandoffSeverity =>
  qty <= 0 ? "urgent" : threshold > 0 && qty <= threshold ? "high" : "medium";
const handoffAttention = (severity: HandoffSeverity, status: HandoffStatus): HandoffItem["attentionState"] =>
  status === "historical" ? "stale" : severity === "urgent" || severity === "high" ? "blocker" : severity === "info" ? "info" : "review";
const handoffNextAction = (state: HandoffItem["attentionState"], status: HandoffStatus): string =>
  status === "historical" ? "Review when convenient" : state === "blocker" ? "Act now" : state === "review" ? "Review and decide" : "Monitor";

router.get("/reports/handoff", requireCapability("review-incidents"), async (req, res): Promise<void> => {
  const parsed = HandoffQuery.safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: "A valid production date is required" }); return; }
  const date = parsed.data.date;
  const scope = currentScope();
  const start = new Date(`${date}T00:00:00.000Z`);
  const end = new Date(`${date}T23:59:59.999Z`);
  const unavailable = (note: string) => ({ availability: "unavailable" as const, note, itemCount: 0 });
  const sources: ShiftHandoffDigest["sources"] = {
    incidents: unavailable("Incident history is unavailable."),
    quality: unavailable("Quality history is unavailable."),
    inventory: unavailable("Inventory history is unavailable."),
    sync: unavailable("Sync history is unavailable."),
    "data-health": unavailable("Data-health review is unavailable."),
  };
  const items: HandoffItem[] = [];
  const [incidents, quality, inventory, sync, health] = await Promise.all([
    db.select().from(incidentsTable).where(and(eq(incidentsTable.scope, scope), gte(incidentsTable.createdAt, start), lte(incidentsTable.createdAt, end))).catch(() => null),
    db.select().from(qualityChecksTable).where(and(eq(qualityChecksTable.scope, scope), gte(qualityChecksTable.createdAt, start), lte(qualityChecksTable.createdAt, end))).catch(() => null),
    Promise.all([
      db.select().from(inventoryItemsTable).where(eq(inventoryItemsTable.scope, scope)),
      db.select().from(inventoryLotsTable).where(eq(inventoryLotsTable.scope, scope)),
      db.select().from(inventoryLedgerTable).where(and(eq(inventoryLedgerTable.scope, scope), gte(inventoryLedgerTable.createdAt, start), lte(inventoryLedgerTable.createdAt, end))),
    ]).catch(() => null),
    db.select().from(syncConflictLogsTable).where(and(eq(syncConflictLogsTable.scope, scope), eq(syncConflictLogsTable.date, date))).catch(() => null),
    dataHealthWorkspace(db).catch(() => null),
  ]);
  if (incidents) {
    const open = incidents.filter((row) => row.status !== "resolved");
    sources.incidents = { availability: "available", itemCount: open.length };
    for (const row of open) {
      const context = row.context && typeof row.context === "object" ? row.context as Record<string, unknown> : {};
      const status = row.workflowState === "resolved" ? "resolved" : row.status === "reviewed" ? "reviewed" : "open";
      const severity = row.priority === "urgent" ? "urgent" : row.priority === "high" ? "high" : row.priority === "low" ? "low" : "medium";
      const state = handoffAttention(severity, status);
      items.push({ id: `incident:${row.id}`, source: "incidents", severity, status, title: row.source === "auto_crash" ? "Auto-captured crash" : "Reported issue", detail: String(context.description ?? context.errorMessage ?? row.diagnosis ?? "Incident requires manager review."), affectedRun: typeof context.runId === "string" ? context.runId : null, affectedProduct: typeof context.product === "string" ? context.product : null, occurredAt: safeDate(row.createdAt), sourcePath: "incidents", historical: false, attentionState: state, nextAction: handoffNextAction(state, status) });
    }
  }
  if (quality) {
    const exceptions = quality.filter((row) => row.status === "warn" || row.status === "fail");
    sources.quality = { availability: "available", itemCount: exceptions.length };
     for (const row of exceptions) { const state = handoffAttention(row.status === "fail" ? "high" : "medium", "historical"); items.push({ id: `quality:${row.id}`, source: "quality", severity: row.status === "fail" ? "high" : "medium", status: "historical", title: `${row.productType} quality exception`, detail: row.summary || `${Array.isArray(row.issues) ? row.issues.length : 0} issue(s) recorded.`, affectedRun: null, affectedProduct: row.productType, occurredAt: safeDate(row.createdAt), sourcePath: "quality", historical: true, attentionState: state, nextAction: handoffNextAction(state, "historical") }); }
  }
  if (inventory) {
    const [inventoryItems, lots, ledger] = inventory;
    const onHand = new Map<number, number>();
    for (const lot of lots) onHand.set(lot.itemId, (onHand.get(lot.itemId) ?? 0) + lot.qtyRemaining);
    const risk = inventoryItems.filter((item) => item.reorderThreshold > 0 && (onHand.get(item.id) ?? 0) <= item.reorderThreshold);
    const waste = ledger.filter((row) => row.type === "adjust" && row.qtyDelta < 0);
    sources.inventory = { availability: "available", itemCount: risk.length + waste.length };
     for (const item of risk) { const severity = inventorySeverity(onHand.get(item.id) ?? 0, item.reorderThreshold); const state = handoffAttention(severity, "current"); items.push({ id: `inventory-risk:${item.id}`, source: "inventory", severity, status: "current", title: `${item.name} is at or below reorder level`, detail: `${onHand.get(item.id) ?? 0} ${item.unit} on hand; reorder level is ${item.reorderThreshold} ${item.unit}.`, affectedRun: null, affectedProduct: item.name, occurredAt: safeDate(item.updatedAt), sourcePath: "inventory", historical: false, attentionState: state, nextAction: handoffNextAction(state, "current") }); }
     for (const row of waste) { const item = inventoryItems.find((candidate) => candidate.id === row.itemId); const state = handoffAttention("medium", "historical"); items.push({ id: `inventory-ledger:${row.id}`, source: "inventory", severity: "medium", status: "historical", title: `${item?.name ?? "Inventory item"} adjustment`, detail: `${Math.abs(row.qtyDelta)} ${item?.unit ?? "units"} removed${row.note ? ` — ${row.note}` : ""}.`, affectedRun: row.runId, affectedProduct: item?.name ?? null, occurredAt: safeDate(row.createdAt), sourcePath: "inventory", historical: true, attentionState: state, nextAction: handoffNextAction(state, "historical") }); }
  }
  if (sync) {
    sources.sync = { availability: "available", itemCount: sync.length };
     for (const row of sync) { const state = handoffAttention(row.conflictCount > 3 ? "high" : "medium", "historical"); items.push({ id: `sync:${row.id}`, source: "sync", severity: row.conflictCount > 3 ? "high" : "medium", status: "historical", title: "Sync conflict recorded", detail: `${row.conflictCount} conflict${row.conflictCount === 1 ? "" : "s"} resolved by ${row.resolution}.`, affectedRun: null, affectedProduct: null, occurredAt: safeDate(row.createdAt), sourcePath: "sync", historical: true, attentionState: state, nextAction: handoffNextAction(state, "historical") }); }
  }
  if (health) {
    const pending = health.findings.filter((finding) => finding.repairability === "review" || finding.severity !== "info");
    sources["data-health"] = { availability: "available", itemCount: pending.length };
     for (const finding of pending) { const severity = finding.severity === "error" ? "high" : finding.severity === "warning" ? "medium" : "info"; const state = handoffAttention(severity, "open"); items.push({ id: `data-health:${finding.id}`, source: "data-health", severity, status: "open", title: `${finding.brand || "Unbranded"} — ${finding.recipe}`, detail: finding.message, affectedRun: null, affectedProduct: [finding.brand, finding.flavor].filter(Boolean).join(" / ") || null, occurredAt: null, sourcePath: "data-health", historical: false, attentionState: state, nextAction: handoffNextAction(state, "open") }); }
  }
  const severityOrder: Record<HandoffSeverity, number> = { urgent: 0, high: 1, medium: 2, low: 3, info: 4 };
  items.sort((a, b) =>
    severityOrder[a.severity] - severityOrder[b.severity]
    || (Date.parse(b.occurredAt ?? "") || 0) - (Date.parse(a.occurredAt ?? "") || 0)
    || a.id.localeCompare(b.id),
  );
  res.json({ scope, date, generatedAt: new Date().toISOString(), items, sources } satisfies ShiftHandoffDigest);
});

// A point-in-time, server-derived operational read model. It deliberately reads
// one scoped canonical row rather than accepting a browser snapshot.
router.get(
  "/reports/operational-view",
  requireCapability("review-incidents"),
  async (req, res): Promise<void> => {
    const parsed = OperationalViewQuery.safeParse(req.query);
    if (!parsed.success) {
      operationalError(res, 400, "invalid-query", "Valid date and runId query parameters are required.");
      return;
    }
    const { date, runId } = parsed.data;
    const scope = currentScope();
    // An ended run has an immutable completion snapshot. Prefer it over the
    // mutable active-day document so later sync/reset activity cannot rewrite a
    // historical operational view.
    const completed = await db.select().from(completedRunHistoryTable).where(and(
      eq(completedRunHistoryTable.scope, scope),
      eq(completedRunHistoryTable.date, date),
      eq(completedRunHistoryTable.runId, runId),
    ));
    const rows = completed.length === 0 ? await db.select().from(dailySyncTable).where(and(
      eq(dailySyncTable.scope, scope),
      eq(dailySyncTable.date, date),
    )) : [];
    if (completed.length > 1) {
      operationalError(res, 409, "snapshot-ambiguous", "More than one immutable completion exists for this run.");
      return;
    }
    if (completed.length === 1) {
      const row = completed[0];
      const snapshot = adaptCanonicalOperationalSnapshot(row.snapshot);
      if (!snapshot) { operationalError(res, 400, "invalid-snapshot", "The immutable completion is not an object."); return; }
      try {
        res.json(deriveOperationalRunView({
          snapshot, date, runId, nowMs: Date.now(),
          snapshotMetadata: { snapshotId: row.snapshotHash, capturedAt: row.completedAt.getTime(), date },
        }));
        return;
      } catch (error) {
        const code = error instanceof OperationalRunViewError ? error.code : "derivation-failed";
        operationalError(res, code === "missing-run" ? 404 : 400, code, error instanceof Error ? error.message : "Invalid immutable completion.");
        return;
      }
    }
    if (rows.length === 0) {
      operationalError(res, 404, "snapshot-not-found", "No canonical snapshot exists for this date.");
      return;
    }
    if (rows.length !== 1) {
      operationalError(res, 409, "snapshot-ambiguous", "More than one canonical snapshot exists for this date.");
      return;
    }
    const row = rows[0];
    const snapshot = adaptCanonicalOperationalSnapshot(row.data);
    if (!snapshot) {
      operationalError(res, 400, "invalid-snapshot", "The canonical snapshot is not an object.");
      return;
    }
    const resetAt = (snapshot.dayState as { resetAt?: unknown } | undefined)?.resetAt;
    if (resetAt !== undefined && (typeof resetAt !== "number" || !Number.isFinite(resetAt) || resetAt < 0)) {
      operationalError(res, 409, "reset-ambiguity", "The canonical snapshot has an ambiguous reset generation.");
      return;
    }
    const nowMs = Date.now();
    try {
      const view = deriveOperationalRunView({
        snapshot,
        date,
        runId,
        nowMs,
        snapshotMetadata: {
          snapshotId: syncSnapshotId(row.data),
          capturedAt: row.updatedAt.getTime(),
          date,
          ...(typeof resetAt === "number" ? { resetAt } : {}),
        },
      });
      req.log.info({
        event: "operational_view_derived",
        scope,
        date,
        runId,
        status: view.observed.status,
        runCount: snapshot.dayState.runs.length,
        stoppageCount: view.observed.stoppages.count,
      }, "Operational view derived");
      res.json(view);
    } catch (error) {
      if (error instanceof OperationalRunViewError) {
        const status = error.code === "missing-run" ? 404
          : error.code === "duplicate-run" || error.code === "reset-mismatch" ? 409 : 400;
        req.log.info({
          event: "operational_view_rejected",
          scope,
          date,
          runId,
          status: error.code,
          runCount: Array.isArray(snapshot.dayState?.runs) ? snapshot.dayState.runs.length : 0,
        }, "Operational view rejected");
        operationalError(res, status, error.code, error.message);
        return;
      }
      throw error;
    }
  },
);

router.post(
  "/reports/operational",
  requireCapability("review-incidents"),
  async (req, res): Promise<void> => {
    const parsed = validateOperationalReportBody(req.body);
    if (!parsed.ok) {
      res.status(parsed.status).json({ error: parsed.error });
      return;
    }
    const input = parsed.data;
    const [periodStart, periodEnd] = dateRange(input.scope, input.date);
    const scope = currentScope();
    const [qualityRows, incidentRows, inventoryRows, lots, syncRows, completionRows] = await Promise.all([
      db.select().from(qualityChecksTable).where(
        and(
          eq(qualityChecksTable.scope, scope),
          gte(qualityChecksTable.createdAt, new Date(`${periodStart}T00:00:00Z`)),
          lte(qualityChecksTable.createdAt, new Date(`${periodEnd}T23:59:59.999Z`)),
        ),
      ),
      db.select().from(incidentsTable).where(
        and(
          eq(incidentsTable.scope, scope),
          gte(incidentsTable.createdAt, new Date(`${periodStart}T00:00:00Z`)),
          lte(incidentsTable.createdAt, new Date(`${periodEnd}T23:59:59.999Z`)),
        ),
      ),
      db.select().from(inventoryItemsTable).where(eq(inventoryItemsTable.scope, scope)),
      db.select().from(inventoryLotsTable).where(eq(inventoryLotsTable.scope, scope)),
      db.select().from(dailySyncTable).where(and(
        eq(dailySyncTable.scope, scope),
        gte(dailySyncTable.date, periodStart),
        lte(dailySyncTable.date, periodEnd),
      )),
      db.select().from(completedRunHistoryTable).where(and(
        eq(completedRunHistoryTable.scope, scope),
        gte(completedRunHistoryTable.date, periodStart),
        lte(completedRunHistoryTable.date, periodEnd),
      )),
    ]);
    let historicalInventory: NonNullable<
      NonNullable<OperationalReport["inventory"]["value"]>["historical"]
    >;
    try {
      const ledgerRows = await db.select().from(inventoryLedgerTable).where(
        and(
          eq(inventoryLedgerTable.scope, scope),
          gte(inventoryLedgerTable.createdAt, new Date(`${periodStart}T00:00:00Z`)),
          lte(inventoryLedgerTable.createdAt, new Date(`${periodEnd}T23:59:59.999Z`)),
        ),
      );
      historicalInventory = {
        availability: "available",
        value: {
          totalEvents: ledgerRows.length,
          consumptionEvents: ledgerRows.filter((row) => row.type === "consume").length,
          wasteEvents: ledgerRows.filter((row) => row.type === "adjust" && row.qtyDelta < 0).length,
          adjustmentEvents: ledgerRows.filter((row) => row.type === "adjust").length,
        },
        note: "Historical inventory ledger events recorded during this period.",
      };
    } catch {
      historicalInventory = {
        availability: "unavailable",
        value: null,
        note: "Historical inventory ledger is unavailable; no historical event totals are shown.",
      };
    }
    const onHand = new Map<number, number>();
    for (const lot of lots) onHand.set(lot.itemId, (onHand.get(lot.itemId) ?? 0) + lot.qtyRemaining);
    const flaggedItems = inventoryRows.filter(
      (item) => item.reorderThreshold > 0 && (onHand.get(item.id) ?? 0) <= item.reorderThreshold,
    ).length;
    const qualityIssues = qualityRows.reduce((n, row) => n + (Array.isArray(row.issues) ? row.issues.length : 0), 0);
    // Do not trust compatibility `input.runs`: production facts are derived
    // from immutable completed records for ended historical runs. The mutable
    // daily_sync document remains the source only for the active/current day.
    const nowMs = Date.now();
    const canonicalRuns: DaySummaryInput["runs"] = [];
    let canonicalFailure: { date: string; code: string } | null = null;
    const expectedDates = datesInRange(periodStart, periodEnd);
    type ReportSnapshot = {
      date: string;
      data: unknown;
      updatedAt: Date;
      source: "active" | "completed";
    };
    const rowsByDate = new Map<string, ReportSnapshot[]>();
    const completedRunKeys = new Set(
      completionRows.map((row) => `${row.date}\u0000${row.runId}`),
    );
    for (const row of syncRows) {
      const rows = rowsByDate.get(row.date) ?? [];
      rows.push({ date: row.date, data: row.data, updatedAt: row.updatedAt, source: "active" });
      rowsByDate.set(row.date, rows);
    }
    for (const row of completionRows) {
      const rows = rowsByDate.get(row.date) ?? [];
      rows.push({
        date: row.date,
        data: row.snapshot,
        updatedAt: row.completedAt,
        source: "completed",
      });
      rowsByDate.set(row.date, rows);
    }
    for (const date of expectedDates) {
      const rows = rowsByDate.get(date) ?? [];
      if (rows.length === 0) {
        canonicalFailure = {
          date,
          code: "snapshot-not-found",
        };
        break;
      }
    }
    for (const rows of rowsByDate.values()) for (const row of rows) {
      if (canonicalFailure) break;
      const snapshot = adaptCanonicalOperationalSnapshot(row.data);
      if (!snapshot || !Array.isArray(snapshot.dayState?.runs)) {
        canonicalFailure = { date: row.date, code: "invalid-snapshot" };
        break;
      }
      const resetAt = (snapshot.dayState as { resetAt?: unknown }).resetAt;
      if (
        resetAt !== undefined &&
        (typeof resetAt !== "number" || !Number.isFinite(resetAt) || resetAt < 0)
      ) {
        canonicalFailure = { date: row.date, code: "reset-ambiguity" };
        break;
      }
      for (const rawRun of snapshot.dayState.runs) {
        if (!rawRun || typeof rawRun.id !== "string" || !rawRun.id) {
          canonicalFailure = { date: row.date, code: "invalid-run" };
          break;
        }
        if (
          row.source === "active"
          && completedRunKeys.has(`${row.date}\u0000${rawRun.id}`)
        ) continue;
        try {
          canonicalRuns.push(viewToSummaryRun(deriveOperationalRunView({
            snapshot,
            date: row.date,
            runId: rawRun.id,
            nowMs,
            snapshotMetadata: {
              snapshotId: syncSnapshotId(row.data),
              capturedAt: row.updatedAt.getTime(),
              date: row.date,
              ...(typeof resetAt === "number" ? { resetAt } : {}),
            },
          })));
        } catch (error) {
          canonicalFailure = {
            date: row.date,
            code: error instanceof OperationalRunViewError
              ? error.code
              : "derivation-failed",
          };
          break;
        }
      }
      if (canonicalFailure) break;
    }
    if (canonicalFailure) {
      req.log.warn({
        event: "operational_report_canonical_rejected",
        scope,
        date: canonicalFailure.date,
        code: canonicalFailure.code,
        acceptedRunCount: canonicalRuns.length,
      }, "Canonical operational report input was invalid");
      operationalError(
        res,
        409,
        "canonical-snapshot-invalid",
        "Canonical production facts are incomplete or ambiguous; no authoritative report was generated.",
      );
      return;
    }
    const productionInput: DaySummaryInput = {
      scope: input.scope,
      date: input.date,
      runs: canonicalRuns,
      incidentCount: incidentRows.length,
      wasteFlaggedCount: flaggedItems,
    };
    const report: OperationalReport & {
      evidence: {
        release: { version: string; revision: string; environment: string };
        recovery: { generatedAt: string; source: "live-database"; complete: boolean };
      };
    } = {
      scope: input.scope,
      date: input.date,
      periodStart,
      periodEnd,
      generatedAt: new Date().toISOString(),
      production: aggregateDaySummary(productionInput),
      quality: {
        availability: "available",
        value: {
          checks: qualityRows.length,
          issues: qualityIssues,
          failed: qualityRows.filter((r) => r.status === "fail").length,
          warnings: qualityRows.filter((r) => r.status === "warn").length,
        },
        note: qualityRows.length === 0 ? "No quality checks were recorded in this period." : undefined,
      },
      incidents: {
        availability: "available",
        value: {
          total: incidentRows.length,
          unresolved: incidentRows.filter((r) => r.status !== "resolved").length,
        },
        note: incidentRows.length === 0 ? "No incidents were recorded in this period." : undefined,
      },
      inventory: {
        availability: "available",
        value: { flaggedItems, historical: historicalInventory },
        note: "Current inventory snapshot; not a historical period total.",
      },
      evidence: {
        release: {
          version: process.env.npm_package_version ?? "unknown",
          revision: process.env.REPLIT_GIT_COMMIT ?? process.env.GIT_COMMIT ?? "unknown",
          environment: process.env.NODE_ENV ?? "unknown",
        },
        recovery: {
          generatedAt: new Date().toISOString(),
          source: "live-database",
          complete: true,
        },
      },
    };
    res.json(report);
  },
);

export default router;