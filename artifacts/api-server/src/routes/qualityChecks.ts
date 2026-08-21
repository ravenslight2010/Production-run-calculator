import { RecordQualityCheckBody } from "@workspace/api-zod";
import * as z from "zod";
import type { QualityCheckRow } from "@workspace/db";
import {
  MAX_ISSUE_DETAIL_CHARS,
  MAX_ISSUE_TYPE_CHARS,
  MAX_ISSUES,
  MAX_NOTES_CHARS,
  MAX_SUMMARY_CHARS,
  type QualityIssueOut,
  type QualityProductType,
  type QualitySeverity,
  type QualityStatus,
} from "./qualityPhoto";

// Quality history is a persisted, structured log of reviewed-and-confirmed
// quality checks. Validation + normalization live here so they can be
// unit-tested without a DB; the route in inventory.ts only handles the actual
// insert/select. The matching free-text fact still goes into facility memory on
// the client side — this record is the browsable, filterable history on top.

// A stored thumbnail is the analyzed photo as a data URI. Cap it generously so a
// normal downscaled photo fits but a stray full-resolution original is dropped
// (stored as null) rather than bloating the table.
export const MAX_THUMBNAIL_CHARS = 2_000_000;

export type QualityCheckRecordInput = z.infer<typeof RecordQualityCheckBody>;

export type QualityCheckRecordOut = {
  id: number;
  productType: QualityProductType;
  status: QualityStatus;
  confidence: number;
  summary: string;
  issues: QualityIssueOut[];
  notes: string | null;
  thumbnail: string | null;
  reviewerName: string | null;
  createdAt: string;
};

// What the route will insert (minus the DB-managed id/createdAt and the reviewer
// identity, which the route supplies from the authenticated request).
export type QualityCheckInsert = {
  productType: QualityProductType;
  status: QualityStatus;
  confidence: number;
  summary: string;
  issues: QualityIssueOut[];
  notes: string | null;
  thumbnail: string | null;
};

export type QualityCheckValidationResult =
  | { ok: true; data: QualityCheckInsert }
  | { ok: false; status: number; error: string };

function clamp(s: string, max: number): string {
  const t = s.trim();
  return t.length > max ? t.slice(0, max).trimEnd() : t;
}

function normalizeProductType(raw: string): QualityProductType {
  return raw === "crust" || raw === "other" ? raw : "pizza";
}

function normalizeStatus(raw: string): QualityStatus {
  return raw === "pass" || raw === "fail" ? raw : raw === "warn" ? "warn" : "warn";
}

function normalizeSeverity(raw: string | undefined): QualitySeverity {
  return raw === "major" || raw === "critical" ? raw : "minor";
}

// A bare data URI for a JPEG/PNG/WebP image; anything else is dropped so we never
// store arbitrary client text in the thumbnail column.
function normalizeThumbnail(raw: string | undefined): string | null {
  if (!raw) return null;
  const t = raw.trim();
  if (!t.startsWith("data:image/")) return null;
  if (t.length > MAX_THUMBNAIL_CHARS) return null;
  return t;
}

// Validate and normalize the request body for POST /inventory/quality-checks.
// Confidence is clamped to 0..1, free-text is trimmed/capped, issues are bounded
// in count and shape, and the thumbnail is dropped unless it's a reasonably
// sized image data URI. Returns the row-ready payload on success.
export function validateRecordQualityCheckBody(
  body: unknown,
): QualityCheckValidationResult {
  const parsed = RecordQualityCheckBody.safeParse(body);
  if (!parsed.success) {
    return { ok: false, status: 400, error: parsed.error.message };
  }
  const b = parsed.data;

  const issues: QualityIssueOut[] = [];
  for (const item of b.issues ?? []) {
    if (issues.length >= MAX_ISSUES) break;
    const detail = clamp(item.detail ?? "", MAX_ISSUE_DETAIL_CHARS);
    if (!detail) continue;
    const type = clamp(item.type ?? "", MAX_ISSUE_TYPE_CHARS) || "issue";
    issues.push({ type, severity: normalizeSeverity(item.severity), detail });
  }

  let confidence = b.confidence;
  if (!Number.isFinite(confidence)) confidence = 0;
  confidence = Math.max(0, Math.min(1, confidence));

  const notes = clamp(b.notes ?? "", MAX_NOTES_CHARS);

  return {
    ok: true,
    data: {
      productType: normalizeProductType(b.productType),
      status: normalizeStatus(b.status),
      confidence,
      summary: clamp(b.summary ?? "", MAX_SUMMARY_CHARS),
      issues,
      notes: notes ? notes : null,
      thumbnail: normalizeThumbnail(b.thumbnail),
    },
  };
}

// The optional filters supported by GET /inventory/quality-checks. Anything not
// in the allowed enum is treated as "no filter" rather than an error so a stray
// query param never 500s the history view.
export type QualityHistoryFilter = {
  productType?: QualityProductType;
  status?: QualityStatus;
  from?: Date;
  to?: Date;
};

export function parseHistoryFilter(query: {
  productType?: unknown;
  status?: unknown;
  from?: unknown;
  to?: unknown;
}): QualityHistoryFilter {
  const filter: QualityHistoryFilter = {};
  const pt = typeof query.productType === "string" ? query.productType : "";
  if (pt === "pizza" || pt === "crust" || pt === "other") filter.productType = pt;
  const st = typeof query.status === "string" ? query.status : "";
  if (st === "pass" || st === "warn" || st === "fail") filter.status = st;
  const from = typeof query.from === "string" ? query.from : "";
  const to = typeof query.to === "string" ? query.to : "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(from)) filter.from = new Date(`${from}T00:00:00.000Z`);
  if (/^\d{4}-\d{2}-\d{2}$/.test(to)) filter.to = new Date(`${to}T23:59:59.999Z`);
  return filter;
}

// Shape a DB row into the wire record (issues coerced to the strict shape,
// createdAt as ISO). Defensive so a malformed jsonb issues blob never throws.
export function rowToRecord(row: QualityCheckRow): QualityCheckRecordOut {
  const issues: QualityIssueOut[] = [];
  const rawIssues = Array.isArray(row.issues) ? row.issues : [];
  for (const item of rawIssues) {
    if (!item || typeof item !== "object") continue;
    const obj = item as Record<string, unknown>;
    const detail = typeof obj.detail === "string" ? obj.detail : "";
    if (!detail) continue;
    issues.push({
      type: typeof obj.type === "string" && obj.type ? obj.type : "issue",
      severity: normalizeSeverity(
        typeof obj.severity === "string" ? obj.severity : undefined,
      ),
      detail,
    });
  }
  return {
    id: row.id,
    productType: normalizeProductType(row.productType),
    status: normalizeStatus(row.status),
    confidence: row.confidence,
    summary: row.summary,
    issues,
    notes: row.notes ?? null,
    thumbnail: row.thumbnail ?? null,
    reviewerName: row.reviewerName ?? null,
    createdAt:
      row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
  };
}
