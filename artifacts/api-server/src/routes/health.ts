import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { HealthCheckResponse } from "@workspace/api-zod";
import { logger } from "../lib/logger";

const router: IRouter = Router();

router.get("/healthz", async (_req: Request, res: Response) => {
  const checks: Record<string, { status: "ok" | "error"; detail?: string }> = {
    process: { status: "ok" },
    database: { status: "ok" },
    dependencies: { status: "ok" },
  };

  // Verify the DB is reachable
  try {
    await db.execute(sql`SELECT 1`);
  } catch (err) {
    checks.database = { status: "error", detail: "database_unreachable" };
  }

  const aiConfigured = Boolean(process.env.AI_INTEGRATIONS_GEMINI_API_KEY || process.env.OPENAI_API_KEY);
  if (!aiConfigured) checks.dependencies = { status: "error", detail: "ai_provider_not_configured" };
  const allHealthy = Object.values(checks).every((c) => c.status === "ok");
  const flatChecks = Object.fromEntries(Object.entries(checks).map(([key, value]) => [key, value.status]));
  logger.info({ event: "health_check", outcome: allHealthy ? "success" : "degraded", checks: flatChecks }, "health check completed");

  if (allHealthy) {
    // Keep the existing contract for any caller that checks the shape
    const data = HealthCheckResponse.parse({ status: "ok" });
    res.json({ ...data, checks: flatChecks, timestamp: new Date().toISOString() });
  } else {
    res.status(503).json({
      status: "degraded",
      checks: flatChecks,
      timestamp: new Date().toISOString(),
    });
  }
});

export default router;
