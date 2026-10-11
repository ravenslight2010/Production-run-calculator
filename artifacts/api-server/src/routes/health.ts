import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { GetBuildInfoResponse, HealthCheckResponse } from "@workspace/api-zod";
import { getBuildInfo } from "../lib/buildInfo";
import { isGeminiProviderConfigured } from "@workspace/integrations-openai-ai-server";
import { logger } from "../lib/logger";
import { getCacheMaintenanceDiagnostics } from "../lib/observability";
import { getStartupHealth } from "../lib/startupHealth";
import {
  getAuditLogProtectionCheck,
  type AuditProtectionCheck,
} from "../lib/health";
import {
  backgroundOperationsDegraded,
  getBackgroundOperationDiagnostics,
} from "../lib/backgroundOperations";
import { getScheduledEvaluationQueueDiagnostics } from "../lib/serverJobs";

const router: IRouter = Router();

router.get("/build-info", (_req: Request, res: Response) => {
  res.setHeader("Cache-Control", "no-store");
  const info = getBuildInfo();
  if (!info) {
    res.status(503).json({ error: "Build version is unavailable.", status: "unavailable" });
    return;
  }
  res.json(GetBuildInfoResponse.parse(info));
});

type CheckStatus = "ok" | "warning" | "error" | "pending";
type AiCapabilityStatus = "configured" | "not_configured" | "pending";

async function readiness(req: Request, res: Response): Promise<void> {
  const startup = getStartupHealth();
  const correlationId = String(
    (req as Request & { correlationId?: string }).correlationId ??
      req.id ??
      "health",
  );
  const checks: Record<string, { status: CheckStatus; detail?: string }> = {
    process: { status: "ok" },
    startup: { status: startup.phase === "ready" ? "ok" : "error" },
    database: { status: "pending" },
    auditProtection: { status: "pending" },
    dependencies: { status: "pending" },
    backgroundWorkers: { status: "pending" },
  };
  const capabilities: { ai: { status: AiCapabilityStatus; detail?: string } } = {
    ai: { status: "pending" },
  };

  if (startup.phase !== "ready") {
    checks.startup = {
      status: "error",
      detail: startup.failure?.errorCode ?? "initialization_in_progress",
    };
  } else {
    // Verify the DB only after required startup work has completed. During a
    // cold start this keeps the platform probe fast and avoids turning a
    // temporary initialization window into a misleading DB 500.
    try {
      await db.execute(sql`SELECT 1`);
      checks.database = { status: "ok" };
      const auditProtection = await getAuditLogProtectionCheck();
      checks.auditProtection = auditProtection;
      res.locals.auditProtection = auditProtection;
    } catch {
      checks.database = { status: "error", detail: "database_unreachable" };
      const auditProtection: AuditProtectionCheck = {
        status: "error",
        detail: "database_unreachable",
      };
      checks.auditProtection = auditProtection;
      res.locals.auditProtection = auditProtection;
    }

    // This is a credential-configuration signal, not a remote provider probe.
    // AI is optional for core API traffic, so its absence is reported without
    // preventing core readiness.
    const aiConfigured = isGeminiProviderConfigured();
    checks.dependencies = aiConfigured
      ? { status: "ok" }
      : { status: "warning", detail: "ai_provider_not_configured" };
    capabilities.ai = aiConfigured
      ? { status: "configured" }
      : { status: "not_configured", detail: "ai_provider_not_configured" };
    const backgroundOperationDiagnostics = await getBackgroundOperationDiagnostics();
    const scheduledEvaluationQueue = getScheduledEvaluationQueueDiagnostics();
    const backgroundOperationsWarning = backgroundOperationsDegraded(backgroundOperationDiagnostics);
    checks.backgroundWorkers = backgroundOperationsWarning || scheduledEvaluationQueue.status === "warning"
      ? {
        status: "warning",
        detail: scheduledEvaluationQueue.status === "warning"
          ? "scheduled_evaluation_queue_warning"
          : "sustained_background_worker_failures",
      }
      : { status: "ok" };
    res.locals.backgroundOperationDiagnostics = backgroundOperationDiagnostics;
    res.locals.scheduledEvaluationQueue = scheduledEvaluationQueue;
  }

  // Only conditions required to safely serve core operational traffic block
  // readiness. Optional AI and background-worker warnings remain visible below.
  const coreReady =
    startup.phase === "ready" &&
    checks.database.status === "ok" &&
    checks.auditProtection.status === "ok";
  const flatChecks = Object.fromEntries(
    Object.entries(checks).map(([key, value]) => [key, value.status]),
  );
  const diagnostics =
    startup.phase === "ready"
      ? {
        cacheMaintenance: await getCacheMaintenanceDiagnostics(),
        auditProtection: res.locals.auditProtection,
        backgroundOperations: res.locals.backgroundOperationDiagnostics,
        scheduledEvaluationQueue: res.locals.scheduledEvaluationQueue,
      }
      : undefined;
  logger.info(
    {
      event: "health_check",
      correlationId,
      probe: "readiness",
      outcome: coreReady ? "success" : "degraded",
      checks: flatChecks,
      capabilities: { ai: capabilities.ai.status },
      startup: {
        phase: startup.phase,
        stage: startup.stage,
        durationMs: startup.durationMs,
        ...(startup.failure ? { errorCode: startup.failure.errorCode } : {}),
      },
      ...(diagnostics ? { diagnostics } : {}),
    },
    "health check completed",
  );

  if (coreReady) {
    res.json(HealthCheckResponse.parse({
      status: "ok",
      checks: flatChecks,
      capabilities,
      diagnostics,
      correlationId,
      timestamp: new Date().toISOString(),
    }));
  } else {
    res.status(503).json({
      status: startup.phase === "starting" ? "starting" : "degraded",
      checks: flatChecks,
      capabilities,
      startup: {
        phase: startup.phase,
        stage: startup.stage,
        durationMs: startup.durationMs,
        ...(startup.failure ? { errorCode: startup.failure.errorCode } : {}),
      },
      ...(diagnostics ? { diagnostics } : {}),
      correlationId,
      timestamp: new Date().toISOString(),
    });
  }
}

// Liveness is intentionally independent of the database, AI provider, and
// startup work. It answers whether the Node process can accept a probe.
router.get("/livez", (_req: Request, res: Response) => {
  res.json({ status: "ok", probe: "liveness" });
});

// /healthz remains a compatibility alias for existing local checks and clients.
// / is the API-base probe used by some platform routers; it is health-only and
// does not expose any application data or bypass business-route auth.
router.get("/readyz", readiness);
router.get("/healthz", readiness);
router.get("/", readiness);

export default router;
