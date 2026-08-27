import { Router, type Request, type Response } from "express";
import { and, desc, eq, inArray, lt, sql } from "drizzle-orm";
import {
  actionItemsTable,
  auditLogsTable,
  db,
  incidentsTable,
  importHistoryTable,
  productionRulesTable,
  syncConflictLogsTable,
} from "@workspace/db";
import { currentScope } from "../lib/requestScope";
import { getStaffMember } from "../lib/roles";
import { requireCapability } from "../middlewares/requireCapability";
import { dataHealthWorkspace } from "./profileDataHealth";

const router = Router();
const statuses = new Set(["open", "in_progress", "deferred", "resolved"]);
const activeStatuses = ["open", "in_progress", "deferred"] as const;
const HISTORY_PAGE_SIZE = 100;
const refreshes = new Map<string, Promise<void>>();

type Candidate = {
  dedupKey: string;
  category: string;
  severity: string;
  title: string;
  description: string;
  sourceType: string;
  sourceId: string;
  sourcePath: string;
  attentionState?: "blocker" | "review" | "stale" | "info";
  nextAction?: string;
};

function attentionStateFor(severity: string): Candidate["attentionState"] {
  if (severity === "urgent" || severity === "error") return "blocker";
  if (severity === "info") return "info";
  return "review";
}

function nextActionFor(state: Candidate["attentionState"]): string {
  return state === "blocker" ? "Act now" : state === "review" ? "Review and decide" : state === "stale" ? "Recover or close" : "Monitor";
}

type QueueCursor = { id: number };

function encodeQueueCursor(item: { id: number }): string {
  return Buffer.from(JSON.stringify({ id: item.id })).toString("base64url");
}

function decodeQueueCursor(value: unknown): QueueCursor | undefined {
  if (typeof value !== "string" || value.length > 300) return undefined;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Partial<QueueCursor>;
    const id = parsed.id;
    if (typeof id !== "number" || !Number.isInteger(id) || id < 1) return undefined;
    return { id };
  } catch {
    return undefined;
  }
}

function clean(value: unknown, max: number): string {
  return String(value ?? "").trim().slice(0, max);
}

async function candidates(): Promise<Candidate[]> {
  const scope = currentScope();
  const [incidents, imports, conflicts, rules, health] = await Promise.all([
    db.select().from(incidentsTable).where(and(
      eq(incidentsTable.scope, scope),
      inArray(incidentsTable.workflowState, ["new", "assigned", "waiting"]),
    )),
    db.select().from(importHistoryTable).where(and(
      eq(importHistoryTable.scope, scope),
      inArray(importHistoryTable.status, ["partial", "failed"]),
    )),
    db.select().from(syncConflictLogsTable).where(and(
      eq(syncConflictLogsTable.scope, scope),
      sql`${syncConflictLogsTable.conflictCount} > 0`,
    )),
    db.select().from(productionRulesTable).where(and(
      eq(productionRulesTable.scope, scope),
      eq(productionRulesTable.enabled, true),
    )),
    dataHealthWorkspace(db),
  ]);
  const out: Candidate[] = [];
  for (const item of incidents) out.push({
    dedupKey: `incident:${item.id}`,
    category: "incident",
    severity: item.priority === "urgent" ? "urgent" : item.priority === "high" ? "error" : "warning",
    title: item.source === "auto_crash" ? "Review captured crash" : "Review reported issue",
    description: clean(item.context && typeof item.context === "object"
      ? (item.context as Record<string, unknown>).description : "", 500) || item.screen,
    sourceType: "incident", sourceId: item.id,
    sourcePath: `#incidents/${encodeURIComponent(item.id)}`,
    attentionState: attentionStateFor(item.priority === "urgent" ? "urgent" : item.priority === "high" ? "error" : "warning"),
    nextAction: nextActionFor(attentionStateFor(item.priority === "urgent" ? "urgent" : item.priority === "high" ? "error" : "warning")),
  });
  for (const item of imports) out.push({
    dedupKey: `import:${item.id}`, category: "import",
    severity: item.status === "failed" ? "error" : "warning",
    title: `${item.importType === "spec" ? "Spec" : "Premix"} import needs review`,
    description: `${item.sourceLabel}${item.customerScope ? ` · ${item.customerScope}` : ""}`,
    sourceType: "import", sourceId: String(item.id), sourcePath: "#import-history",
    attentionState: attentionStateFor(item.status === "failed" ? "error" : "warning"),
    nextAction: item.status === "failed" ? "Retry or correct import" : "Review import details",
  });
  for (const item of health.findings.filter((finding) => finding.severity !== "info")) out.push({
    dedupKey: `data-health:${item.id}`, category: "data-health", severity: item.severity,
    title: "Data health finding", description: item.message,
    sourceType: "data-health", sourceId: item.id, sourcePath: "#data-health",
    attentionState: attentionStateFor(item.severity),
    nextAction: "Review finding",
  });
  for (const item of conflicts) out.push({
    dedupKey: `sync:${item.id}`, category: "sync",
    severity: item.conflictCount > 5 ? "error" : "warning",
    title: "Sync conflict needs review",
    description: `${item.conflictCount} conflicting field${item.conflictCount === 1 ? "" : "s"} on ${item.date}`,
    sourceType: "sync", sourceId: String(item.id), sourcePath: "#sync-diagnostics",
    attentionState: attentionStateFor(item.conflictCount > 5 ? "error" : "warning"),
    nextAction: "Review and reconcile",
  });
  for (const item of rules.filter((rule) => (rule.checklist?.length ?? 0) > 0)) out.push({
    dedupKey: `production-rule:${item.id}`, category: "production-rule", severity: "warning",
    title: "Production rule checklist needs review", description: item.name,
    sourceType: "production-rule", sourceId: item.id, sourcePath: "#production-rules",
  });
  return out;
}

async function refreshQueue(): Promise<void> {
  const scope = currentScope();
  const currentRefresh = refreshes.get(scope);
  if (currentRefresh) return currentRefresh;
  // Refresh all derived candidates in one upsert. The previous per-item
  // awaited loop made opening the queue scale linearly with accumulated
  // findings, delaying manually inserted queue items behind hundreds of
  // round-trips and making concurrent manager views race their UI budget.
  const refresh = (async () => {
    const items = await candidates();
    if (items.length === 0) return;
    await db.insert(actionItemsTable).values(items.map((item) => ({ scope, ...item }))).onConflictDoUpdate({
      target: [actionItemsTable.scope, actionItemsTable.dedupKey],
      set: {
        category: sql`excluded.category`,
        severity: sql`excluded.severity`,
        title: sql`excluded.title`,
        description: sql`excluded.description`,
        sourceType: sql`excluded.source_type`,
        sourceId: sql`excluded.source_id`,
        sourcePath: sql`excluded.source_path`,
        updatedAt: sql`NOW()`,
      },
      setWhere: sql`
        ${actionItemsTable.category} IS DISTINCT FROM excluded.category OR
        ${actionItemsTable.severity} IS DISTINCT FROM excluded.severity OR
        ${actionItemsTable.title} IS DISTINCT FROM excluded.title OR
        ${actionItemsTable.description} IS DISTINCT FROM excluded.description OR
        ${actionItemsTable.sourceType} IS DISTINCT FROM excluded.source_type OR
        ${actionItemsTable.sourceId} IS DISTINCT FROM excluded.source_id OR
        ${actionItemsTable.sourcePath} IS DISTINCT FROM excluded.source_path
      `,
    });
  })();
  refreshes.set(scope, refresh);
  try {
    await refresh;
  } finally {
    if (refreshes.get(scope) === refresh) refreshes.delete(scope);
  }
}

router.get("/manager-action-queue", requireCapability("manage-staff"), async (req: Request, res: Response) => {
  const requestedStatus = typeof req.query.status === "string" ? req.query.status : undefined;
  const requestedCategory = typeof req.query.category === "string" ? clean(req.query.category, 40) : undefined;
  const requestedCursor = req.query.cursor;
  if (requestedStatus && requestedStatus !== "all" && !statuses.has(requestedStatus)) {
    res.status(400).json({ error: "Invalid action queue status filter" });
    return;
  }
  if (requestedCursor !== undefined && !decodeQueueCursor(requestedCursor)) {
    res.status(400).json({ error: "Invalid action queue cursor" });
    return;
  }
  try {
    await refreshQueue();
    const scope = currentScope();
    const baseConditions = [eq(actionItemsTable.scope, scope)];
    if (requestedCategory && requestedCategory !== "all") {
      baseConditions.push(eq(actionItemsTable.category, requestedCategory));
    }
    const cursor = decodeQueueCursor(requestedCursor);
    const beforeCursor = cursor
      ? lt(actionItemsTable.id, cursor.id)
      : undefined;
    const historyConditions = [
      ...baseConditions,
      eq(actionItemsTable.status, "resolved"),
      ...(beforeCursor ? [beforeCursor] : []),
    ];
    const activeConditions = [
      ...baseConditions,
      inArray(actionItemsTable.status, [...activeStatuses]),
    ];
    const pageHistory = requestedStatus === undefined || requestedStatus === "all" || requestedStatus === "resolved";
    const pageSize = HISTORY_PAGE_SIZE + 1;
    const [activeRows, historyRows, groupedCounts] = await Promise.all([
      requestedStatus === "resolved"
        ? Promise.resolve([])
        : db.select().from(actionItemsTable)
          .where(requestedStatus && requestedStatus !== "all"
            ? and(...baseConditions, eq(actionItemsTable.status, requestedStatus))
            : and(...activeConditions))
          .orderBy(desc(actionItemsTable.updatedAt), desc(actionItemsTable.id)),
      pageHistory
        ? db.select().from(actionItemsTable)
          .where(and(...historyConditions))
          .orderBy(desc(actionItemsTable.id))
          .limit(pageSize)
        : Promise.resolve([]),
      db.select({
        status: actionItemsTable.status,
        count: sql<number>`count(*)::int`,
      }).from(actionItemsTable)
        .where(eq(actionItemsTable.scope, scope))
        .groupBy(actionItemsTable.status),
    ]);
    const hasMore = historyRows.length > HISTORY_PAGE_SIZE;
    const rows = [
      ...activeRows,
      ...historyRows.slice(0, HISTORY_PAGE_SIZE),
    ];
    const nextCursor = hasMore ? encodeQueueCursor(historyRows[HISTORY_PAGE_SIZE - 1]) : null;
    const counts = Object.fromEntries(["open", "in_progress", "deferred", "resolved"].map((status) => [
      status,
      groupedCounts.find((row) => row.status === status)?.count ?? 0,
    ]));
    res.json({
      items: rows,
      counts,
      nextCursor,
    });
  } catch (err) {
    req.log.error({ err }, "failed to load manager action queue");
    res.status(500).json({ error: "Failed to load manager action queue" });
  }
});

router.patch("/manager-action-queue/:id", requireCapability("manage-staff"), async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const body = req.body && typeof req.body === "object" ? req.body as Record<string, unknown> : {};
  const status = body.status === undefined ? undefined : clean(body.status, 30);
  const version = Number(body.version);
  if (!Number.isInteger(id) || !Number.isInteger(version) ||
      (status !== undefined && !statuses.has(status)) ||
      (body.deferReason !== undefined && clean(body.deferReason, 2000).length < 3) ||
      (body.resolutionNote !== undefined && clean(body.resolutionNote, 2000).length < 1)) {
    res.status(400).json({ error: "Invalid action item update" });
    return;
  }
  try {
    const actor = await getStaffMember(req.userId!);
    const scope = currentScope();
    let assigneeId: string | null | undefined;
    let assigneeName: string | null | undefined;
    if (body.assigneeId !== undefined) {
      assigneeId = body.assigneeId === "me" ? req.userId!
        : body.assigneeId === null || body.assigneeId === "" ? null : clean(body.assigneeId, 160);
      if (assigneeId) {
        const staff = await getStaffMember(assigneeId);
        if (staff.sandbox || !staff.name) {
          res.status(400).json({ error: "Assignee is not eligible" });
          return;
        }
        assigneeName = staff.name;
      } else assigneeName = null;
    }
    const patch = {
      ...(status ? { status } : {}),
      ...(assigneeId !== undefined ? { assigneeId, assigneeName } : {}),
      ...(body.deferReason !== undefined ? { deferReason: clean(body.deferReason, 2000) } : {}),
      ...(body.resolutionNote !== undefined ? { resolutionNote: clean(body.resolutionNote, 2000) } : {}),
      updatedAt: new Date(),
      version: sql`${actionItemsTable.version} + 1`,
    };
    const updated = await db.update(actionItemsTable).set(patch).where(and(
      eq(actionItemsTable.id, id), eq(actionItemsTable.scope, scope),
      eq(actionItemsTable.version, version),
    )).returning();
    if (!updated[0]) {
      res.status(409).json({ error: "This action item changed; refresh and try again." });
      return;
    }
    await db.insert(auditLogsTable).values({
      scope, actor: actor.name ?? req.userId!, action: "manager_action_item_update",
      resource: `action_item:${id}`,
      changes: { status, assigneeId, deferReason: body.deferReason !== undefined, resolutionNote: body.resolutionNote !== undefined },
      ipAddress: req.ip, userAgent: req.get("user-agent") ?? undefined,
    });
    res.json({ item: updated[0] });
  } catch (err) {
    req.log.error({ err }, "failed to update manager action item");
    res.status(500).json({ error: "Failed to update manager action item" });
  }
});

export default router;