import { Router, type IRouter } from "express";
import { and, desc, eq } from "drizzle-orm";
import * as z from "zod";
import { db, serverJobsTable, type ServerJobRow } from "@workspace/db";
import { currentScope } from "../lib/requestScope";
import {
  enqueueServerJob,
  getServerJobDefinition,
  requestServerJobCancellation,
} from "../lib/serverJobs";
import { CAPABILITIES } from "../lib/roles";
import { requireAnyCapability } from "../middlewares/requireCapability";

const router: IRouter = Router();
const CreateJob = z.object({
  type: z.string().regex(/^[a-z][a-z0-9-]{1,63}$/),
  idempotencyKey: z.string().min(8).max(128).regex(/^[A-Za-z0-9._:-]+$/),
  input: z.unknown().default({}),
  snapshotId: z.string().min(1).max(200).optional(),
}).strict();
const JobId = z.object({ id: z.string().uuid() });

function response(row: ServerJobRow) {
  return {
    id: row.id, type: row.type, status: row.status, snapshotId: row.snapshotId,
    progress: row.progress, progressMessage: row.progressMessage, attempt: row.attempt,
    maxAttempts: row.maxAttempts, cancelRequested: row.cancelRequested, result: row.result,
    error: row.errorCode ? { code: row.errorCode, message: row.errorMessage } : null,
    createdAt: row.createdAt.toISOString(), startedAt: row.startedAt?.toISOString() ?? null,
    finishedAt: row.finishedAt?.toISOString() ?? null, expiresAt: row.expiresAt.toISOString(),
  };
}

router.post("/server-jobs", requireAnyCapability(CAPABILITIES), async (req, res): Promise<void> => {
  const parsed = CreateJob.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid server job request" }); return; }
  const definition = getServerJobDefinition(parsed.data.type);
  if (!definition) { res.status(400).json({ error: "Unsupported server job type" }); return; }
  if (!req.capabilities?.includes(definition.capability)) {
    res.status(403).json({ error: "Missing capability for this server job" }); return;
  }
  try {
    const outcome = await enqueueServerJob({
      scope: currentScope(), actorId: req.userId!, type: parsed.data.type,
      idempotencyKey: parsed.data.idempotencyKey, input: parsed.data.input, snapshotId: parsed.data.snapshotId,
    });
    res.status(outcome.created ? 202 : 200).json({ ...response(outcome.job), idempotentReplay: !outcome.created });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Unable to queue server job" });
  }
});

router.get("/server-jobs", async (req, res): Promise<void> => {
  const rows = await db.select().from(serverJobsTable).where(and(
    eq(serverJobsTable.scope, currentScope()), eq(serverJobsTable.actorId, req.userId!),
  )).orderBy(desc(serverJobsTable.createdAt)).limit(100);
  res.json(rows.map(response));
});

router.get("/server-jobs/:id", async (req, res): Promise<void> => {
  const parsed = JobId.safeParse(req.params);
  if (!parsed.success) { res.status(400).json({ error: "Invalid server job id" }); return; }
  const row = (await db.select().from(serverJobsTable).where(and(
    eq(serverJobsTable.id, parsed.data.id), eq(serverJobsTable.scope, currentScope()),
    eq(serverJobsTable.actorId, req.userId!),
  )).limit(1))[0];
  if (!row) { res.status(404).json({ error: "Server job not found" }); return; }
  res.json(response(row));
});

router.post("/server-jobs/:id/cancel", requireAnyCapability(CAPABILITIES), async (req, res): Promise<void> => {
  const parsed = JobId.safeParse(req.params);
  if (!parsed.success) { res.status(400).json({ error: "Invalid server job id" }); return; }
  const existing = (await db.select().from(serverJobsTable).where(and(
    eq(serverJobsTable.id, parsed.data.id), eq(serverJobsTable.scope, currentScope()),
    eq(serverJobsTable.actorId, req.userId!),
  )).limit(1))[0];
  if (!existing) { res.status(404).json({ error: "Server job not found or already complete" }); return; }
  const definition = getServerJobDefinition(existing.type);
  if (!definition || !req.capabilities?.includes(definition.capability)) {
    res.status(403).json({ error: "Missing capability for this server job" }); return;
  }
  const row = await requestServerJobCancellation(parsed.data.id, currentScope(), req.userId!);
  if (!row) { res.status(404).json({ error: "Server job not found or already complete" }); return; }
  res.status(202).json(response(row));
});

export default router;