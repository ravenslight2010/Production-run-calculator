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
const AUDIT_EXPORT_COLUMNS = ["id", "actor", "action", "resource", "changes", "createdAt"] as const;
const PDF_PAGE_WIDTH = 612;
const PDF_PAGE_HEIGHT = 792;
const PDF_MARGIN = 36;
const PDF_LINE_HEIGHT = 11;
const PDF_TEXT_WIDTH = 108;
const PDF_ROWS_PER_PAGE = 64;
const EVENT_SCHEMAS: Record<string, { required: string[]; allowed: string[] }> = {
  factory_reset: { required: ["outcome"], allowed: ["outcome", "count"] },
  role_granted: { required: ["outcome"], allowed: ["outcome", "targetId"] },
  role_revoked: { required: ["outcome"], allowed: ["outcome", "targetId"] },
  role_changed: { required: ["outcome"], allowed: ["outcome", "targetId"] },
  password_reset: { required: ["outcome", "targetId"], allowed: ["outcome", "targetId", "method"] },
  password_reset_approved: { required: ["outcome", "targetId"], allowed: ["outcome", "targetId", "requestId"] },
  audit_log_maintenance_approved: {
    required: ["outcome", "targetId", "targetType", "authorizedBy", "reasonCode"],
    allowed: ["outcome", "targetId", "targetType", "authorizedBy", "reasonCode"],
  },
  production_rules_updated: { required: ["outcome", "count"], allowed: ["outcome", "count"] },
  production_rules_deleted: { required: ["outcome", "count"], allowed: ["outcome", "count"] },
  manager_action_item_update: { required: ["outcome", "targetId"], allowed: ["outcome", "targetId"] },
  incident_workflow_updated: { required: ["outcome", "targetId"], allowed: ["outcome", "targetId"] },
  incident_note_added: { required: ["outcome", "targetId"], allowed: ["outcome", "targetId"] },
  profile_data_health_repair: { required: ["outcome", "count"], allowed: ["outcome", "count"] },
  account_disabled: { required: ["outcome", "targetId"], allowed: ["outcome", "targetId"] },
  account_enabled: { required: ["outcome", "targetId"], allowed: ["outcome", "targetId"] },
  sessions_revoked: { required: ["outcome", "targetId"], allowed: ["outcome", "targetId"] },
  staff_invitation_created: { required: ["outcome"], allowed: ["outcome", "targetType", "from"] },
  staff_invitation_revoked: { required: ["outcome"], allowed: ["outcome", "targetType"] },
};

function boundedString(value: unknown, max = MAX_STRING): string | undefined {
  if (typeof value !== "string") return undefined;
  const result = value.trim();
  return result && result.length <= max ? result : undefined;
}

/** Redacts arbitrary legacy event input into the small operational evidence schema. */
export function redactAuditChanges(value: unknown): Record<string, unknown> {
  const allowed = new Set(["count", "outcome", "reasonCode", "targetId", "targetType", "authorizedBy", "from", "to", "method", "requestId"]);
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

type AuditExportRow = {
  id: number;
  actor: string;
  action: string;
  resource: string | null;
  changes: unknown;
  createdAt: Date;
};

function parseAuditExportQuery(req: Request): {
  limit: number;
  startDate?: string;
  endDate?: string;
  error?: string;
} {
  const rawLimit = req.query.limit;
  const requestedLimit = rawLimit === undefined ? MAX_EXPORT_ROWS : Number(rawLimit);
  if (!Number.isInteger(requestedLimit) || requestedLimit < 1 || requestedLimit > MAX_EXPORT_ROWS) {
    return { limit: MAX_EXPORT_ROWS, error: `limit must be between 1 and ${MAX_EXPORT_ROWS}` };
  }

  const startDate = typeof req.query.startDate === "string" ? req.query.startDate : undefined;
  const endDate = typeof req.query.endDate === "string" ? req.query.endDate : undefined;
  if ((startDate && Number.isNaN(Date.parse(startDate))) || (endDate && Number.isNaN(Date.parse(endDate)))) {
    return { limit: requestedLimit, startDate, endDate, error: "Invalid audit date range" };
  }

  return { limit: requestedLimit, startDate, endDate };
}

async function selectAuditExportRows(
  scope: string,
  query: Pick<ReturnType<typeof parseAuditExportQuery>, "limit" | "startDate" | "endDate">,
): Promise<AuditExportRow[]> {
  const conditions: SQL[] = [eq(auditLogsTable.scope, scope)];
  if (query.startDate) {
    conditions.push(sql`${auditLogsTable.createdAt} >= ${query.startDate}::timestamp`);
  }
  if (query.endDate) {
    conditions.push(sql`${auditLogsTable.createdAt} <= ${query.endDate}::timestamp`);
  }

  return db.select({
    id: auditLogsTable.id,
    actor: auditLogsTable.actor,
    action: auditLogsTable.action,
    resource: auditLogsTable.resource,
    changes: auditLogsTable.changes,
    createdAt: auditLogsTable.createdAt,
  }).from(auditLogsTable).where(and(...conditions))
    .orderBy(desc(auditLogsTable.createdAt), desc(auditLogsTable.id)).limit(query.limit);
}

function publicAuditValues(row: AuditExportRow): string[] {
  return [
    String(row.id),
    row.actor,
    row.action,
    row.resource ?? "",
    JSON.stringify(redactAuditChanges(row.changes)),
    row.createdAt.toISOString(),
  ];
}

function csvCell(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function pdfText(value: string): string {
  // The built-in Helvetica font is intentionally used to keep the export
  // dependency-free. Replace unsupported glyphs instead of emitting invalid
  // PDF bytes or interpreting user-controlled text as PDF syntax.
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll("(", "\\(")
    .replaceAll(")", "\\)")
    .replace(/[^\x20-\x7e]/g, "?");
}

function wrapPdfText(value: string): string[] {
  const text = value || "";
  if (!text) return [""];
  const lines: string[] = [];
  for (let offset = 0; offset < text.length; offset += PDF_TEXT_WIDTH) {
    lines.push(text.slice(offset, offset + PDF_TEXT_WIDTH));
  }
  return lines;
}

function buildAuditPdf(rows: AuditExportRow[]): Buffer {
  const lines: string[] = [
    "Operational audit export",
    `Rows: ${rows.length}`,
    "",
    AUDIT_EXPORT_COLUMNS.join(" | "),
  ];
  for (const row of rows) {
    const values = publicAuditValues(row);
    const wrapped = values.map(wrapPdfText);
    const rowLineCount = Math.max(...wrapped.map((column) => column.length));
    for (let line = 0; line < rowLineCount; line += 1) {
      lines.push(wrapped.map((column) => column[line] ?? "").join(" | "));
    }
  }

  const pages: string[] = [];
  for (let offset = 0; offset < lines.length; offset += PDF_ROWS_PER_PAGE) {
    const pageLines = lines.slice(offset, offset + PDF_ROWS_PER_PAGE);
    const content = [
      "BT",
      "/F1 9 Tf",
      `${PDF_MARGIN} ${PDF_PAGE_HEIGHT - PDF_MARGIN - 12} Td`,
      ...pageLines.flatMap((line, index) => [
        index === 0 ? "/F1 14 Tf" : "/F1 9 Tf",
        `(${pdfText(line)}) Tj`,
        index === pageLines.length - 1 ? "" : `0 -${PDF_LINE_HEIGHT} Td`,
      ]),
      "ET",
    ].filter(Boolean).join("\n");
    pages.push(content);
  }
  if (pages.length === 0) pages.push("BT /F1 9 Tf 36 744 Td (Operational audit export) Tj ET");

  const objects: string[] = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${pages.map((_, index) => `${4 + index * 2} 0 R`).join(" ")}] /Count ${pages.length} >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  for (const content of pages) {
    const pageObjectNumber = objects.length + 1;
    const contentObjectNumber = pageObjectNumber + 1;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PDF_PAGE_WIDTH} ${PDF_PAGE_HEIGHT}] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentObjectNumber} 0 R >>`);
    objects.push(`<< /Length ${Buffer.byteLength(content, "ascii")} >>\nstream\n${content}\nendstream`);
  }

  let document = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(document, "ascii"));
    document += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(document, "ascii");
  document += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) {
    document += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  document += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(document, "ascii");
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
      const query = parseAuditExportQuery(req);
      if (query.error) {
        res.status(400).json({ error: query.error });
        return;
      }
      const rows = await selectAuditExportRows(currentScope(), query);
      const csv = [
        AUDIT_EXPORT_COLUMNS.join(","),
        ...rows.map((row) => publicAuditValues(row).map(csvCell).join(",")),
      ].join("\n");
      res.type("text/csv").send(csv);
    } catch (err) {
      req.log.error({ err }, "Failed to export audit logs");
      res.status(500).json({ error: "Failed to export audit logs" });
    }
  },
);

router.get(
  "/audit-logs/export.pdf",
  requireLiveScope,
  requireCapability("manage-staff"),
  async (req: Request, res: Response) => {
    try {
      const query = parseAuditExportQuery(req);
      if (query.error) {
        res.status(400).json({ error: query.error });
        return;
      }
      const rows = await selectAuditExportRows(currentScope(), query);
      const pdf = buildAuditPdf(rows);
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", 'attachment; filename="audit-logs.pdf"');
      res.send(pdf);
    } catch (err) {
      req.log.error({ err }, "Failed to export audit logs as PDF");
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
