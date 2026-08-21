import { Router, type Request, type Response } from "express";
import { db, auditLogsTable, dataHealsTable, insertAuditLogSchema } from "@workspace/db";
import { requireCapability } from "../middlewares/requireCapability";
import { eq, and, desc, sql, type SQL } from "drizzle-orm";

/**
 * Audit log endpoints for compliance and forensics.
 * Only managers can view logs.
 */

const router = Router();
const PROFILE_NAME_LINK_STUB_PURGE_ID = "profile-name-link-stub-purge-v1";

type ProfileNameLinkCleanupSummary = {
  scannedProfiles: number;
  correctedProfiles: number;
  skippedStarted: number;
  removedStubs: {
    dough: number;
    sauce: number;
    cheese: number;
    mix: number;
  };
};

function safeCount(value: unknown): number {
  const count = Number(value);
  return Number.isFinite(count) && count >= 0 ? Math.floor(count) : 0;
}

/**
 * The marker result is historical data, so accept earlier rows that may omit
 * fields while keeping the public response predictable and read-only.
 */
export function profileNameLinkCleanupSummary(value: unknown): ProfileNameLinkCleanupSummary {
  const result = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const removed = result.removedStubs && typeof result.removedStubs === "object" && !Array.isArray(result.removedStubs)
    ? result.removedStubs as Record<string, unknown>
    : {};

  return {
    scannedProfiles: safeCount(result.scannedProfiles),
    correctedProfiles: safeCount(result.correctedProfiles),
    skippedStarted: safeCount(result.skippedStarted),
    removedStubs: {
      dough: safeCount(removed.dough),
      sauce: safeCount(removed.sauce),
      cheese: safeCount(removed.cheese),
      mix: safeCount(removed.mix),
    },
  };
}

// GET /api/audit-logs/profile-name-link-cleanup
// Manager-only read-only record of the one-time name-link/stub cleanup.
router.get(
  "/audit-logs/profile-name-link-cleanup",
  requireCapability("manage-staff"),
  async (req: Request, res: Response) => {
    try {
      const [marker] = await db
        .select({
          id: dataHealsTable.id,
          appliedAt: dataHealsTable.appliedAt,
          result: dataHealsTable.result,
        })
        .from(dataHealsTable)
        .where(eq(dataHealsTable.id, PROFILE_NAME_LINK_STUB_PURGE_ID))
        .limit(1);

      res.json({
        heal: marker
          ? {
              id: marker.id,
              appliedAt: marker.appliedAt,
              summary: profileNameLinkCleanupSummary(marker.result),
            }
          : null,
      });
    } catch (err) {
      req.log.error({ err }, "Failed to fetch profile name-link cleanup audit");
      res.status(500).json({ error: "Failed to fetch profile name-link cleanup audit" });
    }
  },
);

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
