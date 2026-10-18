import { Router, type IRouter } from "express";
import { and, desc, eq } from "drizzle-orm";
import * as z from "zod";
import { db, serverJobsTable, type ServerJobRow } from "@workspace/db";
import { currentScope } from "../lib/requestScope";
import { writeAuditEvent } from "./auditLogs";
import {
  enqueueServerJob,
  getServerJobDefinition,
  requestServerJobCancellation,
} from "../lib/serverJobs";
import {
  applyScheduledJobCleanupPlan,
  createScheduledJobCleanupPlan,
} from "../lib/scheduledJobCleanup";
import { CAPABILITIES } from "../lib/roles";
import {
  requireAnyCapability,
  requireCapability,
  requireLiveScope,
  requireManagerRole,
} from "../middlewares/requireCapability";
import { AI_ROUTE_BOUNDARIES, validateAiRequestBoundary } from "../lib/aiDataBoundary";

const router: IRouter = Router();
const CreateJob = z.object({
  type: z.string().regex(/^[a-z][a-z0-9-]{1,63}$/),
  idempotencyKey: z.string().min(8).max(128).regex(/^[A-Za-z0-9._:-]+$/),
  input: z.unknown().default({}),
  snapshotId: z.string().min(1).max(200).optional(),
}).strict();
const JobId = z.object({ id: z.string().uuid() });
const EmptyCleanupPlanRequest = z.object({}).strict();
const ApplyCleanupPlanRequest = z.object({
  manifestDigest: z.string().regex(/^[0-9a-f]{64}$/),
  reason: z.string().trim().min(3).max(200),
}).strict();
const CleanupPlanId = z.object({ planId: z.string().uuid() });

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
  if (parsed.data.type === "workbook-parse") {
    const boundary = validateAiRequestBoundary(AI_ROUTE_BOUNDARIES.workbookParseJob, parsed.data.input);
    if (!boundary.ok) {
      res.status(boundary.status).json({ error: boundary.error });
      return;
    }
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

router.post(
  "/server-jobs/scheduled-evaluation-cleanup/plans",
  requireLiveScope,
  requireCapability("manage-staff"),
  requireManagerRole,
  async (req, res): Promise<void> => {
    if (!EmptyCleanupPlanRequest.safeParse(req.body ?? {}).success) {
      res.status(400).json({ error: "Cleanup plan requests do not accept additional fields" });
      return;
    }
    try {
      const plan = await createScheduledJobCleanupPlan(req.userId!);
      res.status(201).json(plan);
    } catch (error) {
      req.log.error({ err: error }, "Failed to create a scheduled-job cleanup plan");
      res.status(500).json({ error: "Unable to create a cleanup plan" });
    }
  },
);

router.post(
  "/server-jobs/scheduled-evaluation-cleanup/plans/:planId/apply",
  requireLiveScope,
  requireCapability("manage-staff"),
  requireManagerRole,
  async (req, res): Promise<void> => {
    const parsedParams = CleanupPlanId.safeParse(req.params);
    const parsedBody = ApplyCleanupPlanRequest.safeParse(req.body);
    if (!parsedParams.success || !parsedBody.success) {
      res.status(400).json({ error: "Invalid cleanup approval request" });
      return;
    }
    try {
      const result = await applyScheduledJobCleanupPlan({
        planId: parsedParams.data.planId,
        manifestDigest: parsedBody.data.manifestDigest,
        reason: parsedBody.data.reason,
        actorId: req.userId!,
        audit: writeAuditEvent,
      });
      if (result.outcome === "applied") {
        res.status(200).json(result);
        return;
      }
      const message = result.outcome === "approval_mismatch"
        ? "The approved manifest does not match this plan"
        : result.outcome === "already_finalized"
        ? "This cleanup plan has already been finalized"
        : result.outcome === "no_candidates"
        ? "This plan contains no cleanup candidates"
        : "The cleanup plan is stale; create and review a new plan";
      res.status(409).json({ error: message, outcome: result.outcome });
    } catch (error) {
      req.log.error({ err: error }, "Failed to apply a scheduled-job cleanup plan");
      res.status(500).json({ error: "Unable to apply the cleanup plan" });
    }
  },
);

export default router;
