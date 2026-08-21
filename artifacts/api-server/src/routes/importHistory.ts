import { Router, type IRouter, type Request, type Response } from "express";
import { and, desc, eq, ilike } from "drizzle-orm";
import { db, importHistoryTable, type ImportHistoryRow } from "@workspace/db";
import { currentScope } from "../lib/requestScope";
import { requireCapability } from "../middlewares/requireCapability";

const router: IRouter = Router();
const MAX_ROWS = 100;
const MAX_TEXT = 300;

type ImportHistorySummary = {
  phases?: Record<string, string>;
  counts?: Record<string, number>;
  warnings?: string[];
  unresolved?: string[];
  skipped?: string[];
  followUp?: string[];
  snapshotId?: number | null;
};

function cleanList(value: unknown, max = 30): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((v) => String(v ?? "").trim().slice(0, MAX_TEXT)).filter(Boolean).slice(0, max);
}

function sanitizeSummary(raw: unknown): ImportHistorySummary {
  const o = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const phasesRaw = o.phases && typeof o.phases === "object" ? o.phases as Record<string, unknown> : {};
  const countsRaw = o.counts && typeof o.counts === "object" ? o.counts as Record<string, unknown> : {};
  const phases: Record<string, string> = {};
  for (const [k, v] of Object.entries(phasesRaw).slice(0, 20)) phases[k.slice(0, 60)] = String(v).slice(0, 40);
  const counts: Record<string, number> = {};
  for (const [k, v] of Object.entries(countsRaw).slice(0, 30)) {
    const n = Number(v);
    if (Number.isFinite(n) && n >= 0) counts[k.slice(0, 60)] = Math.min(Math.floor(n), 1000000);
  }
  return {
    phases,
    counts,
    warnings: cleanList(o.warnings),
    unresolved: cleanList(o.unresolved),
    skipped: cleanList(o.skipped),
    followUp: cleanList(o.followUp),
    snapshotId: Number.isInteger(o.snapshotId) ? Number(o.snapshotId) : null,
  };
}

function toApi(row: ImportHistoryRow) {
  return {
    id: row.id,
    importType: row.importType,
    sourceKey: row.sourceKey,
    sourceLabel: row.sourceLabel,
    customerScope: row.customerScope,
    status: row.status,
    summary: row.summary,
    snapshotId: row.snapshotId ? Number(row.snapshotId) : null,
    createdAt: row.createdAt.getTime(),
  };
}

router.get("/import-history", requireCapability("manage-profiles"), async (req: Request, res: Response) => {
  try {
    const type = String(req.query.type ?? "").trim();
    const status = String(req.query.status ?? "").trim();
    const customer = String(req.query.customer ?? "").trim();
    const clauses = [eq(importHistoryTable.scope, currentScope())];
    if (type) clauses.push(eq(importHistoryTable.importType, type));
    if (status) clauses.push(eq(importHistoryTable.status, status));
    if (customer) clauses.push(ilike(importHistoryTable.customerScope, `%${customer.slice(0, 80)}%`));
    const rows = await db.select().from(importHistoryTable)
      .where(and(...clauses))
      .orderBy(desc(importHistoryTable.createdAt), desc(importHistoryTable.id))
      .limit(MAX_ROWS);
    res.json({ imports: rows.map(toApi) });
  } catch (err) {
    req.log.error({ err }, "failed to list import history");
    res.status(500).json({ error: "Failed to list import history" });
  }
});

router.post("/import-history", requireCapability("manage-profiles"), async (req: Request, res: Response) => {
  const body = req.body && typeof req.body === "object" ? req.body as Record<string, unknown> : {};
  const importType = String(body.importType ?? "").trim();
  const sourceLabel = String(body.sourceLabel ?? "").trim().slice(0, MAX_TEXT);
  const status = String(body.status ?? "").trim();
  if (!["spec", "premix"].includes(importType) || !sourceLabel || !["complete", "partial", "failed"].includes(status)) {
    res.status(400).json({ error: "Invalid import history record" });
    return;
  }
  try {
    const summary = sanitizeSummary(body.summary);
    const inserted = await db.insert(importHistoryTable).values({
      scope: currentScope(),
      importType,
      sourceKey: String(body.sourceKey ?? "").trim().slice(0, MAX_TEXT) || null,
      sourceLabel,
      customerScope: String(body.customerScope ?? "").trim().slice(0, MAX_TEXT) || null,
      status,
      summary,
      snapshotId: summary.snapshotId ? String(summary.snapshotId) : null,
    }).returning();
    // Keep the history bounded per scope; snapshots retain their separate policy.
    const old = await db.select({ id: importHistoryTable.id }).from(importHistoryTable)
      .where(eq(importHistoryTable.scope, currentScope()))
      .orderBy(desc(importHistoryTable.createdAt), desc(importHistoryTable.id));
    for (const row of old.slice(MAX_ROWS)) {
      await db.delete(importHistoryTable).where(and(eq(importHistoryTable.scope, currentScope()), eq(importHistoryTable.id, row.id)));
    }
    res.status(201).json({ import: toApi(inserted[0]) });
  } catch (err) {
    req.log.error({ err }, "failed to save import history");
    res.status(500).json({ error: "Failed to save import history" });
  }
});

export default router;