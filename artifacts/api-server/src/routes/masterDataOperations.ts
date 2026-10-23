import { Router, type Request, type Response } from "express";
import { and, desc, eq, lt } from "drizzle-orm";
import { db, masterDataOperationsTable } from "@workspace/db";
import { requireCapability, requireManagerRole } from "../middlewares/requireCapability";
import { currentActorId, currentScope } from "../lib/requestScope";
import { parseMasterDataCommand, MasterDataPlanError } from "../lib/masterDataPlan";
import { commitMasterDataOperation, previewMasterDataOperation, undoMasterDataOperation, MasterDataOperationConflict } from "../lib/masterDataOperations";
import { invalidateMasterDataBootstrapCache } from "./masterDataBootstrap";
import { broadcastMasterDataChanged } from "./sync";
import { assertMasterDataOperationActor, MasterDataOperationAuthorizationError } from "../lib/masterDataOperationAuthorization";

const router = Router();
const access = [requireCapability("manage-factory-settings"), requireManagerRole] as const;
type Operation = typeof masterDataOperationsTable.$inferSelect;
function view(record: Operation, includeReferences = false) {
  return {
    id: record.id, sequence: record.sequence, description: record.description,
    action: record.command.action, category: record.command.category,
    actorId: record.actorId, createdAt: record.createdAt.toISOString(),
    status: record.status === "applied" && record.conflictCount ? "conflicting" : record.status,
    eligible: record.status === "applied", unavailableReason: record.unavailableReason,
    affectedRecords: record.facts.length, affectedReferences: record.references.length,
    conflictCount: record.conflictCount, undoneBy: record.undoneBy,
    undoneAt: record.undoneAt?.toISOString() ?? null,
    ...(includeReferences ? { affectedRunReferences: record.references } : {}),
  };
}
function operationId(req: Request): string {
  const id = req.params.operationId;
  if (typeof id !== "string" || !/^[A-Za-z0-9_-]{8,120}$/u.test(id)) throw new MasterDataPlanError("Invalid operation ID.");
  return id;
}
function failure(error: unknown, res: Response): void {
  if (error instanceof MasterDataOperationAuthorizationError) { res.status(403).json({ error: error.message }); return; }
  if (error instanceof MasterDataPlanError) { res.status(400).json({ error: error.message }); return; }
  if (error instanceof MasterDataOperationConflict) { res.status(409).json({ error: error.message }); return; }
  // Never echo database payloads or retained fact contents to logs or callers.
  res.status(500).json({ error: "Shared history is unavailable. No success has been confirmed; reconnect and retry the same operation." });
}
function notify(scope: ReturnType<typeof currentScope>): void {
  invalidateMasterDataBootstrapCache(scope);
  for (const family of ["master-data", "profiles", "factory-data", "die-types"] as const) broadcastMasterDataChanged("", scope, family, true);
}

router.get("/master-data-operations", ...access, async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  try {
    if (Object.keys(req.query).some((key) => !["before", "limit"].includes(key))) throw new MasterDataPlanError("Unsupported history query.");
    const before = req.query.before === undefined ? undefined : Number(req.query.before);
    const limit = req.query.limit === undefined ? 20 : Number(req.query.limit);
    if ((before !== undefined && (!Number.isSafeInteger(before) || before < 1))
      || !Number.isSafeInteger(limit) || limit < 1 || limit > 50) throw new MasterDataPlanError("History pages must contain 1–50 entries and a valid cursor.");
    const rows = await db.transaction(async (tx) => {
      await assertMasterDataOperationActor(tx, currentScope(), false);
      return tx.select().from(masterDataOperationsTable).where(and(
        eq(masterDataOperationsTable.scope, currentScope()),
        before === undefined ? undefined : lt(masterDataOperationsTable.sequence, before),
      )).orderBy(desc(masterDataOperationsTable.sequence)).limit(limit + 1);
    });
    const items = rows.slice(0, limit);
    res.json({ items: items.map((item) => view(item)), nextCursor: rows.length > limit ? items.at(-1)!.sequence : null });
  } catch (error) { failure(error, res); }
});
router.post("/master-data-operations/:operationId/preview", ...access,
  requireCapability("manage-inventory"), requireCapability("manage-profiles"), async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    try { res.json(await previewMasterDataOperation(currentScope(), operationId(req), parseMasterDataCommand(req.body))); }
    catch (error) { failure(error, res); }
  });
router.post("/master-data-operations/:operationId/apply", ...access,
  requireCapability("manage-inventory"), requireCapability("manage-profiles"), async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    try {
      if (!req.body || Object.keys(req.body).some((key) => !["command", "expectedStateHash"].includes(key))
        || typeof req.body.expectedStateHash !== "string" || !/^[a-f0-9]{64}$/u.test(req.body.expectedStateHash)) {
        throw new MasterDataPlanError("A canonical preview is required before applying the command.");
      }
      const actor = currentActorId();
      if (!actor) { res.status(401).json({ error: "Unauthorized" }); return; }
      const scope = currentScope();
      const record = await commitMasterDataOperation(scope, actor, operationId(req), parseMasterDataCommand(req.body.command), req.body.expectedStateHash);
      notify(scope);
      res.json(view(record, true));
    } catch (error) { failure(error, res); }
  });
router.post("/master-data-operations/:operationId/undo", ...access,
  requireCapability("manage-inventory"), requireCapability("manage-profiles"), async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    try {
      if (req.body && Object.keys(req.body).length) throw new MasterDataPlanError("Undo accepts an operation ID only, never restoration facts.");
      const actor = currentActorId();
      if (!actor) { res.status(401).json({ error: "Unauthorized" }); return; }
      const scope = currentScope();
      const result = await undoMasterDataOperation(scope, actor, operationId(req));
      if (result.conflict) {
        res.status(409).json({ error: result.record.lastConflictReason === "retained-evidence-changed"
          ? "The retained evidence fingerprint changed. Nothing was restored. A manager must review the operation evidence."
          : "A canonical dependency changed. Nothing was restored. Review the later shared edit or the affected run before retrying.", operation: view(result.record) });
        return;
      }
      notify(scope);
      res.json(view(result.record, true));
    } catch (error) { failure(error, res); }
  });

export default router;
