import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { HealthCheckResponse } from "@workspace/api-zod";
import { logger } from "../lib/logger";
import { getCacheMaintenanceDiagnostics } from "../lib/observability";
import { getStartupHealth } from "../lib/startupHealth";

const router: IRouter = Router();

type CheckStatus = "ok" | "error" | "pending";

async function readiness(_req: Request, res: Response): Promise<void> {
  const startup = getStartupHealth();
  const checks: Record<string, { status: CheckStatus; detail?: string }> = {
    process: { status: "ok" },
    startup: { status: startup.phase === "ready" ? "ok" : "error" },
    database: { status: "pending" },
    dependencies: { status: "pending" },
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
    } catch {
      checks.database = { status: "error", detail: "database_unreachable" };
    }

    const aiConfigured = Boolean(
      process.env.AI_INTEGRATIONS_GEMINI_API_KEY || process.env.OPENAI_API_KEY,
    );
    checks.dependencies = aiConfigured
      ? { status: "ok" }
      : { status: "error", detail: "ai_provider_not_configured" };
  }

  const allHealthy =
    startup.phase === "ready" &&
    Object.values(checks).every((c) => c.status === "ok");
  const flatChecks = Object.fromEntries(Object.entries(checks).map(([key, value]) => [key, value.status]));
  const diagnostics =
    startup.phase === "ready"
      ? { cacheMaintenance: await getCacheMaintenanceDiagnostics() }
      : undefined;
  logger.info(
    {
      event: "health_check",
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
    res.json({ ...data, checks: flatChecks, diagnostics, timestamp: new Date().toISOString() });
  } else {
    res.status(503).json({
      status: startup.phase === "starting" ? "starting" : "degraded",
      checks: flatChecks,
      ...(diagnostics ? { diagnostics } : {}),
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
