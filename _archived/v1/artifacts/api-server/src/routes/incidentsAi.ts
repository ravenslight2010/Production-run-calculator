import { ReportIncidentBody } from "@workspace/api-zod";
import * as z from "zod";
import type { IncidentContext } from "../lib/incidents";

export type ReportInput = z.infer<typeof ReportIncidentBody>;

export type ReportValidationResult =
  | { ok: true; data: ReportInput }
  | { ok: false; status: number; error: string };

const MAX_STACK_FRAMES = 12;
const JWT_PATTERN = /\b[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g;
const TOKEN_PATTERN = /\b(?:bearer\s+)?[A-Za-z0-9_-]{24,}(?:\.[A-Za-z0-9_-]{12,}){0,2}\b/gi;
const CONTACT_PATTERN = /\b(?:[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}|\+?\d[\d ()-]{7,}\d)\b/g;
const FILE_PATH_PATTERN = /(?:file:\/\/)?(?:[A-Za-z]:\\|\/(?:Users|home|var|tmp|workspace|app|opt)\/)(?:[^:\s()[\]]+[\\/])*[^:\s()[\]]+/g;
const QUERY_PATTERN = /([a-z][a-z0-9+.-]*:\/\/[^\s?#]+|\/[^\s?#]*)\?[^\s#]*/gi;

export function redactDiagnosticText(raw: string, maxChars: number): string {
  return raw
    .replace(QUERY_PATTERN, "$1?[redacted]")
    .replace(CONTACT_PATTERN, "[contact redacted]")
    .replace(FILE_PATH_PATTERN, "[path redacted]")
    .replace(JWT_PATTERN, "[token redacted]")
    .replace(TOKEN_PATTERN, "[token redacted]")
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")
    .slice(0, maxChars)
    .trim();
}

export function isSafeCorrelationId(value: unknown): value is string {
  return typeof value === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function safeIncidentLogMetadata(data: ReportInput, context: IncidentContext) {
  const screenClass = /inventory|warehouse/i.test(data.screen) ? "inventory"
    : /manage|incident|settings/i.test(data.screen) ? "management"
      : /sign|auth|login/i.test(data.screen) ? "authentication"
        : /run|home|production/i.test(data.screen) ? "production" : "other";
  return {
    appPlatform: data.appPlatform,
    signalKind: context.signalKind,
    outcome: context.outcome,
    retryCount: context.retryCount,
    connectivity: context.connectivity,
    screenClass,
    buildProvided: Boolean(data.appVersion),
    ...(context.requestOperationCategory ? { requestOperationCategory: context.requestOperationCategory } : {}),
    ...(context.requestRoute ? { requestRoute: context.requestRoute } : {}),
    ...(context.requestOutcome ? { requestOutcome: context.requestOutcome } : {}),
    ...(context.requestReasonCode ? { requestReasonCode: context.requestReasonCode } : {}),
    ...(context.requestHttpStatus ? { requestHttpStatus: context.requestHttpStatus } : {}),
  };
}

function safeEnum(value: unknown, allowed: readonly string[], fallback: string): string {
  return typeof value === "string" && allowed.includes(value) ? value : fallback;
}

function normalizeAgent(userAgent: string | undefined): Pick<IncidentContext, "browserFamily" | "deviceClass"> {
  const ua = userAgent ?? "";
  const browserFamily = /Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox"
    : /CriOS|Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "Other";
  const deviceClass = /iPad|Tablet|Android(?!.*Mobile)/i.test(ua) ? "tablet"
    : /Mobile|iPhone|Android/i.test(ua) ? "phone" : "desktop";
  return { browserFamily, deviceClass };
}

// Validate the request body for POST /incidents. A user report should carry a
// description; a crash should carry an error message. We don't hard-reject a
// missing one (a crash with only a stack, or a terse report, is still useful),
// but we require at least some signal so empty submissions are turned away.
export function validateReportBody(body: unknown): ReportValidationResult {
  const parsed = ReportIncidentBody.safeParse(body);
  if (!parsed.success) {
    return { ok: false, status: 400, error: parsed.error.message };
  }
  const data = parsed.data;
  const hasSignal = Boolean(
    (data.description && data.description.trim()) ||
      (data.errorMessage && data.errorMessage.trim()) ||
      (data.errorStack && data.errorStack.trim()),
  );
  if (!hasSignal) {
    return {
      ok: false,
      status: 400,
      error: "Please describe the problem before submitting.",
    };
  }
  return { ok: true, data };
}

// Assemble the jsonb context we persist from the validated body, dropping empty
// fields so the stored object stays tidy.
export function buildIncidentContext(data: ReportInput): IncidentContext {
  const diagnostics = data.diagnostics;
  const ctx: IncidentContext = {
    ...normalizeAgent(data.userAgent),
    action: redactDiagnosticText(diagnostics?.action ?? "report_problem", 80) || "report_problem",
    outcome: safeEnum(diagnostics?.outcome, ["error", "rejected", "degraded"], "error"),
    retryCount: Math.min(10, Math.max(0, Math.round(diagnostics?.retryCount ?? 0))),
    connectivity: safeEnum(diagnostics?.connectivity, ["online", "offline", "unstable", "unknown"], "unknown"),
    syncState: safeEnum(diagnostics?.syncState, ["idle", "pending", "retrying", "blocked", "unknown"], "unknown"),
    signalKind: safeEnum(diagnostics?.signalKind, ["user_report", "crash", "rejected_promise", "api_failure", "startup", "update", "sync"], data.source === "auto_crash" ? "crash" : "user_report"),
  };
  if (isSafeCorrelationId(diagnostics?.correlationId)) {
    ctx.relatedCorrelationId = diagnostics.correlationId;
  }
  const operationCategories = ["authentication", "diagnostics", "import", "inventory", "master_data", "sync", "other"] as const;
  const requestOutcomes = [
    "http_server_error", "http_client_error", "authentication_rejected",
    "transport_failure", "offline_failure", "timeout", "cancelled",
  ] as const;
  if (diagnostics?.requestOperationCategory && operationCategories.includes(diagnostics.requestOperationCategory)) {
    ctx.requestOperationCategory = diagnostics.requestOperationCategory;
  }
  const requestRoutes = [
    "authentication", "sync_today_read", "sync_today_write", "sync_dated",
    "sync_auto_track_claim", "sync_manual_section", "sync_operational_intents",
    "sync_events", "sync_scheduled", "sync_other", "other",
  ] as const;
  if (diagnostics?.requestRoute && requestRoutes.includes(diagnostics.requestRoute)) {
    ctx.requestRoute = diagnostics.requestRoute;
  }
  if (diagnostics?.requestOutcome && requestOutcomes.includes(diagnostics.requestOutcome)) {
    ctx.requestOutcome = diagnostics.requestOutcome;
  }
  if (diagnostics?.requestReasonCode === "SYNC_VALIDATION_FAILED" ||
      diagnostics?.requestReasonCode === "SYNC_PAYLOAD_NOT_OBJECT" ||
      diagnostics?.requestReasonCode === "SYNC_PAYLOAD_TOO_LARGE") {
    ctx.requestReasonCode = diagnostics.requestReasonCode;
  }
  if (typeof diagnostics?.requestElapsedMs === "number" && Number.isFinite(diagnostics.requestElapsedMs)) {
    ctx.requestElapsedMs = Math.round(Math.min(10_000_000, Math.max(0, diagnostics.requestElapsedMs)) * 100) / 100;
  }
  if (diagnostics?.requestBackgroundInvolvement === "observed" ||
      diagnostics?.requestBackgroundInvolvement === "not_observed") {
    ctx.requestBackgroundInvolvement = diagnostics.requestBackgroundInvolvement;
  }
  const requestHttpStatus = diagnostics?.requestHttpStatus;
  if (typeof requestHttpStatus === "number" && Number.isInteger(requestHttpStatus) &&
      requestHttpStatus >= 400 && requestHttpStatus <= 599) {
    ctx.requestHttpStatus = requestHttpStatus;
  }
  const reportedObservedAt: unknown = diagnostics?.requestObservedAt;
  const observedAt = reportedObservedAt instanceof Date
    ? reportedObservedAt.getTime()
    : typeof reportedObservedAt === "string" ? Date.parse(reportedObservedAt) : Number.NaN;
  if (Number.isFinite(observedAt)) {
    const now = Date.now();
    if (observedAt >= now - 30 * 24 * 60 * 60 * 1000 &&
        observedAt <= now + 5 * 60 * 1000) {
      ctx.requestObservedAt = new Date(observedAt).toISOString();
    }
  }
  const description = data.description ? redactDiagnosticText(data.description, 2000) : "";
  const errorMessage = data.errorMessage ? redactDiagnosticText(data.errorMessage, 500) : "";
  const errorStack = data.errorStack
    ? data.errorStack.split("\n").slice(0, MAX_STACK_FRAMES).map((line) => redactDiagnosticText(line, 300)).filter(Boolean).join("\n").slice(0, 3000)
    : "";
  if (description) ctx.description = description;
  if (errorMessage) ctx.errorMessage = errorMessage;
  if (errorStack) ctx.errorStack = errorStack;
  return ctx;
}
