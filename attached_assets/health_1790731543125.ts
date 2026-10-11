import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { HealthCheckResponse } from "@workspace/api-zod";
import { logger } from "../lib/logger";
import { getCacheMaintenanceDiagnostics } from "../lib/observability";
import { getStartupHealth } from "../lib/startupHealth";
import {
  backgroundOperationsDegraded,
  getBackgroundOperationDiagnostics,
} from "../lib/backgroundOperations";

const router: IRouter = Router();

type CheckStatus = "ok" | "error" | "pending";

// Optional live probe of a self-hosted OpenAI-compatible model server
// (Ollama / llama.cpp). Env-config presence is the deploy gate; the live
// probe only runs when LOCAL_AI_STRICT_READINESS=true so that a slow
// cold-start tunnel or model load does not block platform rollouts by
// default. Fail-closed AI behavior per the deterministic-AI-gates policy
// already covers the runtime path.
async function probeLocalModelHost(): Promise<CheckStatus> {
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
    } catch {
      checks.database = { status: "error", detail: "database_unreachable" };
    }

    const aiConfigured = Boolean(
      process.env.LOCAL_AI_BASE_URL ||
        process.env.AI_INTEGRATIONS_GEMINI_API_KEY ||
        process.env.GOOGLE_API_KEY ||
        process.env.OPENAI_API_KEY,
    );
    checks.dependencies = aiConfigured
      ? { status: "ok" }
      : { status: "error", detail: "ai_provider_not_configured" };
    // Optional strict probe of the self-hosted model host (off by default;
    // see probeLocalModelHost). Only meaningful when LOCAL_AI_BASE_URL set.
    if (aiConfigured && process.env.LOCAL_AI_BASE_URL) {
      const probeStatus = await probeLocalModelHost();
      if (probeStatus !== "ok") {
        checks.dependencies = {
          status: "error",
          detail: "local_model_host_unreachable",
        };
      }
    }
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
