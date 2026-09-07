import { and, desc, eq, gte, isNull, lte, sql } from "drizzle-orm";
import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import * as z from "zod";
import {
  aggregateDaySummary,
  type DaySummaryInput,
  type OperationalReport,
} from "@workspace/day-summary";
import {
  db,
  incidentsTable,
  inventoryItemsTable,
  inventoryLotsTable,
  inventoryLedgerTable,
  dailySyncTable,
  completedRunHistoryTable,
  syncConflictLogsTable,
  qualityChecksTable,
  finalizedOperationalReportsTable,
  serverJobsTable,
} from "@workspace/db";
import {
  deriveOperationalRunView,
  OperationalRunViewError,
  type OperationalSyncSnapshotV1,
} from "@workspace/live-calc";
import { syncSnapshotId } from "../lib/syncContract";
import { currentScope } from "../lib/requestScope";
import { requireCapability } from "../middlewares/requireCapability";
import { dataHealthWorkspace } from "./profileDataHealth";
import { Router, type IRouter } from "express";
import {
  canonicalExportFilename,
  canonicalReportCsv,
  canonicalReportPrintHtml,
  canonicalReportSnapshotId,
  canonicalReportXlsx,
  type CanonicalReportExportFormat,
} from "../lib/canonicalReportExport";
import { readServerJobArtifact } from "../lib/serverJobArtifactCache";

const router: IRouter = Router();

const RunSchema = z.object({
  brand: z.string(),
  flavor: z.string(),
  casesPlanned: z.number().finite(),
  casesProduced: z.number().finite(),
  finished: z.boolean(),
  downtimeMinutes: z.number().finite(),
  stoppageCount: z.number().finite(),
});
const BodySchema = z.object({
  scope: z.enum(["day", "week"]),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
    const parsed = new Date(`${value}T12:00:00Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }, "Invalid calendar date"),
  // Legacy callers may still send runs. Production facts always come from
  // canonical daily_sync rows, so this compatibility field is intentionally ignored.
  runs: z.array(RunSchema).max(600).optional(),
});
const CalendarDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const parsed = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, "Invalid calendar date");
const ExactFinalizedReportQuery = z.object({
  scope: z.enum(["day", "week"]),
  date: CalendarDateSchema,
}).strict();
const RangeFinalizedReportQuery = z.object({
  scope: z.enum(["day", "week"]).optional(),
  startDate: CalendarDateSchema,
  endDate: CalendarDateSchema,
  limit: z.coerce.number().int().min(1).max(100).default(100),
}).strict().refine((value) => value.startDate <= value.endDate, {
  message: "Start date must be on or before end date",
}).refine((value) => (
  new Date(`${value.endDate}T12:00:00Z`).getTime()
  - new Date(`${value.startDate}T12:00:00Z`).getTime()
) <= 365 * 24 * 60 * 60 * 1000, {
  message: "Date range cannot exceed 366 inclusive days",
});
const FinalizedReportId = z.object({ id: z.string().uuid() });

const FinalizedReportExportQuery = z.object({
  format: z.enum(["csv", "xlsx", "print"]),
  jobId: z.string().uuid().optional(),
}).strict();

const LEGACY_JSON_HASH_CONTRACT = "json-v1" as const;
const CURRENT_HASH_CONTRACT = "canonical-json-v2" as const;
const CURRENT_PROOF_CONTRACT = "hmac-sha256-v1" as const;
const FINALIZED_REPORT_KEY_HEALTH_SCAN_LIMIT = 100;
type FinalizedReportHashContract =
  | typeof LEGACY_JSON_HASH_CONTRACT
  | typeof CURRENT_HASH_CONTRACT;

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, child]) => child !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function hashSerializedReport(serialized: string): string {
  return createHash("sha256").update(serialized).digest("hex");
}

// PostgreSQL jsonb normalizes object-key order, so reading a row and calling
// JSON.stringify cannot reproduce hashes created from the pre-insert report.
// Rebuild the released v1 report shapes in their original construction order.
const LEGACY_REPORT_KEY_ORDER: Record<string, readonly string[]> = {
  report: [
    "scope", "date", "periodStart", "periodEnd", "generatedAt", "attribution",
    "freshness", "calculation", "production", "productionRows", "quality",
    "incidents", "inventory", "unresolvedActions", "narrative", "evidence",
  ],
  "report.attribution": ["generatedBy", "source"],
  "report.freshness": ["status", "asOf", "note"],
  "report.calculation": ["period", "production", "quality", "incidents", "inventory"],
  "report.production": [
    "scope", "date", "runsPlanned", "runsFinished", "casesPlanned",
    "casesProduced", "attainmentPct", "totalDowntimeMinutes", "totalStoppages",
    "topDowntime", "unfinishedRuns", "incidentCount", "wasteFlaggedCount", "hasData",
  ],
  "report.production.topDowntime": ["label", "minutes"],
  "report.productionRows[]": [
    "id", "date", "run", "status", "casesPlanned", "casesProduced",
    "attainmentPct", "downtimeMinutes", "stoppages",
  ],
  "report.quality": ["availability", "value", "note"],
  "report.quality.value": ["checks", "issues", "failed", "warnings", "rows"],
  "report.quality.value.rows[]": [
    "id", "occurredAt", "product", "status", "issues", "summary",
  ],
  "report.incidents": ["availability", "value", "note"],
  "report.incidents.value": ["total", "unresolved", "rows"],
  "report.incidents.value.rows[]": [
    "id", "occurredAt", "status", "priority", "reporter", "summary",
  ],
  "report.inventory": ["availability", "value", "note"],
  "report.inventory.value": ["flaggedItems", "rows", "historical"],
  "report.inventory.value.rows[]": [
    "id", "item", "unit", "onHand", "reorderThreshold", "state",
  ],
  "report.inventory.value.historical": ["availability", "value", "note"],
  "report.inventory.value.historical.value": [
    "totalEvents", "consumptionEvents", "wasteEvents", "adjustmentEvents",
  ],
  "report.unresolvedActions": ["availability", "value", "note"],
  "report.unresolvedActions.value": ["total", "rows"],
  "report.unresolvedActions.value.rows[]": [
    "id", "source", "priority", "action", "detail",
  ],
  "report.narrative": ["text", "source"],
  "report.evidence": ["release", "recovery"],
  "report.evidence.release": ["version", "revision", "environment"],
  "report.evidence.recovery": ["generatedAt", "source", "complete"],
};

function restoreLegacyReportKeyOrder(value: unknown, path: string): unknown {
  if (Array.isArray(value)) {
    return value.map((child) => restoreLegacyReportKeyOrder(child, `${path}[]`));
  }
  if (!value || typeof value !== "object") return value;

  const record = value as Record<string, unknown>;
  const preferredKeys = LEGACY_REPORT_KEY_ORDER[path] ?? [];
  const preferredKeySet = new Set(preferredKeys);
  const keys = [
    ...preferredKeys.filter((key) => Object.hasOwn(record, key)),
    ...Object.keys(record).filter((key) => !preferredKeySet.has(key)),
  ];
  return Object.fromEntries(keys.map((key) => [
    key,
    restoreLegacyReportKeyOrder(record[key], `${path}.${key}`),
  ]));
}

function legacyReportHash(report: unknown): string {
  return hashSerializedReport(
    JSON.stringify(restoreLegacyReportKeyOrder(report, "report")) ?? "null",
  );
}

function reportHash(report: unknown): string {
  return hashSerializedReport(canonicalJson(report));
}

type ReportSigningKeyring = {
  activeKeyId: string;
  keys: Record<string, string>;
};

function reportSigningKey(
  keyring: ReportSigningKeyring,
  keyId: string,
): string | null {
  if (!Object.hasOwn(keyring.keys, keyId)) return null;
  const key = keyring.keys[keyId];
  return typeof key === "string" && key.length >= 32 ? key : null;
}

function reportSigningKeyring(): ReportSigningKeyring | null {
  const configured = process.env.OPERATIONAL_REPORT_SIGNING_KEYS;
  if (!configured) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(configured);
  } catch {
    return null;
  }
  const result = z.object({
    activeKeyId: z.string().min(1),
    keys: z.record(z.string(), z.string().min(32)),
  }).safeParse(parsed);
  if (!result.success || !reportSigningKey(result.data, result.data.activeKeyId)) return null;
  return result.data;
}

function reportProofEnvelope(
  row: Pick<typeof finalizedOperationalReportsTable.$inferSelect,
    "id" | "scope" | "reportScope" | "periodStart" | "periodEnd" | "generatedAt"
    | "generatedBy" | "finalizedAt" | "finalizedBy" | "contentHash" | "hashContract"
    | "payload">,
): unknown {
  return {
    contentHash: row.contentHash,
    finalizedAt: row.finalizedAt.toISOString(),
    finalizedBy: row.finalizedBy,
    generatedAt: row.generatedAt.toISOString(),
    generatedBy: row.generatedBy,
    hashContract: row.hashContract,
    id: row.id,
    payload: row.payload,
    periodEnd: row.periodEnd,
    periodStart: row.periodStart,
    reportScope: row.reportScope,
    scope: row.scope,
  };
}

function signFinalizedReport(
  row: Parameters<typeof reportProofEnvelope>[0],
  key: string,
): string {
  return createHmac("sha256", key)
    .update(canonicalJson(reportProofEnvelope(row)))
    .digest("hex");
}

function signaturesMatch(actual: string, expected: string): boolean {
  const actualBuffer = Buffer.from(actual, "hex");
  const expectedBuffer = Buffer.from(expected, "hex");
  return actualBuffer.length === 32
    && expectedBuffer.length === actualBuffer.length
    && timingSafeEqual(actualBuffer, expectedBuffer);
}

type FinalizedReportIntegrity =
  | {
      ok: true;
      actualHash: string;
      hashContract: FinalizedReportHashContract;
      proofContract: typeof CURRENT_PROOF_CONTRACT | null;
      proofKeyId: string | null;
      proofStatus: "verified" | "unsigned-legacy";
    }
  | {
      ok: false;
      actualHashes: Record<FinalizedReportHashContract, string>;
      proofStatus: "invalid" | "key-unavailable";
    };

function finalizedReportIntegrity(
  row: typeof finalizedOperationalReportsTable.$inferSelect,
): FinalizedReportIntegrity {
  if (
    row.hashContract !== null
    && row.hashContract !== CURRENT_HASH_CONTRACT
    && row.hashContract !== LEGACY_JSON_HASH_CONTRACT
  ) {
    return {
      ok: false,
      actualHashes: {
        [CURRENT_HASH_CONTRACT]: "not-computed-for-unrecognized-contract",
        [LEGACY_JSON_HASH_CONTRACT]: "not-computed-for-unrecognized-contract",
      },
      proofStatus: "invalid",
    };
  }

  const canonicalHash = row.hashContract === LEGACY_JSON_HASH_CONTRACT
    ? "not-computed-for-json-v1-contract"
    : reportHash(row.payload);
  const legacyHash = row.hashContract === CURRENT_HASH_CONTRACT
    ? "not-computed-for-canonical-json-v2-contract"
    : legacyReportHash(row.payload);
  const actualHashes = {
    [CURRENT_HASH_CONTRACT]: canonicalHash,
    [LEGACY_JSON_HASH_CONTRACT]: legacyHash,
  };
  const hasAnyProof = Boolean(row.proofContract || row.proofKeyId || row.proofSignature);
  if (hasAnyProof) {
    if (
      row.proofContract !== CURRENT_PROOF_CONTRACT
      || !row.proofKeyId
      || !row.proofSignature
      || row.hashContract !== CURRENT_HASH_CONTRACT
      || canonicalHash !== row.contentHash
    ) {
      return { ok: false, actualHashes, proofStatus: "invalid" };
    }
    const keyring = reportSigningKeyring();
    const key = keyring ? reportSigningKey(keyring, row.proofKeyId) : null;
    if (!key) return { ok: false, actualHashes, proofStatus: "key-unavailable" };
    const expectedSignature = signFinalizedReport(row, key);
    if (!signaturesMatch(row.proofSignature, expectedSignature)) {
      return { ok: false, actualHashes, proofStatus: "invalid" };
    }
    return {
      ok: true,
      actualHash: canonicalHash,
      hashContract: CURRENT_HASH_CONTRACT,
      proofContract: CURRENT_PROOF_CONTRACT,
      proofKeyId: row.proofKeyId,
      proofStatus: "verified",
    };
  }
  if (
    (row.hashContract === CURRENT_HASH_CONTRACT || row.hashContract === null)
    && canonicalHash === row.contentHash
  ) {
    return {
      ok: true,
      actualHash: canonicalHash,
      hashContract: CURRENT_HASH_CONTRACT,
      proofContract: null,
      proofKeyId: null,
      proofStatus: "unsigned-legacy",
    };
  }
  if (
    (row.hashContract === LEGACY_JSON_HASH_CONTRACT || row.hashContract === null)
    && legacyHash === row.contentHash
  ) {
    return {
      ok: true,
      actualHash: legacyHash,
      hashContract: LEGACY_JSON_HASH_CONTRACT,
      proofContract: null,
      proofKeyId: null,
      proofStatus: "unsigned-legacy",
    };
  }
  return {
    ok: false,
    actualHashes,
    proofStatus: "invalid",
  };
}

async function persistVerifiedHashContract(
  row: typeof finalizedOperationalReportsTable.$inferSelect,
  integrity: Extract<FinalizedReportIntegrity, { ok: true }>,
): Promise<void> {
  if (row.hashContract !== null) return;
  await db.update(finalizedOperationalReportsTable)
    .set({ hashContract: integrity.hashContract })
    .where(and(
      eq(finalizedOperationalReportsTable.id, row.id),
      eq(finalizedOperationalReportsTable.scope, row.scope),
      isNull(finalizedOperationalReportsTable.hashContract),
    ));
}

async function verifiedFinalizedReportIntegrity(
  row: typeof finalizedOperationalReportsTable.$inferSelect,
): Promise<FinalizedReportIntegrity> {
  const integrity = finalizedReportIntegrity(row);
  if (integrity.ok) await persistVerifiedHashContract(row, integrity);
  return integrity;
}

function finalizedReportResponse(
  row: typeof finalizedOperationalReportsTable.$inferSelect,
  integrity: Extract<FinalizedReportIntegrity, { ok: true }>,
) {
  return {
    id: row.id,
    scope: row.scope,
    reportScope: row.reportScope,
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
    generatedAt: row.generatedAt.toISOString(),
    generatedBy: row.generatedBy,
    finalizedAt: row.finalizedAt.toISOString(),
    finalizedBy: row.finalizedBy,
    contentHash: row.contentHash,
    hashContract: integrity.hashContract,
    proofContract: integrity.proofContract,
    proofKeyId: integrity.proofKeyId,
    proofStatus: integrity.proofStatus,
    report: row.payload as OperationalReport,
  };
}

const finalizedReportMetadataColumns = {
  id: finalizedOperationalReportsTable.id,
  reportScope: finalizedOperationalReportsTable.reportScope,
  periodStart: finalizedOperationalReportsTable.periodStart,
  periodEnd: finalizedOperationalReportsTable.periodEnd,
  generatedAt: finalizedOperationalReportsTable.generatedAt,
  generatedBy: finalizedOperationalReportsTable.generatedBy,
  finalizedAt: finalizedOperationalReportsTable.finalizedAt,
  finalizedBy: finalizedOperationalReportsTable.finalizedBy,
  contentHash: finalizedOperationalReportsTable.contentHash,
  hashContract: finalizedOperationalReportsTable.hashContract,
  proofContract: finalizedOperationalReportsTable.proofContract,
  proofKeyId: finalizedOperationalReportsTable.proofKeyId,
  proofSignature: finalizedOperationalReportsTable.proofSignature,
};

function finalizedReportMetadata(
  row: {
    [K in keyof typeof finalizedReportMetadataColumns]:
      typeof finalizedOperationalReportsTable.$inferSelect[K];
  },
  integrity?: FinalizedReportIntegrity,
) {
  const hasAnyProof = Boolean(row.proofContract || row.proofKeyId || row.proofSignature);
  const completeKnownProof = row.proofContract === CURRENT_PROOF_CONTRACT
    && Boolean(row.proofKeyId && row.proofSignature);
  const keyring = reportSigningKeyring();
  const proofKeyAvailable = completeKnownProof && row.proofKeyId && keyring
    ? Boolean(reportSigningKey(keyring, row.proofKeyId))
    : false;
  return {
    id: row.id,
    reportScope: row.reportScope,
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
    generatedAt: row.generatedAt.toISOString(),
    generatedBy: row.generatedBy,
    finalizedAt: row.finalizedAt.toISOString(),
    finalizedBy: row.finalizedBy,
    contentHash: row.contentHash,
    hashContract: integrity
      ? integrity.ok ? integrity.hashContract : "unrecognized"
      : row.hashContract === CURRENT_HASH_CONTRACT
        || row.hashContract === LEGACY_JSON_HASH_CONTRACT
        ? row.hashContract
        : "unrecognized",
    proofContract: integrity?.ok
      ? integrity.proofContract
      : row.proofContract === CURRENT_PROOF_CONTRACT
        ? row.proofContract
        : null,
    proofKeyId: row.proofKeyId,
    proofStatus: integrity?.proofStatus ?? (
      !hasAnyProof
        ? "unsigned-legacy"
        : !completeKnownProof
          ? "invalid"
          : proofKeyAvailable
            ? "not-checked"
            : "key-unavailable"
    ),
  };
}

function sendFinalizedReportIntegrityError(
  req: import("express").Request,
  res: import("express").Response,
  row: typeof finalizedOperationalReportsTable.$inferSelect,
  integrity: Extract<FinalizedReportIntegrity, { ok: false }>,
): void {
  req.log.error({
    event: "finalized_report_integrity_failed",
    scope: row.scope,
    reportId: row.id,
    expectedHash: row.contentHash,
    actualHashes: integrity.actualHashes,
    proofStatus: integrity.proofStatus,
  }, "Finalized operational report failed integrity verification");
  operationalError(
    res,
    409,
    "finalized-report-integrity-failure",
    "The finalized report failed integrity verification and cannot be exported.",
  );
}

function addDays(iso: string, amount: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + amount);
  return d.toISOString().slice(0, 10);
}

export function dateRange(scope: "day" | "week", date: string): [string, string] {
  return scope === "week" ? [addDays(date, -6), date] : [date, date];
}

function datesInRange(start: string, end: string): string[] {
  const dates: string[] = [];
  for (let date = start; date <= end; date = addDays(date, 1)) dates.push(date);
  return dates;
}

export type OperationalReportValidationResult =
  | { ok: true; data: z.infer<typeof BodySchema> }
  | { ok: false; status: number; error: string };

export function validateOperationalReportBody(
  body: unknown,
): OperationalReportValidationResult {
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return { ok: false, status: 400, error: "Invalid operational report input" };
  }
  return { ok: true, data: parsed.data };
}

const OperationalViewQuery = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
    const parsed = new Date(`${value}T12:00:00Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }, "Invalid calendar date"),
  runId: z.string().min(1).max(500),
});

/** Adds transport metadata without modifying the durable canonical JSON payload. */
export function adaptCanonicalOperationalSnapshot(data: unknown): OperationalSyncSnapshotV1 | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  return ({
    ...(data as Record<string, unknown>),
    syncVersion: 1,
    completeness: "complete",
  } as OperationalSyncSnapshotV1);
}

function operationalError(res: import("express").Response, status: number, code: string, message: string): void {
  res.status(status).json({ error: { code, message } });
}

/** Capability middleware authenticates the caller; this binds a retained file
 * to that caller's facility, completed job, report snapshot, and format. */
export function retainedExportIsAuthorized(
  job: { scope: string; type: string; status: string; input: unknown; result?: unknown } | undefined,
  scope: string,
  finalizedReportId: string,
  format: CanonicalReportExportFormat,
  canonicalSnapshotId: string,
  contentHash: string,
): boolean {
  const input = job?.input as { finalizedReportId?: unknown; format?: unknown } | undefined;
  const result = job?.result as { canonicalSnapshotId?: unknown; contentHash?: unknown; artifactSha256?: unknown } | undefined;
  return job?.scope === scope && job.type === "export-package" && job.status === "succeeded"
    && input?.finalizedReportId === finalizedReportId && input.format === format
    && result?.canonicalSnapshotId === canonicalSnapshotId && result.contentHash === contentHash
    && typeof result.artifactSha256 === "string" && /^[a-f0-9]{64}$/.test(result.artifactSha256);
}
function viewToSummaryRun(view: ReturnType<typeof deriveOperationalRunView>): DaySummaryInput["runs"][number] {
  return {
    brand: view.observed.brand,
    flavor: view.observed.flavor,
    casesPlanned: view.recap.casesNeeded,
    casesProduced: view.recap.casesCompleted,
    finished: view.observed.status === "ended",
    downtimeMinutes: view.observed.stoppages.downtimeSeconds / 60,
    stoppageCount: view.observed.stoppages.count,
  };
}

function pct(produced: number, planned: number): number {
  return planned > 0 ? Math.max(0, Math.round((produced / planned) * 100)) : 0;
}
type HandoffSeverity = "urgent" | "high" | "medium" | "low" | "info";
type HandoffStatus = "open" | "reviewed" | "resolved" | "historical" | "current";
type HandoffSource = "incidents" | "quality" | "inventory" | "sync" | "data-health";
type HandoffItem = {
  id: string; source: HandoffSource; severity: HandoffSeverity; status: HandoffStatus;
  title: string; detail: string; affectedRun: string | null; affectedProduct: string | null;
  occurredAt: string | null; sourcePath: string; historical: boolean;
  attentionState: "blocker" | "review" | "stale" | "info"; nextAction: string;
};
type ShiftHandoffDigest = {
  scope: string; date: string; generatedAt: string; items: HandoffItem[];
  sources: Record<HandoffSource, { availability: "available" | "unavailable"; note?: string; itemCount: number }>;
};
const HandoffQuery = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) });
const safeDate = (value: Date | string | null | undefined): string | null => {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
};
const inventorySeverity = (qty: number, threshold: number): HandoffSeverity =>
  qty <= 0 ? "urgent" : threshold > 0 && qty <= threshold ? "high" : "medium";
const handoffAttention = (severity: HandoffSeverity, status: HandoffStatus): HandoffItem["attentionState"] =>
  status === "historical" ? "stale" : severity === "urgent" || severity === "high" ? "blocker" : severity === "info" ? "info" : "review";
const handoffNextAction = (state: HandoffItem["attentionState"], status: HandoffStatus): string =>
  status === "historical" ? "Review when convenient" : state === "blocker" ? "Act now" : state === "review" ? "Review and decide" : "Monitor";

router.get("/reports/handoff", requireCapability("review-incidents"), async (req, res): Promise<void> => {
  const parsed = HandoffQuery.safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: "A valid production date is required" }); return; }
  const date = parsed.data.date;
  const scope = currentScope();
  const start = new Date(`${date}T00:00:00.000Z`);
  const end = new Date(`${date}T23:59:59.999Z`);
  const unavailable = (note: string) => ({ availability: "unavailable" as const, note, itemCount: 0 });
  const sources: ShiftHandoffDigest["sources"] = {
    incidents: unavailable("Incident history is unavailable."),
    quality: unavailable("Quality history is unavailable."),
    inventory: unavailable("Inventory history is unavailable."),
    sync: unavailable("Sync history is unavailable."),
    "data-health": unavailable("Data-health review is unavailable."),
  };
  const items: HandoffItem[] = [];
  const [incidents, quality, inventory, sync, health] = await Promise.all([
    db.select().from(incidentsTable).where(and(eq(incidentsTable.scope, scope), gte(incidentsTable.createdAt, start), lte(incidentsTable.createdAt, end))).catch(() => null),
    db.select().from(qualityChecksTable).where(and(eq(qualityChecksTable.scope, scope), gte(qualityChecksTable.createdAt, start), lte(qualityChecksTable.createdAt, end))).catch(() => null),
    Promise.all([
      db.select().from(inventoryItemsTable).where(eq(inventoryItemsTable.scope, scope)),
      db.select().from(inventoryLotsTable).where(eq(inventoryLotsTable.scope, scope)),
      db.select().from(inventoryLedgerTable).where(and(eq(inventoryLedgerTable.scope, scope), gte(inventoryLedgerTable.createdAt, start), lte(inventoryLedgerTable.createdAt, end))),
    ]).catch(() => null),
    db.select().from(syncConflictLogsTable).where(and(eq(syncConflictLogsTable.scope, scope), eq(syncConflictLogsTable.date, date))).catch(() => null),
    dataHealthWorkspace(db).catch(() => null),
  ]);
  if (incidents) {
    const open = incidents.filter((row) => row.status !== "resolved");
    sources.incidents = { availability: "available", itemCount: open.length };
    for (const row of open) {
      const context = row.context && typeof row.context === "object" ? row.context as Record<string, unknown> : {};
      const status = row.workflowState === "resolved" ? "resolved" : row.status === "reviewed" ? "reviewed" : "open";
      const severity = row.priority === "urgent" ? "urgent" : row.priority === "high" ? "high" : row.priority === "low" ? "low" : "medium";
      const state = handoffAttention(severity, status);
      items.push({ id: `incident:${row.id}`, source: "incidents", severity, status, title: row.source === "auto_crash" ? "Auto-captured crash" : "Reported issue", detail: String(context.description ?? context.errorMessage ?? row.diagnosis ?? "Incident requires manager review."), affectedRun: typeof context.runId === "string" ? context.runId : null, affectedProduct: typeof context.product === "string" ? context.product : null, occurredAt: safeDate(row.createdAt), sourcePath: "incidents", historical: false, attentionState: state, nextAction: handoffNextAction(state, status) });
    }
  }
  if (quality) {
    const exceptions = quality.filter((row) => row.status === "warn" || row.status === "fail");
    sources.quality = { availability: "available", itemCount: exceptions.length };
     for (const row of exceptions) { const state = handoffAttention(row.status === "fail" ? "high" : "medium", "historical"); items.push({ id: `quality:${row.id}`, source: "quality", severity: row.status === "fail" ? "high" : "medium", status: "historical", title: `${row.productType} quality exception`, detail: row.summary || `${Array.isArray(row.issues) ? row.issues.length : 0} issue(s) recorded.`, affectedRun: null, affectedProduct: row.productType, occurredAt: safeDate(row.createdAt), sourcePath: "quality", historical: true, attentionState: state, nextAction: handoffNextAction(state, "historical") }); }
  }
  if (inventory) {
    const [inventoryItems, lots, ledger] = inventory;
    const onHand = new Map<number, number>();
    for (const lot of lots) onHand.set(lot.itemId, (onHand.get(lot.itemId) ?? 0) + lot.qtyRemaining);
    const risk = inventoryItems.filter((item) => item.reorderThreshold > 0 && (onHand.get(item.id) ?? 0) <= item.reorderThreshold);
    const waste = ledger.filter((row) => row.type === "adjust" && row.qtyDelta < 0);
    sources.inventory = { availability: "available", itemCount: risk.length + waste.length };
     for (const item of risk) { const severity = inventorySeverity(onHand.get(item.id) ?? 0, item.reorderThreshold); const state = handoffAttention(severity, "current"); items.push({ id: `inventory-risk:${item.id}`, source: "inventory", severity, status: "current", title: `${item.name} is at or below reorder level`, detail: `${onHand.get(item.id) ?? 0} ${item.unit} on hand; reorder level is ${item.reorderThreshold} ${item.unit}.`, affectedRun: null, affectedProduct: item.name, occurredAt: safeDate(item.updatedAt), sourcePath: "inventory", historical: false, attentionState: state, nextAction: handoffNextAction(state, "current") }); }
     for (const row of waste) { const item = inventoryItems.find((candidate) => candidate.id === row.itemId); const state = handoffAttention("medium", "historical"); items.push({ id: `inventory-ledger:${row.id}`, source: "inventory", severity: "medium", status: "historical", title: `${item?.name ?? "Inventory item"} adjustment`, detail: `${Math.abs(row.qtyDelta)} ${item?.unit ?? "units"} removed${row.note ? ` — ${row.note}` : ""}.`, affectedRun: row.runId, affectedProduct: item?.name ?? null, occurredAt: safeDate(row.createdAt), sourcePath: "inventory", historical: true, attentionState: state, nextAction: handoffNextAction(state, "historical") }); }
  }
  if (sync) {
    sources.sync = { availability: "available", itemCount: sync.length };
     for (const row of sync) { const state = handoffAttention(row.conflictCount > 3 ? "high" : "medium", "historical"); items.push({ id: `sync:${row.id}`, source: "sync", severity: row.conflictCount > 3 ? "high" : "medium", status: "historical", title: "Sync conflict recorded", detail: `${row.conflictCount} conflict${row.conflictCount === 1 ? "" : "s"} resolved by ${row.resolution}.`, affectedRun: null, affectedProduct: null, occurredAt: safeDate(row.createdAt), sourcePath: "sync", historical: true, attentionState: state, nextAction: handoffNextAction(state, "historical") }); }
  }
  if (health) {
    const pending = health.findings.filter((finding) => finding.repairability === "review" || finding.severity !== "info");
    sources["data-health"] = { availability: "available", itemCount: pending.length };
     for (const finding of pending) { const severity = finding.severity === "error" ? "high" : finding.severity === "warning" ? "medium" : "info"; const state = handoffAttention(severity, "open"); items.push({ id: `data-health:${finding.id}`, source: "data-health", severity, status: "open", title: `${finding.brand || "Unbranded"} — ${finding.recipe}`, detail: finding.message, affectedRun: null, affectedProduct: [finding.brand, finding.flavor].filter(Boolean).join(" / ") || null, occurredAt: null, sourcePath: "data-health", historical: false, attentionState: state, nextAction: handoffNextAction(state, "open") }); }
  }
  const severityOrder: Record<HandoffSeverity, number> = { urgent: 0, high: 1, medium: 2, low: 3, info: 4 };
  items.sort((a, b) =>
    severityOrder[a.severity] - severityOrder[b.severity]
    || (Date.parse(b.occurredAt ?? "") || 0) - (Date.parse(a.occurredAt ?? "") || 0)
    || a.id.localeCompare(b.id),
  );
  res.json({ scope, date, generatedAt: new Date().toISOString(), items, sources } satisfies ShiftHandoffDigest);
});

// A point-in-time, server-derived operational read model. It deliberately reads
// one scoped canonical row rather than accepting a browser snapshot.
router.get(
  "/reports/operational-view",
  requireCapability("review-incidents"),
  async (req, res): Promise<void> => {
    const parsed = OperationalViewQuery.safeParse(req.query);
    if (!parsed.success) {
      operationalError(res, 400, "invalid-query", "Valid date and runId query parameters are required.");
      return;
    }
    const { date, runId } = parsed.data;
    const scope = currentScope();
    // An ended run has an immutable completion snapshot. Prefer it over the
    // mutable active-day document so later sync/reset activity cannot rewrite a
    // historical operational view.
    const completed = await db.select().from(completedRunHistoryTable).where(and(
      eq(completedRunHistoryTable.scope, scope),
      eq(completedRunHistoryTable.date, date),
      eq(completedRunHistoryTable.runId, runId),
    ));
    const rows = completed.length === 0 ? await db.select().from(dailySyncTable).where(and(
      eq(dailySyncTable.scope, scope),
      eq(dailySyncTable.date, date),
    )) : [];
    if (completed.length > 1) {
      operationalError(res, 409, "snapshot-ambiguous", "More than one immutable completion exists for this run.");
      return;
    }
    if (completed.length === 1) {
      const row = completed[0];
      const snapshot = adaptCanonicalOperationalSnapshot(row.snapshot);
      if (!snapshot) { operationalError(res, 400, "invalid-snapshot", "The immutable completion is not an object."); return; }
      try {
        res.json(deriveOperationalRunView({
          snapshot, date, runId, nowMs: Date.now(),
          snapshotMetadata: { snapshotId: row.snapshotHash, capturedAt: row.completedAt.getTime(), date },
        }));
        return;
      } catch (error) {
        const code = error instanceof OperationalRunViewError ? error.code : "derivation-failed";
        operationalError(res, code === "missing-run" ? 404 : 400, code, error instanceof Error ? error.message : "Invalid immutable completion.");
        return;
      }
    }
    if (rows.length === 0) {
      operationalError(res, 404, "snapshot-not-found", "No canonical snapshot exists for this date.");
      return;
    }
    if (rows.length !== 1) {
      operationalError(res, 409, "snapshot-ambiguous", "More than one canonical snapshot exists for this date.");
      return;
    }
    const row = rows[0];
    const snapshot = adaptCanonicalOperationalSnapshot(row.data);
    if (!snapshot) {
      operationalError(res, 400, "invalid-snapshot", "The canonical snapshot is not an object.");
      return;
    }
    const resetAt = (snapshot.dayState as { resetAt?: unknown } | undefined)?.resetAt;
    if (resetAt !== undefined && (typeof resetAt !== "number" || !Number.isFinite(resetAt) || resetAt < 0)) {
      operationalError(res, 409, "reset-ambiguity", "The canonical snapshot has an ambiguous reset generation.");
      return;
    }
    const nowMs = Date.now();
    try {
      const view = deriveOperationalRunView({
        snapshot,
        date,
        runId,
        nowMs,
        snapshotMetadata: {
          snapshotId: syncSnapshotId(row.data),
          capturedAt: row.updatedAt.getTime(),
          date,
          ...(typeof resetAt === "number" ? { resetAt } : {}),
        },
      });
      req.log.info({
        event: "operational_view_derived",
        scope,
        date,
        runId,
        status: view.observed.status,
        runCount: snapshot.dayState.runs.length,
        stoppageCount: view.observed.stoppages.count,
      }, "Operational view derived");
      res.json(view);
    } catch (error) {
      if (error instanceof OperationalRunViewError) {
        const status = error.code === "missing-run" ? 404
          : error.code === "duplicate-run" || error.code === "reset-mismatch" ? 409 : 400;
        req.log.info({
          event: "operational_view_rejected",
          scope,
          date,
          runId,
          status: error.code,
          runCount: Array.isArray(snapshot.dayState?.runs) ? snapshot.dayState.runs.length : 0,
        }, "Operational view rejected");
        operationalError(res, status, error.code, error.message);
        return;
      }
      throw error;
    }
  },
);

router.post(
  ["/reports/operational", "/reports/operational/finalize"],
  requireCapability("review-incidents"),
  async (req, res): Promise<void> => {
    const parsed = validateOperationalReportBody(req.body);
    if (!parsed.ok) {
      res.status(parsed.status).json({ error: parsed.error });
      return;
    }
    const input = parsed.data;
    const [periodStart, periodEnd] = dateRange(input.scope, input.date);
    const scope = currentScope();
    const [qualityRows, incidentRows, inventoryRows, lots, syncRows, completionRows] = await Promise.all([
      db.select().from(qualityChecksTable).where(
        and(
          eq(qualityChecksTable.scope, scope),
          gte(qualityChecksTable.createdAt, new Date(`${periodStart}T00:00:00Z`)),
          lte(qualityChecksTable.createdAt, new Date(`${periodEnd}T23:59:59.999Z`)),
        ),
      ),
      db.select().from(incidentsTable).where(
        and(
          eq(incidentsTable.scope, scope),
          gte(incidentsTable.createdAt, new Date(`${periodStart}T00:00:00Z`)),
          lte(incidentsTable.createdAt, new Date(`${periodEnd}T23:59:59.999Z`)),
        ),
      ),
      db.select().from(inventoryItemsTable).where(eq(inventoryItemsTable.scope, scope)),
      db.select().from(inventoryLotsTable).where(eq(inventoryLotsTable.scope, scope)),
      db.select().from(dailySyncTable).where(and(
        eq(dailySyncTable.scope, scope),
        gte(dailySyncTable.date, periodStart),
        lte(dailySyncTable.date, periodEnd),
      )),
      db.select().from(completedRunHistoryTable).where(and(
        eq(completedRunHistoryTable.scope, scope),
        gte(completedRunHistoryTable.date, periodStart),
        lte(completedRunHistoryTable.date, periodEnd),
      )),
    ]);
    let historicalInventory: NonNullable<
      NonNullable<OperationalReport["inventory"]["value"]>["historical"]
    >;
    try {
      const ledgerRows = await db.select().from(inventoryLedgerTable).where(
        and(
          eq(inventoryLedgerTable.scope, scope),
          gte(inventoryLedgerTable.createdAt, new Date(`${periodStart}T00:00:00Z`)),
          lte(inventoryLedgerTable.createdAt, new Date(`${periodEnd}T23:59:59.999Z`)),
        ),
      );
      historicalInventory = {
        availability: "available",
        value: {
          totalEvents: ledgerRows.length,
          consumptionEvents: ledgerRows.filter((row) => row.type === "consume").length,
          wasteEvents: ledgerRows.filter((row) => row.type === "adjust" && row.qtyDelta < 0).length,
          adjustmentEvents: ledgerRows.filter((row) => row.type === "adjust").length,
        },
        note: "Historical inventory ledger events recorded during this period.",
      };
    } catch {
      historicalInventory = {
        availability: "unavailable",
        value: null,
        note: "Historical inventory ledger is unavailable; no historical event totals are shown.",
      };
    }
    const onHand = new Map<number, number>();
    for (const lot of lots) onHand.set(lot.itemId, (onHand.get(lot.itemId) ?? 0) + lot.qtyRemaining);
    const flaggedItems = inventoryRows.filter(
      (item) => item.reorderThreshold > 0 && (onHand.get(item.id) ?? 0) <= item.reorderThreshold,
    ).length;
    const qualityIssues = qualityRows.reduce((n, row) => n + (Array.isArray(row.issues) ? row.issues.length : 0), 0);
    // Do not trust compatibility `input.runs`: production facts are derived
    // from immutable completed records for ended historical runs. The mutable
    // daily_sync document remains the source only for the active/current day.
    const nowMs = Date.now();
    const canonicalRuns: DaySummaryInput["runs"] = [];
    const productionRows: NonNullable<OperationalReport["productionRows"]> = [];
    const snapshotTimes: number[] = [];
    const mutableSnapshotTimes: number[] = [];
    let canonicalFailure: { date: string; code: string } | null = null;
    const expectedDates = datesInRange(periodStart, periodEnd);
    type ReportSnapshot = {
      date: string;
      data: unknown;
      updatedAt: Date;
      source: "active" | "completed";
      completedRunId?: string;
    };
    const rowsByDate = new Map<string, ReportSnapshot[]>();
    const completedRunKeys = new Set(
      completionRows.map((row) => `${row.date}\u0000${row.runId}`),
    );
    for (const row of syncRows) {
      const rows = rowsByDate.get(row.date) ?? [];
      rows.push({ date: row.date, data: row.data, updatedAt: row.updatedAt, source: "active" });
      rowsByDate.set(row.date, rows);
    }
    for (const row of completionRows) {
      const rows = rowsByDate.get(row.date) ?? [];
      rows.push({
        date: row.date,
        data: row.snapshot,
        updatedAt: row.completedAt,
        source: "completed",
        completedRunId: row.runId,
      });
      rowsByDate.set(row.date, rows);
    }
    for (const date of expectedDates) {
      const rows = rowsByDate.get(date) ?? [];
      if (rows.length === 0) {
        canonicalFailure = {
          date,
          code: "snapshot-not-found",
        };
        break;
      }
    }
    for (const rows of rowsByDate.values()) for (const row of rows) {
      if (canonicalFailure) break;
      const snapshot = adaptCanonicalOperationalSnapshot(row.data);
      snapshotTimes.push(row.updatedAt.getTime());
      if (row.source === "active") mutableSnapshotTimes.push(row.updatedAt.getTime());
      if (!snapshot || !Array.isArray(snapshot.dayState?.runs)) {
        canonicalFailure = { date: row.date, code: "invalid-snapshot" };
        break;
      }
      const resetAt = (snapshot.dayState as { resetAt?: unknown }).resetAt;
      if (
        resetAt !== undefined
        && (typeof resetAt !== "number" || !Number.isFinite(resetAt) || resetAt < 0)
      ) {
        canonicalFailure = { date: row.date, code: "reset-ambiguity" };
        break;
      }
      const runs = row.source === "completed"
        ? snapshot.dayState.runs.filter((run) => run?.id === row.completedRunId)
        : snapshot.dayState.runs;
      if (row.source === "completed" && runs.length !== 1) {
        canonicalFailure = { date: row.date, code: "missing-run" };
        break;
      }
      for (const rawRun of runs) {
        if (!rawRun || typeof rawRun.id !== "string" || !rawRun.id) {
          canonicalFailure = { date: row.date, code: "invalid-run" };
          break;
        }
        if (
          row.source === "active"
          && completedRunKeys.has(`${row.date}\u0000${rawRun.id}`)
        ) continue;
        try {
          const summaryRun = viewToSummaryRun(deriveOperationalRunView({
            snapshot,
            date: row.date,
            runId: rawRun.id,
            nowMs,
            snapshotMetadata: {
              snapshotId: syncSnapshotId(row.data),
              capturedAt: row.updatedAt.getTime(),
              date: row.date,
              ...(typeof resetAt === "number" ? { resetAt } : {}),
            },
          }));
          canonicalRuns.push(summaryRun);
          productionRows.push({
            id: `${row.date}:${rawRun.id}`,
            date: row.date,
            run: [summaryRun.brand, summaryRun.flavor].filter(Boolean).join(" ") || "Unnamed run",
            status: summaryRun.finished ? "finished" : "unfinished",
            casesPlanned: summaryRun.casesPlanned,
            casesProduced: summaryRun.casesProduced,
            attainmentPct: pct(summaryRun.casesProduced, summaryRun.casesPlanned),
            downtimeMinutes: summaryRun.downtimeMinutes,
            stoppages: summaryRun.stoppageCount,
          });
        } catch (error) {
          canonicalFailure = {
            date: row.date,
            code: error instanceof OperationalRunViewError
              ? error.code
              : "derivation-failed",
          };
          break;
        }
      }
      if (canonicalFailure) break;
    }
    if (canonicalFailure) {
      req.log.warn({
        event: "operational_report_canonical_rejected",
        scope,
        date: canonicalFailure.date,
        code: canonicalFailure.code,
        acceptedRunCount: canonicalRuns.length,
      }, "Canonical operational report input was invalid");
      operationalError(
        res,
        409,
        "canonical-snapshot-invalid",
        "Canonical production facts are incomplete or ambiguous; no authoritative report was generated.",
      );
      return;
    }
    productionRows.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
    const productionInput: DaySummaryInput = {
      scope: input.scope,
      date: input.date,
      runs: canonicalRuns,
      incidentCount: incidentRows.length,
      wasteFlaggedCount: flaggedItems,
    };

    const qualityDetailRows = qualityRows.map((row) => ({
      id: String(row.id),
      occurredAt: row.createdAt.toISOString(),
      product: row.productType,
      status: row.status,
      issues: Array.isArray(row.issues) ? row.issues.length : 0,
      summary: row.summary ?? "",
    })).sort((a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.id.localeCompare(b.id));
    const incidentDetailRows = incidentRows.map((row) => {
      const context = row.context && typeof row.context === "object"
        ? row.context as Record<string, unknown> : {};
      return {
        id: row.id,
        occurredAt: row.createdAt.toISOString(),
        status: row.status,
        priority: row.priority,
        reporter: row.reporterName ?? "Unknown reporter",
        summary: String(context.description ?? context.errorMessage ?? row.diagnosis ?? "Incident requires review."),
      };
    }).sort((a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.id.localeCompare(b.id));
    const inventoryDetailRows = inventoryRows
      .map((item) => ({
        id: String(item.id),
        item: item.name,
        unit: item.unit,
        onHand: onHand.get(item.id) ?? 0,
        reorderThreshold: item.reorderThreshold,
        state: item.reorderThreshold > 0 && (onHand.get(item.id) ?? 0) <= item.reorderThreshold
          ? "at-or-below-reorder" : "ok",
      }))
      .filter((row) => row.state !== "ok")
      .sort((a, b) => a.item.localeCompare(b.item) || a.id.localeCompare(b.id));
    const unresolvedRows: NonNullable<OperationalReport["unresolvedActions"]>["value"] extends infer V
      ? V extends { rows: infer R } ? R : never : never = [
      ...productionRows.filter((row) => row.status === "unfinished").map((row) => ({
        id: `production:${row.id}`, source: "production" as const, priority: "high",
        action: "Complete or close the production run", detail: `${row.run}: ${row.casesProduced}/${row.casesPlanned} cases.`,
      })),
      ...qualityDetailRows.filter((row) => row.status === "warn" || row.status === "fail").map((row) => ({
        id: `quality:${row.id}`, source: "quality" as const, priority: row.status === "fail" ? "high" : "medium",
        action: "Review quality exception", detail: `${row.product}: ${row.summary || `${row.issues} issue(s)`}.`,
      })),
      ...incidentDetailRows.filter((row) => row.status !== "resolved").map((row) => ({
        id: `incident:${row.id}`, source: "incident" as const, priority: row.priority,
        action: "Resolve incident", detail: row.summary,
      })),
      ...inventoryDetailRows.map((row) => ({
        id: `inventory:${row.id}`, source: "inventory" as const, priority: row.onHand <= 0 ? "urgent" : "high",
        action: "Replenish inventory", detail: `${row.item}: ${row.onHand} ${row.unit} on hand; reorder at ${row.reorderThreshold}.`,
      })),
    ];
    const latestSnapshot = snapshotTimes.length ? Math.max(...snapshotTimes) : Date.now();
    const generatedAt = new Date().toISOString();
    const oldestMutableSnapshot = mutableSnapshotTimes.length ? Math.min(...mutableSnapshotTimes) : null;
    const report: OperationalReport & {
      evidence: {
        release: { version: string; revision: string; environment: string };
        recovery: { generatedAt: string; source: "live-database"; complete: boolean };
      };
    } = {
      scope: input.scope,
      date: input.date,
      periodStart,
      periodEnd,
      generatedAt,
      attribution: { generatedBy: req.userId ?? "authenticated manager", source: "canonical-server" },
      freshness: {
        status: oldestMutableSnapshot !== null && Date.now() - oldestMutableSnapshot > 5 * 60_000 ? "stale" : "current",
        asOf: new Date(latestSnapshot).toISOString(),
        note: oldestMutableSnapshot === null
          ? "Production is based on immutable completed-run records."
          : "Production freshness is based on the oldest mutable canonical snapshot in the selected period.",
      },
      calculation: {
        period: `${periodStart} through ${periodEnd}, inclusive (UTC production dates).`,
        production: "Canonical completed-run records plus the active daily snapshot; completed runs are counted once.",
        quality: "Quality checks created during the selected period.",
        incidents: "Incidents created during the selected period; unresolved excludes resolved records.",
        inventory: "Current on-hand lots compared with reorder thresholds; ledger events are limited to the selected period.",
      },
      production: aggregateDaySummary(productionInput),
      productionRows,
      quality: {
        availability: "available",
        value: {
          checks: qualityRows.length,
          issues: qualityIssues,
          failed: qualityRows.filter((r) => r.status === "fail").length,
          warnings: qualityRows.filter((r) => r.status === "warn").length,
          rows: qualityDetailRows,
        },
        note: qualityRows.length === 0 ? "No quality checks were recorded in this period." : undefined,
      },
      incidents: {
        availability: "available",
        value: {
          total: incidentRows.length,
          unresolved: incidentRows.filter((r) => r.status !== "resolved").length,
          rows: incidentDetailRows,
        },
        note: incidentRows.length === 0 ? "No incidents were recorded in this period." : undefined,
      },
      inventory: {
        availability: "available",
        value: { flaggedItems, rows: inventoryDetailRows, historical: historicalInventory },
        note: "Current inventory snapshot; not a historical period total.",
      },
      unresolvedActions: {
        availability: "available",
        value: { total: unresolvedRows.length, rows: unresolvedRows },
        note: unresolvedRows.length === 0 ? "No unresolved actions were identified from available report sections." : undefined,
      },
      evidence: {
        release: {
          version: process.env.npm_package_version ?? "unknown",
          revision: process.env.REPLIT_GIT_COMMIT ?? process.env.GIT_COMMIT ?? "unknown",
          environment: process.env.NODE_ENV ?? "unknown",
        },
        recovery: {
          generatedAt: new Date().toISOString(),
          source: "live-database",
          complete: true,
        },
      },
    };
    if (!req.path.endsWith("/finalize")) {
      res.json(report);
      return;
    }
    // This branch deliberately uses the report just derived above.  It never
    // accepts report JSON from the browser and it does not edit source facts.
    const existing = await db.select().from(finalizedOperationalReportsTable).where(and(
      eq(finalizedOperationalReportsTable.scope, scope),
      eq(finalizedOperationalReportsTable.reportScope, report.scope),
      eq(finalizedOperationalReportsTable.periodStart, report.periodStart),
      eq(finalizedOperationalReportsTable.periodEnd, report.periodEnd),
    ));
    if (existing.length === 1) {
      const integrity = await verifiedFinalizedReportIntegrity(existing[0]);
      if (!integrity.ok) {
        sendFinalizedReportIntegrityError(req, res, existing[0], integrity);
        return;
      }
      res.status(200).json({ ...finalizedReportResponse(existing[0], integrity), idempotent: true });
      return;
    }
    if (existing.length > 1) {
      operationalError(res, 409, "finalized-report-ambiguous", "More than one finalized report exists for this period.");
      return;
    }
    const finalizedAt = new Date();
    const row = {
      id: randomUUID(),
      scope,
      reportScope: report.scope,
      periodStart: report.periodStart,
      periodEnd: report.periodEnd,
      generatedAt: new Date(report.generatedAt),
      generatedBy: report.attribution?.generatedBy ?? req.userId ?? "authenticated manager",
      finalizedAt,
      finalizedBy: req.userId ?? "authenticated manager",
      contentHash: reportHash(report),
      hashContract: CURRENT_HASH_CONTRACT,
      payload: report,
      proofContract: CURRENT_PROOF_CONTRACT,
      proofKeyId: "",
      proofSignature: "",
    };
    const keyring = reportSigningKeyring();
    if (!keyring) {
      operationalError(
        res,
        503,
        "finalized-report-signing-unavailable",
        "Finalized report signing is not configured. No report was finalized.",
      );
      return;
    }
    row.proofKeyId = keyring.activeKeyId;
    row.proofSignature = signFinalizedReport(
      row,
      reportSigningKey(keyring, keyring.activeKeyId)!,
    );
    try {
      await db.insert(finalizedOperationalReportsTable).values(row);
    } catch (error) {
      // A concurrent retry must never replace another finalized snapshot.
      const concurrent = await db.select().from(finalizedOperationalReportsTable).where(and(
        eq(finalizedOperationalReportsTable.scope, scope),
        eq(finalizedOperationalReportsTable.reportScope, report.scope),
        eq(finalizedOperationalReportsTable.periodStart, report.periodStart),
        eq(finalizedOperationalReportsTable.periodEnd, report.periodEnd),
      ));
      if (concurrent.length === 1) {
        const integrity = await verifiedFinalizedReportIntegrity(concurrent[0]);
        if (!integrity.ok) {
          sendFinalizedReportIntegrityError(req, res, concurrent[0], integrity);
          return;
        }
        res.status(200).json({ ...finalizedReportResponse(concurrent[0], integrity), idempotent: true });
        return;
      }
      throw error;
    }
    const persisted = await db.select().from(finalizedOperationalReportsTable)
      .where(and(
        eq(finalizedOperationalReportsTable.scope, scope),
        eq(finalizedOperationalReportsTable.reportScope, report.scope),
        eq(finalizedOperationalReportsTable.periodStart, report.periodStart),
        eq(finalizedOperationalReportsTable.periodEnd, report.periodEnd),
      ));
    if (persisted.length !== 1) {
      operationalError(res, 409, "finalized-report-ambiguous", "The finalized report could not be verified after storage.");
      return;
    }
    const integrity = finalizedReportIntegrity(persisted[0]);
    if (!integrity.ok) {
      sendFinalizedReportIntegrityError(req, res, persisted[0], integrity);
      return;
    }
    res.status(201).json(finalizedReportResponse(persisted[0], integrity));
  },
);

router.get("/reports/operational/finalized", requireCapability("review-incidents"), async (req, res): Promise<void> => {
  const parsed = ExactFinalizedReportQuery.safeParse(req.query);
  if (!parsed.success) {
    operationalError(res, 400, "invalid-query", "Valid scope and date query parameters are required.");
    return;
  }
  const [periodStart, periodEnd] = dateRange(parsed.data.scope, parsed.data.date);
  const rows = await db.select().from(finalizedOperationalReportsTable).where(and(
    eq(finalizedOperationalReportsTable.scope, currentScope()),
    eq(finalizedOperationalReportsTable.reportScope, parsed.data.scope),
    eq(finalizedOperationalReportsTable.periodStart, periodStart),
    eq(finalizedOperationalReportsTable.periodEnd, periodEnd),
  )).orderBy(desc(finalizedOperationalReportsTable.finalizedAt));
  res.json(await Promise.all(rows.map(async (row) => (
    finalizedReportMetadata(row, await verifiedFinalizedReportIntegrity(row))
  ))));
});

router.get("/reports/operational/finalized/search", requireCapability("review-incidents"), async (req, res): Promise<void> => {
  const parsed = RangeFinalizedReportQuery.safeParse(req.query);
  if (!parsed.success) {
    operationalError(res, 400, "invalid-query", "Valid startDate and endDate parameters within a 366-day range are required. Limit must be between 1 and 100.");
    return;
  }
  const rows = await db.select(finalizedReportMetadataColumns).from(finalizedOperationalReportsTable).where(and(
    eq(finalizedOperationalReportsTable.scope, currentScope()),
    parsed.data.scope ? eq(finalizedOperationalReportsTable.reportScope, parsed.data.scope) : undefined,
    gte(finalizedOperationalReportsTable.periodEnd, parsed.data.startDate),
    lte(finalizedOperationalReportsTable.periodEnd, parsed.data.endDate),
  )).orderBy(
    desc(finalizedOperationalReportsTable.periodEnd),
    desc(finalizedOperationalReportsTable.finalizedAt),
  ).limit(parsed.data.limit);
  res.json(rows.map((row) => finalizedReportMetadata(row)));
});

router.get("/reports/operational/finalized/proof-key-health", requireCapability("review-incidents"), async (_req, res): Promise<void> => {
  const scope = currentScope();
  // Each recursive step seeks the next key ID through the
  // (scope, proof_contract, proof_key_id) index. This bounds database work by
  // distinct key IDs instead of scanning every report signed by a repeated key.
  const scanned = await db.execute(sql`
    WITH RECURSIVE stored_proof_keys(proof_key_id) AS (
      SELECT min(proof_key_id)
      FROM finalized_operational_reports
      WHERE scope = ${scope}
        AND proof_contract = ${CURRENT_PROOF_CONTRACT}
        AND proof_key_id IS NOT NULL
      UNION ALL
      SELECT (
        SELECT min(next_report.proof_key_id)
        FROM finalized_operational_reports AS next_report
        WHERE next_report.scope = ${scope}
          AND next_report.proof_contract = ${CURRENT_PROOF_CONTRACT}
          AND next_report.proof_key_id > stored_proof_keys.proof_key_id
      )
      FROM stored_proof_keys
      WHERE stored_proof_keys.proof_key_id IS NOT NULL
    )
    SELECT proof_key_id AS "proofKeyId"
    FROM stored_proof_keys
    WHERE proof_key_id IS NOT NULL
    LIMIT ${FINALIZED_REPORT_KEY_HEALTH_SCAN_LIMIT + 1}
  `);
  const scannedRows = scanned.rows as Array<{ proofKeyId: unknown }>;
  const truncated = scannedRows.length > FINALIZED_REPORT_KEY_HEALTH_SCAN_LIMIT;
  const storedProofKeyIds = scannedRows
    .slice(0, FINALIZED_REPORT_KEY_HEALTH_SCAN_LIMIT)
    .map(({ proofKeyId }) => proofKeyId)
    .filter((proofKeyId): proofKeyId is string => typeof proofKeyId === "string");
  const keyring = reportSigningKeyring();
  const availableStoredProofKeyIds = keyring
    ? storedProofKeyIds.filter((proofKeyId) => Boolean(reportSigningKey(keyring, proofKeyId)))
    : [];
  const availableSet = new Set(availableStoredProofKeyIds);
  const missingStoredProofKeyIds = storedProofKeyIds.filter((proofKeyId) => !availableSet.has(proofKeyId));
  const attentionRequired = !keyring || missingStoredProofKeyIds.length > 0 || truncated;

  const remediation = !keyring
    ? "Restore a valid OPERATIONAL_REPORT_SIGNING_KEYS keyring, including every retained proof key, before finalizing or verifying reports."
    : missingStoredProofKeyIds.length > 0
      ? `Restore the retained signing key${missingStoredProofKeyIds.length === 1 ? "" : "s"} for proof key ID${missingStoredProofKeyIds.length === 1 ? "" : "s"} ${missingStoredProofKeyIds.join(", ")} in OPERATIONAL_REPORT_SIGNING_KEYS before removing or rotating keys.`
      : truncated
        ? "More proof key IDs exist than this bounded audit can inspect. Reduce historical key-ID churn or run a complete offline audit before rotating keys."
        : null;

  res.json({
    status: attentionRequired ? "attention-required" : "healthy",
    scope,
    activeKeyId: keyring?.activeKeyId ?? null,
    storedProofKeyIds,
    availableStoredProofKeyIds,
    missingStoredProofKeyIds,
    scan: {
      limit: FINALIZED_REPORT_KEY_HEALTH_SCAN_LIMIT,
      checkedDistinctKeyIds: storedProofKeyIds.length,
      truncated,
    },
    message: attentionRequired
      ? "Finalized report proof-key retention needs manager attention."
      : "Every stored finalized-report proof key checked by this audit is retained in the configured keyring.",
    remediation,
  });
});

router.get("/reports/operational/finalized/:id", requireCapability("review-incidents"), async (req, res): Promise<void> => {
  const parsed = FinalizedReportId.safeParse(req.params);
  if (!parsed.success) {
    operationalError(res, 400, "invalid-report-id", "A valid finalized report id is required.");
    return;
  }
  const rows = await db.select().from(finalizedOperationalReportsTable).where(and(
    eq(finalizedOperationalReportsTable.id, parsed.data.id),
    eq(finalizedOperationalReportsTable.scope, currentScope()),
  ));
  if (rows.length !== 1) {
    operationalError(res, 404, "finalized-report-not-found", "Finalized report not found.");
    return;
  }
  const integrity = await verifiedFinalizedReportIntegrity(rows[0]);
  if (!integrity.ok) {
    sendFinalizedReportIntegrityError(req, res, rows[0], integrity);
    return;
  }
  res.json(finalizedReportResponse(rows[0], integrity));
});

export function resolveRetainedArtifact(
  cached: Buffer | null,
  expectedSha256: string,
  regenerate: () => Buffer,
): { bytes: Buffer; source: "job-cache" | "canonical-regenerated" } {
  if (cached && createHash("sha256").update(cached).digest("hex") === expectedSha256) {
    return { bytes: cached, source: "job-cache" };
  }
  return { bytes: regenerate(), source: "canonical-regenerated" };
}

router.get("/reports/operational/finalized/:id/export", requireCapability("review-incidents"), async (req, res): Promise<void> => {
  const id = FinalizedReportId.safeParse(req.params);
  const query = FinalizedReportExportQuery.safeParse(req.query);
  if (!id.success || !query.success) {
    operationalError(res, 400, "invalid-export-request", "A valid finalized report id and export format are required.");
    return;
  }
  const scope = currentScope();
  const row = (await db.select().from(finalizedOperationalReportsTable).where(and(
    eq(finalizedOperationalReportsTable.id, id.data.id),
    eq(finalizedOperationalReportsTable.scope, scope),
  )).limit(1))[0];
  if (!row) {
    operationalError(res, 404, "finalized-report-not-found", "Finalized report not found.");
    return;
  }
  const integrity = finalizedReportIntegrity(row);
  if (!integrity.ok) {
    sendFinalizedReportIntegrityError(req, res, row, integrity);
    return;
  }

  const format = query.data.format as CanonicalReportExportFormat;
  const snapshot = {
    id: row.id,
    contentHash: row.contentHash,
    finalizedAt: row.finalizedAt,
    report: row.payload as OperationalReport,
  };
  const snapshotId = canonicalReportSnapshotId(snapshot);
  const regenerate = () => format === "csv" ? Buffer.from(canonicalReportCsv(snapshot))
    : format === "print" ? Buffer.from(canonicalReportPrintHtml(snapshot))
      : Buffer.from(canonicalReportXlsx(snapshot));
  let bytes: Buffer;
  let artifactSource: "job-cache" | "canonical-regenerated" | "canonical-direct";

  if (query.data.jobId) {
    const job = (await db.select().from(serverJobsTable).where(
      eq(serverJobsTable.id, query.data.jobId),
    ).limit(1))[0];
    if (!retainedExportIsAuthorized(job, scope, row.id, format, snapshotId, row.contentHash)) {
      operationalError(res, 404, "export-artifact-not-found", "The requested export artifact was not found.");
      return;
    }
    const retained = await readServerJobArtifact(query.data.jobId, format);
    const expectedArtifactHash = (job.result as { artifactSha256: string }).artifactSha256;
    const resolved = resolveRetainedArtifact(retained, expectedArtifactHash, regenerate);
    bytes = resolved.bytes;
    artifactSource = resolved.source;
  } else {
    bytes = regenerate();
    artifactSource = "canonical-direct";
  }

  res.setHeader("Content-Type", format === "csv"
    ? "text/csv; charset=utf-8"
    : format === "print"
      ? "text/html; charset=utf-8"
      : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${canonicalExportFilename(snapshot, format)}"`);
  res.setHeader("X-Canonical-Snapshot-Id", snapshotId);
  res.setHeader("X-Canonical-Content-Hash", row.contentHash);
  res.setHeader("X-Export-Artifact-Source", artifactSource);
  res.send(bytes);
});

export default router;
