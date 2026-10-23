import { Router, type IRouter, type Request, type Response } from "express";
import { and, desc, eq, ilike, inArray, isNull } from "drizzle-orm";
import { db, importHistoryTable, savedSpecSheetsTable, type ImportHistoryRow } from "@workspace/db";
import { currentScope } from "../lib/requestScope";
import { requireAnyCapability } from "../middlewares/requireCapability";
import { validateImportAppliedValues } from "@workspace/spec-import/import-applied-values";
import type { ImportSnapshot } from "@workspace/spec-import/import-changes";

const router: IRouter = Router();
const MAX_ROWS = 100;
const MAX_TEXT = 300;
const PROFILE_IMPORT_TYPES = ["spec", "sauce", "dough", "schedule", "shipping", "recipe"] as const;
const INVENTORY_IMPORT_TYPES = ["premix", "cheese"] as const;

function allowedImportHistoryTypes(req: Request): string[] {
  const capabilities = req.capabilities ?? [];
  return [
    ...(capabilities.includes("manage-profiles") ? PROFILE_IMPORT_TYPES : []),
    ...(capabilities.includes("manage-inventory") ? INVENTORY_IMPORT_TYPES : []),
  ];
}

type ImportHistorySummary = {
  appliedValues?: ImportSnapshot;
  persistence?: "local-verified" | "sync-acknowledged";
  phases?: Record<string, string>;
  counts?: Record<string, number>;
  source?: Record<string, number>;
  landed?: Record<string, number>;
  components?: Record<string, number>;
  links?: Record<string, number>;
  mismatches?: string[];
  warnings?: string[];
  unresolved?: string[];
  skipped?: string[];
  followUp?: string[];
  changes?: Array<{ kind: string; entity: string; message: string }>;
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
  const metric = (value: unknown) => {
    const input = value && typeof value === "object" ? value as Record<string, unknown> : {};
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(input).slice(0, 30)) {
      const n = Number(v);
      if (Number.isFinite(n) && n >= 0) out[k.slice(0, 60)] = Math.min(Math.floor(n), 1000000);
    }
    return out;
  };
  const changes = (Array.isArray(o.changes) ? o.changes : [])
    .slice(0, 100)
    .flatMap((value) => {
      if (!value || typeof value !== "object") return [];
      const change = value as Record<string, unknown>;
      const kind = String(change.kind ?? "").trim().slice(0, 60);
      const entity = String(change.entity ?? "").trim().slice(0, MAX_TEXT);
      const message = String(change.message ?? "").trim().slice(0, MAX_TEXT);
      return kind && entity && message ? [{ kind, entity, message }] : [];
    });
  return {
    ...(validateImportAppliedValues(o.appliedValues) && ["local-verified", "sync-acknowledged"].includes(String(o.persistence))
      ? { appliedValues: validateImportAppliedValues(o.appliedValues)!, persistence: o.persistence as "local-verified" | "sync-acknowledged" } : {}),
    phases,
    counts,
    source: metric(o.source),
    landed: metric(o.landed),
    components: metric(o.components),
    links: metric(o.links),
    mismatches: cleanList(o.mismatches),
    warnings: cleanList(o.warnings),
    unresolved: cleanList(o.unresolved),
    skipped: cleanList(o.skipped),
    followUp: cleanList(o.followUp),
    ...(changes.length ? { changes } : {}),
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
    operationId: row.operationId,
    createdAt: row.createdAt.getTime(),
  };
}

async function ownsSpecSnapshot(snapshotId: number, sourceKey: string | null): Promise<boolean> {
  if (!Number.isSafeInteger(snapshotId) || snapshotId <= 0) return false;
  const [snapshot] = await db.select({ sourceKey: savedSpecSheetsTable.sourceKey })
    .from(savedSpecSheetsTable)
    .where(and(
      eq(savedSpecSheetsTable.scope, currentScope()),
      eq(savedSpecSheetsTable.id, snapshotId),
    ))
    .limit(1);
  return Boolean(snapshot && snapshot.sourceKey === sourceKey);
}

async function attachSnapshotToExistingSpecImport(
  existing: ImportHistoryRow,
  values: {
    importType: string;
    sourceKey: string | null;
    snapshotId: string | null;
  },
): Promise<ImportHistoryRow> {
  if (
    existing.importType !== "spec" ||
    values.importType !== "spec" ||
    existing.sourceKey !== values.sourceKey ||
    existing.snapshotId !== null ||
    values.snapshotId === null
  ) return existing;

  const snapshotId = Number(values.snapshotId);
  if (!await ownsSpecSnapshot(snapshotId, values.sourceKey)) return existing;

  const [updated] = await db.update(importHistoryTable)
    .set({ snapshotId: String(snapshotId) })
    .where(and(
      eq(importHistoryTable.id, existing.id),
      eq(importHistoryTable.scope, currentScope()),
      eq(importHistoryTable.actorId, existing.actorId!),
      isNull(importHistoryTable.snapshotId),
    ))
    .returning();
  if (updated) return updated;
  const [latest] = await db.select().from(importHistoryTable)
    .where(and(
      eq(importHistoryTable.id, existing.id),
      eq(importHistoryTable.scope, currentScope()),
      eq(importHistoryTable.actorId, existing.actorId!),
    ))
    .limit(1);
  return latest ?? existing;
}

router.get("/import-history", requireAnyCapability(["manage-profiles", "manage-inventory"]), async (req: Request, res: Response) => {
  try {
    const type = String(req.query.type ?? "").trim();
    const status = String(req.query.status ?? "").trim();
    const customer = String(req.query.customer ?? "").trim();
    const sourceKey = req.query.sourceKey;
    if (sourceKey !== undefined && (typeof sourceKey !== "string" || sourceKey.length > MAX_TEXT || !sourceKey.trim())) {
      res.status(400).json({ error: "Invalid source identity" }); return;
    }
    const clauses = [eq(importHistoryTable.scope, currentScope())];
    const allowedTypes = allowedImportHistoryTypes(req);
    if (allowedTypes.length === 0) {
      res.status(403).json({ error: "Missing importer audit capability" });
      return;
    }
    if (type && !allowedTypes.includes(type)) {
      res.status(403).json({ error: "Missing capability for this importer history" });
      return;
    }
    clauses.push(inArray(importHistoryTable.importType, allowedTypes));
    if (type) clauses.push(eq(importHistoryTable.importType, type));
    if (status) clauses.push(eq(importHistoryTable.status, status));
    if (typeof sourceKey === "string") clauses.push(eq(importHistoryTable.sourceKey, sourceKey));
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

router.post("/import-history", requireAnyCapability(["manage-profiles", "manage-inventory"]), async (req: Request, res: Response) => {
  const body = req.body && typeof req.body === "object" ? req.body as Record<string, unknown> : {};
  const importType = String(body.importType ?? "").trim();
  const sourceLabel = String(body.sourceLabel ?? "").trim().slice(0, MAX_TEXT);
  const status = String(body.status ?? "").trim();
  const operationId = String(body.operationId ?? "").trim();
  if (!["spec", "premix", "cheese", "sauce", "dough", "schedule", "shipping", "recipe"].includes(importType) || !sourceLabel || !["complete", "partial", "failed"].includes(status)) {
    res.status(400).json({ error: "Invalid import history record" });
    return;
  }
  if (!allowedImportHistoryTypes(req).includes(importType)) {
    res.status(403).json({ error: "Missing capability for this importer history" });
    return;
  }
  if (!operationId || !/^[a-zA-Z0-9_-]{16,120}$/.test(operationId)) {
    res.status(400).json({ error: "Invalid import history operation id" });
    return;
  }
  try {
    const summary = sanitizeSummary(body.summary);
    const sourceKey = String(body.sourceKey ?? "").trim().slice(0, MAX_TEXT) || null;
    const requestedSnapshotId = summary.snapshotId;
    const snapshotId = importType === "spec" &&
      requestedSnapshotId != null &&
      await ownsSpecSnapshot(requestedSnapshotId, sourceKey)
      ? String(requestedSnapshotId)
      : null;
    const values = {
      scope: currentScope(),
      importType,
      sourceKey,
      sourceLabel,
      customerScope: String(body.customerScope ?? "").trim().slice(0, MAX_TEXT) || null,
      status,
      summary,
      snapshotId,
      operationId,
      actorId: req.userId,
    };
    // The client may retry after a transport timeout where the first write
    // actually committed. Scope + authenticated actor + operation id make that
    // retry return the original audit row rather than duplicating it.
    if (req.userId) {
      const existing = await db.select().from(importHistoryTable).where(and(
        eq(importHistoryTable.scope, currentScope()),
        eq(importHistoryTable.actorId, req.userId),
        eq(importHistoryTable.operationId, operationId),
      )).limit(1);
      if (existing[0]) {
        const row = await attachSnapshotToExistingSpecImport(existing[0], values);
        res.status(201).json({ import: toApi(row) });
        return;
      }
    }
    const inserted = await db.insert(importHistoryTable).values(values)
      .onConflictDoNothing({
        target: [importHistoryTable.scope, importHistoryTable.actorId, importHistoryTable.operationId],
      })
      .returning();
    if (!inserted[0] && req.userId) {
      const existing = await db.select().from(importHistoryTable).where(and(
        eq(importHistoryTable.scope, currentScope()),
        eq(importHistoryTable.actorId, req.userId),
        eq(importHistoryTable.operationId, operationId),
      )).limit(1);
      if (existing[0]) {
        const row = await attachSnapshotToExistingSpecImport(existing[0], values);
        res.status(201).json({ import: toApi(row) });
        return;
      }
    }
    if (!inserted[0]) throw new Error("Import history record was not inserted");
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