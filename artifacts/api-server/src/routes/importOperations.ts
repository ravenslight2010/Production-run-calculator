import { createHash } from "node:crypto";
import { Router, type IRouter, type Request, type Response } from "express";
import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import {
  db,
  importHistoryTable,
  importOperationsTable,
  mixesTable,
  cheeseRecipesTable,
  doughRecipesTable,
  sauceRecipesTable,
  brandProfilesTable,
  freezerPullItemsTable,
  specImportAliasesTable,
} from "@workspace/db";
import { currentScope } from "../lib/requestScope";
import { requireAnyCapability } from "../middlewares/requireCapability";
import { normalizeMix } from "@workspace/mixes";
import { normalizeCheeseRecipe } from "@workspace/cheese-recipes";
import { normalizeNamedRecipe } from "@workspace/named-recipes";
import { normalizeFreezerPullItem } from "@workspace/freezer-pull";
import { broadcastMasterDataChanged } from "./sync";

const router: IRouter = Router();
const MAX_ROWS = 500;
const MAX_BODY = 512 * 1024;
const TABLES = {
  mixes: { table: mixesTable, key: "id" },
  cheeseRecipes: { table: cheeseRecipesTable, key: "id" },
  doughRecipes: { table: doughRecipesTable, key: "id" },
  sauceRecipes: { table: sauceRecipesTable, key: "id" },
  brandProfiles: { table: brandProfilesTable, key: "key" },
  freezerPullItems: { table: freezerPullItemsTable, key: "id" },
} as const;
type EntityName = keyof typeof TABLES;
type ChangeSet = Partial<Record<EntityName, { upsert?: unknown[]; delete?: string[] }>> & {
  specImportAliases?: { upsert?: unknown[]; delete?: unknown[] };
};

let failureHook: ((stage: string) => void) | undefined;
/** Test-only failure injection. The hook is never configured by production code. */
export function setImportOperationFailureHookForTest(hook?: (stage: string) => void): void {
  failureHook = hook;
}
function fail(stage: string): void {
  failureHook?.(stage);
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).sort().join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
function hash(value: unknown): string {
  return createHash("sha256").update(stable(value)).digest("hex");
}
function jsonSafe<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
function objectBody(req: Request): Record<string, unknown> | null {
  if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) return null;
  if (Buffer.byteLength(JSON.stringify(req.body)) > MAX_BODY) return null;
  return req.body as Record<string, unknown>;
}
function rows(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, MAX_ROWS).filter((row): row is Record<string, unknown> =>
    !!row && typeof row === "object" && !Array.isArray(row));
}
function validateChangeLimits(changes: ChangeSet): string | null {
  for (const [name, change] of Object.entries(changes)) {
    if (!change || typeof change !== "object") continue;
    const upsert = Array.isArray((change as any).upsert) ? (change as any).upsert : [];
    const deleted = Array.isArray((change as any).delete) ? (change as any).delete : [];
    if (upsert.length > MAX_ROWS || deleted.length > MAX_ROWS) return `Too many ${name} changes`;
  }
  return null;
}
function ids(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, MAX_ROWS).map((v) => String(v ?? "").trim()).filter(Boolean);
}
function capability(importType: string): "manage-profiles" | "manage-inventory" {
  return ["premix", "cheese"].includes(importType) ? "manage-inventory" : "manage-profiles";
}
function requireOperationCapability(req: Request, res: Response, importType: string): boolean {
  const needed = capability(importType);
  if (!(req.capabilities ?? []).includes(needed)) {
    res.status(403).json({ error: `Missing capability: ${needed}` });
    return false;
  }
  return true;
}
function aliasKey(value: unknown): { kind: string; externalName: string; context: string | null } | null {
  if (typeof value === "string") {
    const [kind, externalName, context = ""] = value.split("\u0000");
    return kind && externalName ? { kind, externalName, context: context || null } : null;
  }
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const kind = String(row.kind ?? "").trim();
  const externalName = String(row.externalName ?? "").trim();
  if (!kind || !externalName) return null;
  return { kind, externalName, context: row.context == null ? null : String(row.context).trim() || null };
}
function aliasChanges(change: ChangeSet["specImportAliases"]): Array<{ kind: string; externalName: string; context: string | null }> {
  return [
    ...rows(change?.upsert).map(aliasKey),
    ...(Array.isArray(change?.delete) ? change!.delete!.slice(0, MAX_ROWS).map(aliasKey) : []),
  ].filter((entry): entry is { kind: string; externalName: string; context: string | null } => !!entry);
}

async function capture(tx: any, changes: ChangeSet, scope: string): Promise<Record<string, unknown[]>> {
  const result: Record<string, unknown[]> = {};
  for (const [name, config] of Object.entries(TABLES) as [EntityName, typeof TABLES[EntityName]][]) {
    const change = changes[name];
    if (!change) continue;
    const keys = [...new Set([
      ...rows(change.upsert).map((r) => String(r[config.key] ?? "")),
      ...ids(change.delete),
    ].filter(Boolean))];
    if (!keys.length) continue;
    const column = (config.table as any)[config.key];
    result[name] = jsonSafe(await tx.select().from(config.table)
      .where(and(eq((config.table as any).scope, scope), inArray(column, keys))));
  }
  if (changes.specImportAliases) {
    const keys = aliasChanges(changes.specImportAliases);
    result.specImportAliasKeys = keys as unknown[];
    const predicates = keys.map((key) => and(
      eq(specImportAliasesTable.kind, key.kind),
      eq(specImportAliasesTable.externalName, key.externalName),
      key.context === null ? sql`${specImportAliasesTable.context} IS NULL` : eq(specImportAliasesTable.context, key.context),
    ));
    result.specImportAliases = predicates.length
      ? jsonSafe(await tx.select().from(specImportAliasesTable).where(and(eq(specImportAliasesTable.scope, scope), or(...predicates))))
      : [];
  }
  return result;
}

async function captureSnapshotRows(
  tx: any,
  snapshot: Record<string, unknown[]>,
  scope: string,
  identitySnapshot: Record<string, unknown[]> = snapshot,
): Promise<Record<string, unknown[]>> {
  const result: Record<string, unknown[]> = {};
  for (const [name, config] of Object.entries(TABLES) as [EntityName, typeof TABLES[EntityName]][]) {
    const saved = snapshot[name] ?? [];
    const keys = [...new Set([
      ...saved.map((row: any) => String(row[config.key])),
      ...(identitySnapshot[name] ?? []).map((row: any) => String(row[config.key])),
    ].filter(Boolean))];
    if (!keys.length) continue;
    result[name] = jsonSafe(await tx.select().from(config.table).where(and(
      eq((config.table as any).scope, scope),
      inArray((config.table as any)[config.key], keys),
    )));
  }
  if (
    snapshot.specImportAliasKeys || snapshot.specImportAliases ||
    identitySnapshot.specImportAliasKeys || identitySnapshot.specImportAliases
  ) {
    const keys = [
      ...(snapshot.specImportAliasKeys ?? snapshot.specImportAliases ?? []),
      ...(identitySnapshot.specImportAliasKeys ?? identitySnapshot.specImportAliases ?? []),
    ]
      .map((row: any) => aliasKey(row)).filter(Boolean) as Array<{ kind: string; externalName: string; context: string | null }>;
    const uniqueKeys = [...new Map(keys.map((key) => [
      `${key.kind}\u0000${key.externalName}\u0000${key.context ?? ""}`,
      key,
    ])).values()];
    result.specImportAliasKeys = uniqueKeys as unknown[];
    const predicates = uniqueKeys.map((key) => and(
      eq(specImportAliasesTable.kind, key.kind),
      eq(specImportAliasesTable.externalName, key.externalName),
      key.context === null ? sql`${specImportAliasesTable.context} IS NULL` : eq(specImportAliasesTable.context, key.context),
    ));
    result.specImportAliases = predicates.length
      ? jsonSafe(await tx.select().from(specImportAliasesTable).where(and(eq(specImportAliasesTable.scope, scope), or(...predicates))))
      : [];
  }
  return result;
}

async function applyRows(tx: any, changes: ChangeSet, scope: string): Promise<void> {
  for (const [name, config] of Object.entries(TABLES) as [EntityName, typeof TABLES[EntityName]][]) {
    const change = changes[name];
    if (!change) continue;
    const table: any = config.table;
    const keyColumn = table[config.key];
    const existing = await tx.select().from(table).where(eq(table.scope, scope)).for("update");
    const existingByKey = new Map<string, any>(existing.map((row: any) => [String(row[config.key]), row]));
    for (const raw of rows(change.upsert)) {
      const normalized = name === "mixes"
        ? normalizeMix(raw)
        : name === "cheeseRecipes"
          ? normalizeCheeseRecipe(raw)
          : name === "freezerPullItems"
            ? normalizeFreezerPullItem(raw)
            : name === "doughRecipes" || name === "sauceRecipes"
              ? normalizeNamedRecipe(raw)
              : raw;
      if (!normalized || typeof normalized !== "object") throw new Error(`Invalid ${name} entity`);
      const key = String((normalized as Record<string, unknown>)[config.key] ?? "").trim();
      if (!key || key.length > 300) throw new Error(`Invalid ${name} identity`);
      const prior = existingByKey.get(key);
      const forceProfile = name === "brandProfiles" && raw.force === true;
      if (prior && (normalized as any).updatedAt != null) {
        const incoming = new Date(String((normalized as any).updatedAt)).getTime();
        if (!Number.isFinite(incoming) || incoming < new Date(prior.updatedAt).getTime()) {
          const error = new Error(`Stale ${name} revision`);
          (error as any).code = "STALE_IMPORT";
          throw error;
        }
      }
      if (
        prior && !forceProfile &&
        (normalized as any).updatedAtMs != null &&
        Number((normalized as any).updatedAtMs) < Number(prior.updatedAtMs)
      ) {
        const error = new Error(`Stale ${name} revision`);
        (error as any).code = "STALE_IMPORT";
        throw error;
      }
      const values: Record<string, unknown> = { ...(normalized as Record<string, unknown>), scope };
      delete values.createdAt;
      delete values.updatedAt;
      delete values.force;
      // Database timestamps are server-owned; this also prevents a reviewed
      // payload from moving a revision backwards.
      if ("updatedAt" in table) values.updatedAt = new Date();
      if ("updatedAtMs" in table && raw.updatedAtMs != null) {
        const incomingStamp = Number(raw.updatedAtMs);
        values.updatedAtMs = forceProfile && prior
          ? Math.max(Number(prior.updatedAtMs) + 1, incomingStamp)
          : incomingStamp;
      }
      const insert = tx.insert(table).values(values);
      const set: Record<string, unknown> = { ...values };
      delete set[config.key];
      delete set.scope;
      delete set.createdAt;
      await insert.onConflictDoUpdate({ target: [keyColumn, table.scope], set });
    }
    const deleted = ids(change.delete);
    if (deleted.length) await tx.delete(table).where(and(eq(table.scope, scope), inArray(keyColumn, deleted)));
    fail(`after-${name}`);
  }
  const aliases = changes.specImportAliases;
  if (aliases) {
    for (const raw of rows(aliases.upsert)) {
      const kind = String(raw.kind ?? "").trim();
      const externalName = String(raw.externalName ?? "").trim().slice(0, 200);
      const canonicalName = String(raw.canonicalName ?? "").trim().slice(0, 200);
      if (!kind || !externalName || !canonicalName) throw new Error("Invalid spec alias");
      const context = raw.context == null ? null : String(raw.context).trim().slice(0, 200) || null;
      const existing = await tx.select().from(specImportAliasesTable).where(and(
        eq(specImportAliasesTable.scope, scope),
        eq(specImportAliasesTable.kind, kind),
        eq(specImportAliasesTable.externalName, externalName),
        context === null ? sql`${specImportAliasesTable.context} IS NULL` : eq(specImportAliasesTable.context, context),
      )).limit(1);
      if (existing[0]) {
        await tx.update(specImportAliasesTable).set({ canonicalName, updatedAt: new Date() })
          .where(eq(specImportAliasesTable.id, existing[0].id));
      } else {
        await tx.insert(specImportAliasesTable).values({ scope, kind, externalName, canonicalName, context });
      }
    }
    const deleteKeys = (Array.isArray(aliases.delete) ? aliases.delete : [])
      .slice(0, MAX_ROWS).map(aliasKey).filter(Boolean) as Array<{ kind: string; externalName: string; context: string | null }>;
    for (const key of deleteKeys) {
      await tx.delete(specImportAliasesTable).where(and(
        eq(specImportAliasesTable.scope, scope),
        eq(specImportAliasesTable.kind, key.kind),
        eq(specImportAliasesTable.externalName, key.externalName),
        key.context === null ? sql`${specImportAliasesTable.context} IS NULL` : eq(specImportAliasesTable.context, key.context),
      ));
    }
    fail("after-specImportAliases");
  }
}

async function restore(tx: any, snapshot: Record<string, unknown[]>, after: Record<string, unknown[]>, scope: string): Promise<void> {
  for (const [name, config] of Object.entries(TABLES) as [EntityName, typeof TABLES[EntityName]][]) {
    const saved = snapshot[name] ?? [];
    const table: any = config.table;
    const keys = [...new Set([
      ...saved.map((row: any) => String(row[config.key])),
      ...(after[name] ?? []).map((row: any) => String(row[config.key])),
    ])];
    if (keys.length) await tx.delete(table).where(and(eq(table.scope, scope), inArray(table[config.key], keys)));
    for (const row of saved) {
      const value: Record<string, unknown> = { ...(row as Record<string, unknown>), scope };
      if (typeof value.createdAt === "string") value.createdAt = new Date(value.createdAt);
      if (typeof value.updatedAt === "string") value.updatedAt = new Date(value.updatedAt);
      await tx.insert(table).values(value);
    }
  }
  if (snapshot.specImportAliasKeys || snapshot.specImportAliases || after.specImportAliasKeys || after.specImportAliases) {
    const keys = [
      ...(snapshot.specImportAliasKeys ?? snapshot.specImportAliases ?? []),
      ...(after.specImportAliasKeys ?? after.specImportAliases ?? []),
    ].map((row: any) => aliasKey(row)).filter(Boolean) as Array<{ kind: string; externalName: string; context: string | null }>;
    const predicates = keys.map((key) => and(
      eq(specImportAliasesTable.kind, key.kind),
      eq(specImportAliasesTable.externalName, key.externalName),
      key.context === null ? sql`${specImportAliasesTable.context} IS NULL` : eq(specImportAliasesTable.context, key.context),
    ));
    if (predicates.length) {
      await tx.delete(specImportAliasesTable).where(and(
        eq(specImportAliasesTable.scope, scope),
        or(...predicates),
      ));
    }
    for (const row of snapshot.specImportAliases ?? []) {
      const value: Record<string, unknown> = { ...(row as Record<string, unknown>), scope };
      delete value.id;
      if (typeof value.createdAt === "string") value.createdAt = new Date(value.createdAt);
      if (typeof value.updatedAt === "string") value.updatedAt = new Date(value.updatedAt);
      await tx.insert(specImportAliasesTable).values(value);
    }
  }
}

function operationApi(row: any) {
  return {
    operationId: row.id, importType: row.importType, sourceKey: row.sourceKey,
    sourceLabel: row.sourceLabel, status: row.status, requestHash: row.requestHash,
    resultHash: row.resultHash, affectedEntities: row.affectedEntities,
    result: row.result, createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(), undoneAt: row.undoneAt?.getTime() ?? null,
  };
}

router.post("/import-operations/:operationId/apply", requireAnyCapability(["manage-profiles", "manage-inventory"]), async (req: Request, res: Response) => {
  const body = objectBody(req);
  const operationId = String(req.params.operationId ?? "").trim();
  if (!body || !/^[A-Za-z0-9_-]{16,120}$/.test(operationId)) {
    res.status(400).json({ error: "Invalid import operation request" }); return;
  }
  const importType = String(body.importType ?? "").trim();
  if (!importType || !body.changes || typeof body.changes !== "object") {
    res.status(400).json({ error: "Invalid import operation request" }); return;
  }
  const changes = body.changes as ChangeSet;
  const allowed = new Set(Object.keys(TABLES).concat("specImportAliases"));
  if (Object.keys(changes).some((key) => !allowed.has(key))) {
    res.status(400).json({ error: "Unsupported import entity" }); return;
  }
  const limitError = validateChangeLimits(changes);
  if (limitError) { res.status(400).json({ error: limitError }); return; }
  const requestHash = hash({ ...body, requestHash: undefined });
  const expectedRequestHash = body.requestHash == null ? null : String(body.requestHash);
  if (expectedRequestHash && expectedRequestHash !== requestHash) {
    res.status(409).json({ error: "IMPORT_REQUEST_CHANGED" }); return;
  }
  const scope = currentScope();
  const required = capability(importType);
  const capabilities = req.capabilities ?? [];
  if (!capabilities.includes(required)) {
    res.status(403).json({ error: `Missing capability: ${required}` }); return;
  }
  try {
    const operation = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${"import-operation:" + scope}, 0))`);
      const prior = await tx.select().from(importOperationsTable).where(and(
        eq(importOperationsTable.id, operationId), eq(importOperationsTable.scope, scope),
      )).limit(1);
      if (prior[0]) {
        if (prior[0].requestHash !== requestHash) {
          const error = new Error("IMPORT_REQUEST_CHANGED"); (error as any).code = "REQUEST_CHANGED"; throw error;
        }
        return prior[0];
      }
      const before = await capture(tx, changes, scope);
      fail("after-before-snapshot");
      const beforeHash = hash(before);
      if (body.expectedStateHash && String(body.expectedStateHash) !== beforeHash) {
        const error = new Error("STALE_REVIEWED_STATE"); (error as any).code = "STALE_REVIEW"; throw error;
      }
      await applyRows(tx, changes, scope);
      fail("after-domain-writes");
      const after = await capture(tx, changes, scope);
      const resultHash = hash(after);
      const result = { operationId, resultHash, affectedEntities: Object.fromEntries(
        Object.entries(after).map(([key, value]) => [key, value.length]),
      ) };
      const inserted = await tx.insert(importOperationsTable).values({
        id: operationId, scope, importType,
        sourceKey: body.sourceKey ? String(body.sourceKey).slice(0, 300) : null,
        sourceLabel: String(body.sourceLabel ?? "Import").slice(0, 300),
        actorId: req.userId ?? null, requestHash,
        expectedStateHash: body.expectedStateHash ? String(body.expectedStateHash) : beforeHash,
        resultHash, status: "applied", beforeSnapshot: before, afterSnapshot: after,
        affectedEntities: result.affectedEntities, result,
      }).returning();
      await tx.insert(importHistoryTable).values({
        scope, importType, sourceKey: body.sourceKey ? String(body.sourceKey).slice(0, 300) : null,
        sourceLabel: String(body.sourceLabel ?? "Import").slice(0, 300),
        customerScope: null, status: "complete", summary: result,
        snapshotId: null, operationId, actorId: req.userId ?? null,
      });
      fail("after-history");
      return inserted[0];
    });
    if (changes.brandProfiles) {
      broadcastMasterDataChanged(req.header("x-client-id") ?? "", scope, "profiles");
    }
    if (
      changes.mixes || changes.cheeseRecipes || changes.doughRecipes ||
      changes.sauceRecipes || changes.freezerPullItems
    ) {
      broadcastMasterDataChanged(req.header("x-client-id") ?? "", scope, "master-data");
    }
    if (changes.specImportAliases) {
      broadcastMasterDataChanged(req.header("x-client-id") ?? "", scope, "name-links");
    }
    res.json({ operation: operationApi(operation) });
  } catch (err: any) {
    if (err?.code === "STALE_REVIEW") { res.status(409).json({ error: "STALE_REVIEWED_STATE" }); return; }
    if (err?.code === "REQUEST_CHANGED") { res.status(409).json({ error: "IMPORT_REQUEST_CHANGED" }); return; }
    if (err?.code === "STALE_IMPORT") { res.status(409).json({ error: "STALE_IMPORT_REVISION" }); return; }
    req.log.error({ err, operationId }, "atomic import apply failed");
    res.status(500).json({ error: "Import apply failed; no changes were committed" });
  }
});

router.get("/import-operations/:operationId", requireAnyCapability(["manage-profiles", "manage-inventory"]), async (req, res) => {
  const row = await db.select().from(importOperationsTable).where(and(
    eq(importOperationsTable.id, String(req.params.operationId)), eq(importOperationsTable.scope, currentScope()),
  )).limit(1);
  if (!row[0]) { res.status(404).json({ error: "Import operation not found" }); return; }
  if (!requireOperationCapability(req, res, row[0].importType)) return;
  res.json({ operation: operationApi(row[0]) });
});

router.post("/import-operations/:operationId/undo", requireAnyCapability(["manage-profiles", "manage-inventory"]), async (req, res) => {
  const id = String(req.params.operationId);
  try {
    const undone = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${"import-operation:" + currentScope()}, 0))`);
      const found = await tx.select().from(importOperationsTable).where(and(
        eq(importOperationsTable.id, id), eq(importOperationsTable.scope, currentScope()),
      )).limit(1);
      if (!found[0]) { const e = new Error("NOT_FOUND"); (e as any).code = "NOT_FOUND"; throw e; }
      const op = found[0];
      if (!(req.capabilities ?? []).includes(capability(op.importType))) {
        const e = new Error("FORBIDDEN"); (e as any).code = "FORBIDDEN"; throw e;
      }
      if (op.status === "undone") return op;
      if (op.status !== "applied") { const e = new Error("NOT_UNDOABLE"); (e as any).code = "NOT_UNDOABLE"; throw e; }
      if (req.body?.expectedResultHash && String(req.body.expectedResultHash) !== op.resultHash) {
        const e = new Error("RESULT_CHANGED"); (e as any).code = "RESULT_CHANGED"; throw e;
      }
      const current = await captureSnapshotRows(
        tx,
        op.afterSnapshot as Record<string, unknown[]>,
        currentScope(),
        op.beforeSnapshot as Record<string, unknown[]>,
      );
      if (hash(current) !== op.resultHash) { const e = new Error("IMPORT_CHANGED"); (e as any).code = "IMPORT_CHANGED"; throw e; }
      await restore(
        tx,
        op.beforeSnapshot as Record<string, unknown[]>,
        op.afterSnapshot as Record<string, unknown[]>,
        currentScope(),
      );
      const updated = await tx.update(importOperationsTable).set({
        status: "undone", undoneAt: new Date(), undoneBy: req.userId ?? null, updatedAt: new Date(),
      }).where(and(eq(importOperationsTable.id, id), eq(importOperationsTable.scope, currentScope()))).returning();
      return updated[0];
    });
    const before = undone.beforeSnapshot as Record<string, unknown[]> | undefined;
    const after = undone.afterSnapshot as Record<string, unknown[]> | undefined;
    if (before?.brandProfiles || after?.brandProfiles) {
      broadcastMasterDataChanged(req.header("x-client-id") ?? "", currentScope(), "profiles");
    }
    if (
      before?.mixes || after?.mixes || before?.cheeseRecipes || after?.cheeseRecipes ||
      before?.doughRecipes || after?.doughRecipes || before?.sauceRecipes || after?.sauceRecipes ||
      before?.freezerPullItems || after?.freezerPullItems
    ) {
      broadcastMasterDataChanged(req.header("x-client-id") ?? "", currentScope(), "master-data");
    }
    if (before?.specImportAliasKeys || after?.specImportAliasKeys) {
      broadcastMasterDataChanged(req.header("x-client-id") ?? "", currentScope(), "name-links");
    }
    res.json({ operation: operationApi(undone) });
  } catch (err: any) {
    if (err?.code === "NOT_FOUND") { res.status(404).json({ error: "Import operation not found" }); return; }
    if (err?.code === "FORBIDDEN") { res.status(403).json({ error: `Missing capability for this importer` }); return; }
    if (err?.code === "RESULT_CHANGED") { res.status(409).json({ error: "IMPORT_RESULT_HASH_MISMATCH" }); return; }
    if (err?.code === "IMPORT_CHANGED") { res.status(409).json({ error: "IMPORT_CHANGED_SINCE_APPLY" }); return; }
    if (err?.code === "NOT_UNDOABLE") { res.status(409).json({ error: "IMPORT_NOT_UNDOABLE" }); return; }
    req.log.error({ err, operationId: id }, "atomic import undo failed");
    res.status(500).json({ error: "Import undo failed; no changes were committed" });
  }
});

export default router;