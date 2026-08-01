import { Router, Request, Response } from 'express';
import { db, auditLogsTable, insertAuditLogSchema } from '@workspace/db';
import { requireAuth, requireCapability } from '../lib/auth';
import { eq, and, desc, sql } from 'drizzle-orm';

/**
 * Audit log endpoints for compliance and forensics.
 * Only managers can view logs.
 */

const router = Router();

// GET /api/audit-logs?scope=live&startDate=2026-07-01&endDate=2026-07-31&limit=100
router.get(
  '/audit-logs',
  requireAuth,
  requireCapability('manage-staff'),
  async (req: Request, res: Response) => {
    try {
      const scope = (req.query.scope as string) || 'live';
      const startDate = (req.query.startDate as string) || '';
      const endDate = (req.query.endDate as string) || '';
      const limit = Math.min(Number(req.query.limit) || 100, 1000);

      let query = db
        .select()
        .from(auditLogsTable)
        .where(eq(auditLogsTable.scope, scope));

      if (startDate) {
        query = query.where(
          and(
            sql`${auditLogsTable.createdAt} >= ${startDate}::timestamp`
          )
        ) as any;
      }

      if (endDate) {
        query = query.where(
          and(
            sql`${auditLogsTable.createdAt} <= ${endDate}::timestamp`
          )
        ) as any;
      }

      const logs = await query
        .orderBy(desc(auditLogsTable.createdAt))
        .limit(limit);

      res.json({ logs, count: logs.length });
    } catch (err) {
      req.log.error({ err }, 'Failed to fetch audit logs');
      res.status(500).json({ error: 'Failed to fetch audit logs' });
    }
  }
);

// POST /api/audit-logs (internal use only, called by other routes)
// Not exposed as a public endpoint; routes call this function directly
export async function logAuditEvent(
  scope: string,
  actor: string,
  action: string,
  resource: string,
  changes: Record<string, any>,
  ipAddress?: string,
  userAgent?: string
) {
  try {
    const logEntry = {
      scope,
      actor,
      action,
      resource,
      changes,
      ipAddress,
      userAgent,
    };

    const validated = insertAuditLogSchema.parse(logEntry);
    await db.insert(auditLogsTable).values(validated);
  } catch (err) {
    // Don't fail the main operation if audit logging fails
    console.error('Audit log error:', err);
  }
}

export default router;
