import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { HealthCheckResponse } from "@workspace/api-zod";
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

const router: IRouter = Router();

type CheckStatus = "ok" | "error" | "pending";

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

    // AI remains a hard readiness dependency under the existing operational
    // policy. Only its credential detection is delegated to the active Gemini
    // adapter so this probe cannot drift to unrelated provider keys.
    const aiConfigured = isGeminiProviderConfigured();
    checks.dependencies = aiConfigured
      ? { status: "ok" }
      : { status: "error", detail: "ai_provider_not_configured" };
    const backgroundOperationDiagnostics = await getBackgroundOperationDiagnostics();
    checks.backgroundWorkers = backgroundOperationsDegraded(backgroundOperationDiagnostics)
      ? { status: "error", detail: "sustained_background_worker_failures" }
      : { status: "ok" };
    res.locals.backgroundOperationDiagnostics = backgroundOperationDiagnostics;
  }

  const allHealthy =
    startup.phase === "ready" &&
    Object.values(checks).every((c) => c.status === "ok");
  const flatChecks = Object.fromEntries(
    Object.entries(checks).map(([key, value]) => [key, value.status]),
  );
  const diagnostics =
    startup.phase === "ready"
      ? {
        cacheMaintenance: await getCacheMaintenanceDiagnostics(),
        auditProtection: res.locals.auditProtection,
        backgroundOperations: res.locals.backgroundOperationDiagnostics,
      }
      : undefined;
  logger.info(
    {
      event: "health_check",
      correlationId,
      probe: "readiness",
      outcome: allHealthy ? "success" : "degraded",
      checks: flatChecks,
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

  if (allHealthy) {
    // Keep the existing contract for any caller that checks the shape
    const data = HealthCheckResponse.parse({ status: "ok" });
    res.json({
      ...data,
      checks: flatChecks,
      diagnostics,
      correlationId,
      timestamp: new Date().toISOString(),
    });
  } else {
    res.status(503).json({
      status: startup.phase === "starting" ? "starting" : "degraded",
      checks: flatChecks,
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
