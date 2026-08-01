import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { HealthCheckResponse } from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/healthz", async (_req: Request, res: Response) => {
  const checks: Record<string, string> = {
    database: "ok",
  };

  // Verify the DB is reachable
  try {
    await db.execute(sql`SELECT 1`);
  } catch (err) {
    checks.database = `error: ${(err as any).message || "unknown"}`;
  }

  const allHealthy = Object.values(checks).every((c) => c === "ok");

  if (allHealthy) {
    // Keep the existing contract for any caller that checks the shape
    const data = HealthCheckResponse.parse({ status: "ok" });
    res.json({ ...data, checks, timestamp: new Date().toISOString() });
  } else {
    res.status(503).json({
      status: "degraded",
      checks,
      timestamp: new Date().toISOString(),
    });
  }
});

export default router;
