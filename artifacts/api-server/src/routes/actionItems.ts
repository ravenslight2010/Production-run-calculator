import { Router, type Request, type Response } from "express";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
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

type Candidate = {
  dedupKey: string;
  category: string;
  severity: string;
  title: string;
  description: string;
  sourceType: string;
  sourceId: string;
  sourcePath: string;
};

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
  });
  for (const item of imports) out.push({
    dedupKey: `import:${item.id}`, category: "import",
    severity: item.status === "failed" ? "error" : "warning",
    title: `${item.importType === "spec" ? "Spec" : "Premix"} import needs review`,
    description: `${item.sourceLabel}${item.customerScope ? ` · ${item.customerScope}` : ""}`,
    sourceType: "import", sourceId: String(item.id), sourcePath: "#import-history",
  });
  for (const item of health.findings.filter((finding) => finding.severity !== "info")) out.push({
    dedupKey: `data-health:${item.id}`, category: "data-health", severity: item.severity,
    title: "Data health finding", description: item.message,
    sourceType: "data-health", sourceId: item.id, sourcePath: "#data-health",
  });
  for (const item of conflicts) out.push({
    dedupKey: `sync:${item.id}`, category: "sync",
    severity: item.conflictCount > 5 ? "error" : "warning",
    title: "Sync conflict needs review",
    description: `${item.conflictCount} conflicting field${item.conflictCount === 1 ? "" : "s"} on ${item.date}`,
    sourceType: "sync", sourceId: String(item.id), sourcePath: "#sync-diagnostics",
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
  for (const item of await candidates()) {
    await db.insert(actionItemsTable).values({ scope, ...item }).onConflictDoUpdate({
      target: [actionItemsTable.scope, actionItemsTable.dedupKey],
      set: { ...item, updatedAt: new Date() },
    });
  }
}

router.get("/manager-action-queue", requireCapability("manage-staff"), async (req: Request, res: Response) => {
  try {
    await refreshQueue();
    const rows = await db.select().from(actionItemsTable)
      .where(eq(actionItemsTable.scope, currentScope()))
      .orderBy(desc(actionItemsTable.status), desc(actionItemsTable.updatedAt), desc(actionItemsTable.id));
    res.json({
      items: rows,
      counts: Object.fromEntries(["open", "in_progress", "deferred", "resolved"]
        .map((status) => [status, rows.filter((row) => row.status === status).length])),
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