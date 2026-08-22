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
  syncConflictLogsTable,
  qualityChecksTable,
} from "@workspace/db";
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
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  runs: z.array(RunSchema).max(600),
});

function addDays(iso: string, amount: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + amount);
  return d.toISOString().slice(0, 10);
}

function dateRange(scope: "day" | "week", date: string): [string, string] {
  return scope === "week" ? [addDays(date, -6), date] : [date, date];
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

router.post(
  "/reports/operational",
  requireCapability("review-incidents"),
  async (req, res): Promise<void> => {
    const parsed = BodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid operational report input" });
      return;
    }
    const input = parsed.data;
    const [periodStart, periodEnd] = dateRange(input.scope, input.date);
    const scope = currentScope();
    const [qualityRows, incidentRows, inventoryRows, lots] = await Promise.all([
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
    const productionInput: DaySummaryInput = {
      scope: input.scope,
      date: input.date,
      runs: input.runs,
      incidentCount: incidentRows.length,
      wasteFlaggedCount: flaggedItems,
    };
    const report: OperationalReport = {
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
    };
    res.json(report);
  },
);

export default router;