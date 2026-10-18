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
import { getSyncOutboxLagDiagnostics } from "../lib/syncOutbox";

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

// Optional live probe of a self-hosted OpenAI-compatible model server
// (Ollama / llama.cpp). Env-config presence is the deploy gate; the live probe
// only runs when LOCAL_AI_STRICT_READINESS=true so that a slow cold-start
// tunnel or model load does not block platform rollouts by default. The
// fail-closed AI behavior per the deterministic-AI-gates policy already covers
// the runtime path.
async function probeLocalModelHost(): Promise<"ok" | "error"> {
  const base = process.env.LOCAL_AI_BASE_URL;
  if (!base || process.env.LOCAL_AI_STRICT_READINESS !== "true") return "ok";
  const probeUrl = `${base.replace(/\/$/, "")}/models`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1500);
  try {
    const res = await fetch(probeUrl, {
      signal: controller.signal,
      headers: process.env.LOCAL_AI_API_KEY
        ? { authorization: `Bearer ${process.env.LOCAL_AI_API_KEY}` }
        : undefined,
    });
    return res.ok ? "ok" : "error";
  } catch {
    return "error";
  } finally {
    clearTimeout(timer);
  }
}



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
    // preventing core readiness. A configured self-hosted LOCAL_AI_BASE_URL
    // (OpenAI-compatible local backend) also satisfies the check; an unrelated
    // OPENAI_API_KEY is intentionally NOT accepted. When a local host is
    // configured, an optional strict probe (LOCAL_AI_STRICT_READINESS=true)
    // can fail readiness if the model server is unreachable.
    const aiConfigured =
      isGeminiProviderConfigured() || Boolean(process.env.LOCAL_AI_BASE_URL);
    checks.dependencies = aiConfigured
      ? { status: "ok" }
      : { status: "warning", detail: "ai_provider_not_configured" };
    capabilities.ai = aiConfigured
      ? { status: "configured" }
      : { status: "not_configured", detail: "ai_provider_not_configured" };
    if (aiConfigured && process.env.LOCAL_AI_BASE_URL) {
      const probeStatus = await probeLocalModelHost();
      if (probeStatus !== "ok") {
        checks.dependencies = {
          status: "error",
          detail: "local_model_host_unreachable",
        };
        capabilities.ai = {
          status: "not_configured",
          detail: "local_model_host_unreachable",
        };
      }
    }
    const backgroundOperationDiagnostics = await getBackgroundOperationDiagnostics();
    const scheduledEvaluationQueue = getScheduledEvaluationQueueDiagnostics();
    const syncOutboxLag = getSyncOutboxLagDiagnostics();
    const backgroundOperationsWarning = backgroundOperationsDegraded(backgroundOperationDiagnostics);
    const scheduledQueueUnavailable = scheduledEvaluationQueue.sampleAvailability === "unavailable";
    checks.backgroundWorkers = backgroundOperationsWarning || scheduledQueueUnavailable ||
      syncOutboxLag.status === "warning" ||
      scheduledEvaluationQueue.status === "warning"
      ? {
        status: "warning",
        detail: scheduledQueueUnavailable
          ? "scheduled_evaluation_queue_sample_unavailable"
          : scheduledEvaluationQueue.status === "warning"
          ? "scheduled_evaluation_queue_warning"
          : syncOutboxLag.status === "warning"
          ? "sync_outbox_delivery_lag"
          : "sustained_background_worker_failures",
      }
      : { status: "ok" };
    res.locals.backgroundOperationDiagnostics = backgroundOperationDiagnostics;
    res.locals.scheduledEvaluationQueue = scheduledEvaluationQueue;
    res.locals.syncOutboxLag = syncOutboxLag;
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
        syncOutboxLag: res.locals.syncOutboxLag,
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
