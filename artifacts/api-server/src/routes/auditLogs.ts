import { Router, type Request, type Response } from "express";
import { db, auditLogsTable, dataHealsTable } from "@workspace/db";
import { requireCapability, requireLiveScope } from "../middlewares/requireCapability";
import { eq, and, desc, lt, or, sql, type SQL } from "drizzle-orm";
import { currentActorId, currentScope } from "../lib/requestScope";

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
  requireLiveScope,
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

const MAX_PAGE_SIZE = 200;
const MAX_EXPORT_ROWS = 5_000;
const MAX_STRING = 200;
const MAX_PAYLOAD_BYTES = 8_192;
const EVENT_SCHEMAS: Record<string, { required: string[]; allowed: string[] }> = {
  factory_reset: { required: ["outcome"], allowed: ["outcome", "count"] },
  role_granted: { required: ["outcome"], allowed: ["outcome", "targetId"] },
  role_revoked: { required: ["outcome"], allowed: ["outcome", "targetId"] },
  role_changed: { required: ["outcome"], allowed: ["outcome", "targetId"] },
  password_reset: { required: ["outcome", "targetId"], allowed: ["outcome", "targetId", "method"] },
  password_reset_approved: { required: ["outcome", "targetId"], allowed: ["outcome", "targetId", "requestId"] },
  production_rules_updated: { required: ["outcome", "count"], allowed: ["outcome", "count"] },
  production_rules_deleted: { required: ["outcome", "count"], allowed: ["outcome", "count"] },
  manager_action_item_update: { required: ["outcome", "targetId"], allowed: ["outcome", "targetId"] },
  incident_workflow_updated: { required: ["outcome", "targetId"], allowed: ["outcome", "targetId"] },
  incident_note_added: { required: ["outcome", "targetId"], allowed: ["outcome", "targetId"] },
  profile_data_health_repair: { required: ["outcome", "count"], allowed: ["outcome", "count"] },
};

function boundedString(value: unknown, max = MAX_STRING): string | undefined {
  if (typeof value !== "string") return undefined;
  const result = value.trim();
  return result && result.length <= max ? result : undefined;
}

/** Redacts arbitrary legacy event input into the small operational evidence schema. */
export function redactAuditChanges(value: unknown): Record<string, unknown> {
  const allowed = new Set(["count", "outcome", "reasonCode", "targetId", "targetType", "from", "to", "method", "requestId"]);
  const output: Record<string, unknown> = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return output;
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!allowed.has(key)) continue;
    if (typeof raw === "number" && Number.isFinite(raw)) output[key] = Math.max(-1_000_000, Math.min(1_000_000, Math.trunc(raw)));
    else if (typeof raw === "boolean") output[key] = raw;
    else {
      const text = boundedString(raw);
      if (text) output[key] = text;
    }
  }
  if (Buffer.byteLength(JSON.stringify(output), "utf8") > MAX_PAYLOAD_BYTES) {
    throw new Error("Audit payload exceeds the permitted size");
  }
  return output;
}

function encodeCursor(createdAt: Date, id: number): string {
  return Buffer.from(`${createdAt.toISOString()}|${id}`, "utf8").toString("base64url");
}

function decodeCursor(value: unknown): { createdAt: string; id: number } | undefined {
  if (typeof value !== "string" || value.length > 200) return undefined;
  try {
    const [createdAt, rawId] = Buffer.from(value, "base64url").toString("utf8").split("|");
    const id = Number(rawId);
    if (!createdAt || !Number.isInteger(id) || id < 1 || Number.isNaN(Date.parse(createdAt))) return undefined;
    return { createdAt, id };
  } catch {
    return undefined;
  }
}

// GET /api/audit-logs?startDate=2026-07-01&endDate=2026-07-31&limit=100&cursor=...
router.get(
  "/audit-logs",
  requireLiveScope,
  requireCapability("manage-staff"),
  async (req: Request, res: Response) => {
    try {
      const scope = currentScope();
      const startDate = (req.query.startDate as string) || "";
      const endDate = (req.query.endDate as string) || "";
      if ((startDate && Number.isNaN(Date.parse(startDate))) || (endDate && Number.isNaN(Date.parse(endDate)))) {
        res.status(400).json({ error: "Invalid audit date range" });
        return;
      }
      const requestedLimit = Number(req.query.limit) || 100;
      if (!Number.isInteger(requestedLimit) || requestedLimit < 1 || requestedLimit > MAX_PAGE_SIZE) {
        res.status(400).json({ error: `limit must be between 1 and ${MAX_PAGE_SIZE}` });
        return;
      }
      const limit = requestedLimit;
      const cursor = req.query.cursor ? decodeCursor(req.query.cursor) : undefined;
      if (req.query.cursor && !cursor) {
        res.status(400).json({ error: "Invalid audit cursor" });
        return;
      }

      const conditions: SQL[] = [eq(auditLogsTable.scope, scope)];

      if (startDate) {
        conditions.push(sql`${auditLogsTable.createdAt} >= ${startDate}::timestamp`);
      }

      if (endDate) {
        conditions.push(sql`${auditLogsTable.createdAt} <= ${endDate}::timestamp`);
      }
      if (cursor) {
        conditions.push(or(
          lt(auditLogsTable.createdAt, new Date(cursor.createdAt)),
          and(eq(auditLogsTable.createdAt, new Date(cursor.createdAt)), lt(auditLogsTable.id, cursor.id)),
        )!);
      }

      const logs = await db
        .select({
          id: auditLogsTable.id, actor: auditLogsTable.actor,
          action: auditLogsTable.action, resource: auditLogsTable.resource,
          changes: auditLogsTable.changes, createdAt: auditLogsTable.createdAt,
        })
        .from(auditLogsTable)
        .where(and(...conditions))
        .orderBy(desc(auditLogsTable.createdAt), desc(auditLogsTable.id))
        .limit(limit + 1);

      const hasMore = logs.length > limit;
      const page = hasMore ? logs.slice(0, limit) : logs;
      const last = page.at(-1);
      res.json({ logs: page, count: page.length, nextCursor: hasMore && last ? encodeCursor(last.createdAt, last.id) : null });
    } catch (err) {
      req.log.error({ err }, "Failed to fetch audit logs");
      res.status(500).json({ error: "Failed to fetch audit logs" });
    }
  },
);

router.get(
  "/audit-logs/export.csv",
  requireLiveScope,
  requireCapability("manage-staff"),
  async (req: Request, res: Response) => {
    try {
      const requestedLimit = Number(req.query.limit) || MAX_EXPORT_ROWS;
      if (!Number.isInteger(requestedLimit) || requestedLimit < 1 || requestedLimit > MAX_EXPORT_ROWS) {
        res.status(400).json({ error: `limit must be between 1 and ${MAX_EXPORT_ROWS}` });
        return;
      }
      const limit = requestedLimit;
      const rows = await db.select({
        id: auditLogsTable.id, actor: auditLogsTable.actor, action: auditLogsTable.action,
        resource: auditLogsTable.resource, changes: auditLogsTable.changes, createdAt: auditLogsTable.createdAt,
      }).from(auditLogsTable).where(eq(auditLogsTable.scope, currentScope()))
        .orderBy(desc(auditLogsTable.createdAt), desc(auditLogsTable.id)).limit(limit);
      const csv = [
        "id,actor,action,resource,changes,createdAt",
        ...rows.map((row) => [row.id, row.actor, row.action, row.resource ?? "", JSON.stringify(row.changes), row.createdAt.toISOString()]
          .map((value) => `"${String(value).replaceAll('"', '""')}"`).join(",")),
      ].join("\n");
      res.type("text/csv").send(csv);
    } catch (err) {
      req.log.error({ err }, "Failed to export audit logs");
      res.status(500).json({ error: "Failed to export audit logs" });
    }
  },
);

/**
 * Log a high-stakes event to the audit trail.
 * Called internally by routes — not exposed as a public HTTP endpoint.
 * Legacy-compatible signature: scope, actor, and network metadata are ignored.
 * Scope and actor are always derived from authenticated request context.
 */
export async function logAuditEvent(
  _scope: string,
  _actor: string,
  action: string,
  resource: string,
  changes: Record<string, unknown>,
  _ipAddress?: string,
  _userAgent?: string,
  executor: Pick<typeof db, "insert"> = db,
): Promise<void> {
  return writeAuditEvent(executor, { action, resource, changes });
}

export async function writeAuditEvent(
  executor: Pick<typeof db, "insert">,
  input: { action: string; resource: string; changes: Record<string, unknown> },
): Promise<void> {
  const safeAction = boundedString(input.action, 100);
  const safeResource = boundedString(input.resource);
  if (!safeAction || !safeResource) throw new Error("Audit action and resource are required");
  const schema = EVENT_SCHEMAS[safeAction];
  if (!schema) throw new Error("Unsupported audit action");
  const redacted = redactAuditChanges(input.changes);
  if (Object.keys(redacted).some((key) => !schema.allowed.includes(key)) ||
      schema.required.some((key) => redacted[key] === undefined)) {
    throw new Error("Audit evidence does not match the event schema");
  }
  await executor.insert(auditLogsTable).values({
    scope: currentScope(), actor: currentActorId(), action: safeAction,
    resource: safeResource, changes: redacted,
  });
}

export default router;
