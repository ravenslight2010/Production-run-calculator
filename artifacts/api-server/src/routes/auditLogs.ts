import { Router, type Request, type Response } from "express";
import { db, auditLogsTable, insertAuditLogSchema } from "@workspace/db";
import { requireCapability } from "../middlewares/requireCapability";
import { eq, and, desc, sql, type SQL } from "drizzle-orm";

/**
 * Audit log endpoints for compliance and forensics.
 * Only managers can view logs.
 */

const router = Router();

// GET /api/audit-logs?scope=live&startDate=2026-07-01&endDate=2026-07-31&limit=100
router.get(
  "/audit-logs",
  requireCapability("manage-staff"),
  async (req: Request, res: Response) => {
    try {
      const scope = (req.query.scope as string) || "live";
      const startDate = (req.query.startDate as string) || "";
      const endDate = (req.query.endDate as string) || "";
      const limit = Math.min(Number(req.query.limit) || 100, 1000);

      const conditions: SQL[] = [eq(auditLogsTable.scope, scope)];

      if (startDate) {
        conditions.push(sql`${auditLogsTable.createdAt} >= ${startDate}::timestamp`);
      }

      if (endDate) {
        conditions.push(sql`${auditLogsTable.createdAt} <= ${endDate}::timestamp`);
      }

      const logs = await db
        .select()
        .from(auditLogsTable)
        .where(and(...conditions))
        .orderBy(desc(auditLogsTable.createdAt))
        .limit(limit);

      res.json({ logs, count: logs.length });
    } catch (err) {
      req.log.error({ err }, "Failed to fetch audit logs");
      res.status(500).json({ error: "Failed to fetch audit logs" });
    }
  },
);

/**
 * Log a high-stakes event to the audit trail.
 * Called internally by routes — not exposed as a public HTTP endpoint.
 * Fails silently so audit logging never breaks the main operation.
 */
export async function logAuditEvent(
  scope: string,
  actor: string,
  action: string,
  resource: string,
  changes: Record<string, any>,
  ipAddress?: string,
  userAgent?: string,
): Promise<void> {
  try {
    const validated = insertAuditLogSchema.parse({
      scope,
      actor,
      action,
      resource,
      changes,
      ipAddress,
      userAgent,
    });
    await db.insert(auditLogsTable).values(validated);
  } catch (err) {
    // Best-effort — never fail the caller
    console.error("Audit log error:", err);
  }
}

export default router;
