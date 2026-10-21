import { useEffect } from "react";
import {
  FIELD_CHECK_MAX_CLOCK_SKEW_MS,
  isFieldCheckTimestampOutsideClockWindow,
} from "@workspace/field-check-contract";
import { submitFieldCheckObservations } from "./inventoryShared";
import { useAuth } from "./useAuth";
import {
  AUTHENTICATED_STARTUP_PERFORMANCE_BUDGETS,
  PERFORMANCE_BUDGETS,
  type ApiFailureEvent,
} from "./performanceDiagnostics";
import {
  API_OPERATION_CODES,
  API_REQUEST_OUTCOME_CODES,
  PERFORMANCE_SOURCE_CODES,
  SYNC_ACK_FAILURE_CODES,
} from "./fieldCheckDiagnosticDetails";
import { consumeStaleAssetRecoveryAttempt } from "./pwaUpdateRecovery";
export { fieldCheckDiagnosticLabel, PERFORMANCE_SOURCE_CODES, SYNC_ACK_FAILURE_CODES } from "./fieldCheckDiagnosticDetails";

export const FIELD_CHECK_VERSION = "4";
export const FIELD_CHECK_SIGNAL_EVENT = "calculator-field-check-signal";
export const FIELD_CHECK_QUEUE_EVENT = "calculator-field-check-queue";
export const FIELD_CHECK_WORKFLOW_MAX_DURATION_MS = 15 * 60 * 1000;

export const PRODUCTION_RUN_SAVE_FAILURE_CODES = {
  authenticationRejected: 1,
  staleOrResetWrite: 2,
  unrecoverableConflict: 3,
  retriesExhausted: 4,
} as const;

const productionRunSaveFailureLabels: Record<number, string> = {
  [PRODUCTION_RUN_SAVE_FAILURE_CODES.authenticationRejected]: "Login or permission rejected",
  [PRODUCTION_RUN_SAVE_FAILURE_CODES.staleOrResetWrite]: "Server rejected a stale/reset save",
  [PRODUCTION_RUN_SAVE_FAILURE_CODES.unrecoverableConflict]: "Unrecoverable sync conflict",
  [PRODUCTION_RUN_SAVE_FAILURE_CODES.retriesExhausted]: "Sync retries exhausted",
};

export function productionRunSaveFailureLabel(failureCode: number | undefined): string | null {
  return Number.isInteger(failureCode) ? productionRunSaveFailureLabels[failureCode!] ?? null : null;
}

export const FIELD_CHECK_CATALOG = [
  { name: "startup", label: "Startup", observedBy: "browser" as const },
  { name: "foreground-recovery", label: "Background / foreground recovery", observedBy: "browser" as const },
  { name: "sync-acknowledgment", label: "Sync acknowledgment", observedBy: "browser" as const },
  { name: "production-run-save-sync", label: "Production-run save and sync", observedBy: "browser" as const },
  { name: "spec-import-review-commit", label: "Spec import parse, review, and commit", observedBy: "browser" as const },
  { name: "cross-device-convergence", label: "Cross-device convergence", observedBy: "browser" as const },
  { name: "reload-persistence", label: "Reload startup", observedBy: "browser" as const },
  { name: "offline-recovery", label: "Offline recovery", observedBy: "browser" as const },
  { name: "offline-queue-replay", label: "Offline queue replay", observedBy: "browser" as const },
  { name: "pwa-update-handoff", label: "PWA update handoff", observedBy: "browser" as const },
  { name: "stale-deployment-recovery", label: "Stale-deployment recovery", observedBy: "browser" as const },
  {
    name: "performance",
    label: "Performance and API failures",
    observedBy: "browser" as const,
    evidence: "Client-observed elapsed request wait, allowlisted operation and outcome, HTTP status when received, browser-hidden transitions, release and device, and an optional client-reported server correlation reference. Elapsed wait is not server processing time.",
  },
  { name: "touch-accuracy", label: "Touch accuracy", observedBy: "hardware" as const },
  { name: "keyboard-clearance", label: "Keyboard clearance", observedBy: "hardware" as const },
  { name: "orientation-layout", label: "Orientation layout", observedBy: "hardware" as const },
  { name: "safe-area-clearance", label: "Safe-area and fixed-navigation clearance", observedBy: "hardware" as const },
  { name: "camera-file-selection", label: "Camera and file selection", observedBy: "hardware" as const },
  { name: "update-handoff", label: "Update handoff", observedBy: "hardware" as const },
  { name: "process-kill-recovery", label: "OS process-kill recovery", observedBy: "hardware" as const },
] as const;

type CheckName = (typeof FIELD_CHECK_CATALOG)[number]["name"];
type Outcome = "success" | "failure" | "incomplete";
type Signal = {
  checkName: CheckName;
  outcome: Outcome;
  metrics?: Record<string, number>;
  reportedRequestCorrelationId?: string;
};

const queueKey = "run-calc-field-check-queue";
const queueDisplacementKey = "run-calc-field-check-queue-displacements-v1";
const clientKey = "run-calc-field-check-client";
const dedupKey = "run-calc-field-check-dedup-v4";
const bucketMs = 10 * 60 * 1000;
const maxQueue = 80;
const maxMetrics = 8;
const safeCorrelationId = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const defaultRetryMs = 30_000;
// Expired rows stay local and visible, but are never resent.
export const FIELD_CHECK_QUEUE_MAX_AGE_MS = FIELD_CHECK_MAX_CLOCK_SKEW_MS;
const workflowChecks = new Set<CheckName>([
  "production-run-save-sync",
  "spec-import-review-commit",
]);

function randomId(): string {
  try {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  } catch {}
  return `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

function localClientId(): string {
  try {
    const existing = localStorage.getItem(clientKey);
    if (existing && /^[a-zA-Z0-9-]{8,80}$/.test(existing)) return existing;
    const next = randomId().replace(/[^a-zA-Z0-9-]/g, "").slice(0, 70);
    localStorage.setItem(clientKey, next);
    return next;
  } catch {
    return randomId().replace(/[^a-zA-Z0-9-]/g, "").slice(0, 70);
  }
}

function hashScope(scope: string): string {
  let first = 2166136261;
  let second = 0x811c9dc5;
  for (let index = 0; index < scope.length; index += 1) {
    const code = scope.charCodeAt(index);
    first = Math.imul(first ^ code, 16777619);
    second = Math.imul(second ^ (code + index), 16777619);
  }
  return `${(first >>> 0).toString(16)}${(second >>> 0).toString(16)}`;
}

function deviceCategory(): "desktop-chrome" | "desktop-safari" | "desktop-firefox" | "mobile-chrome" | "mobile-safari" | "tablet-browser" | "other-browser" {
  if (typeof navigator === "undefined") return "other-browser";
  const ua = navigator.userAgent.toLowerCase();
  const tablet = /ipad|tablet|android(?!.*mobile)/.test(ua);
  const mobile = /mobile|iphone|ipod|android/.test(ua);
  if (tablet) return "tablet-browser";
  if (mobile && ua.includes("safari") && !ua.includes("chrome")) return "mobile-safari";
  if (mobile && (ua.includes("chrome") || ua.includes("crios"))) return "mobile-chrome";
  if (!mobile && ua.includes("firefox")) return "desktop-firefox";
  if (!mobile && ua.includes("safari") && !ua.includes("chrome")) return "desktop-safari";
  if (!mobile && (ua.includes("chrome") || ua.includes("edg"))) return "desktop-chrome";
  return "other-browser";
}

function safeMetrics(
  checkName: CheckName,
  outcome: Outcome,
  metrics: Record<string, number> | undefined,
): Record<string, number> {
  if (!metrics) return {};
  if (checkName === "sync-acknowledgment") {
    return outcome === "failure" && Number.isInteger(metrics.failureCode) &&
      Object.values(SYNC_ACK_FAILURE_CODES).includes(metrics.failureCode as 1 | 2 | 3 | 4)
      ? { failureCode: metrics.failureCode! } : {};
  }
  if (checkName === "performance") {
    if (!Number.isFinite(metrics.durationMs) || metrics.durationMs! < 0 ||
      !Number.isInteger(metrics.sourceCode) ||
      !Object.values(PERFORMANCE_SOURCE_CODES).includes(metrics.sourceCode as 1 | 2 | 3 | 4 | 5 | 6)) return {};
    // Preserve very slow failures as a saturated measurement, not a missing sample.
    const safe: Record<string, number> = {
      durationMs: Math.round(Math.min(metrics.durationMs!, 10_000_000) * 100) / 100,
      sourceCode: metrics.sourceCode!,
    };
    const hasRequestMetadata = ["outcomeCode", "operationCode", "backgroundCode"].some((key) =>
      Object.hasOwn(metrics, key),
    );
    if (!hasRequestMetadata) {
      return metrics.sourceCode! <= PERFORMANCE_SOURCE_CODES.navigationLoad ? safe : {};
    }
    if (!Number.isInteger(metrics.outcomeCode) ||
      !Object.values(API_REQUEST_OUTCOME_CODES).includes(metrics.outcomeCode as 1 | 2 | 3 | 4 | 5 | 6 | 7) ||
      !Number.isInteger(metrics.operationCode) ||
      !Object.values(API_OPERATION_CODES).includes(metrics.operationCode as 1 | 2 | 3 | 4 | 5 | 6 | 7) ||
      !Number.isInteger(metrics.backgroundCode) || ![0, 1].includes(metrics.backgroundCode!)) return {};
    const status = metrics.httpStatusCode;
    if (status !== undefined && (!Number.isInteger(status) || status! < 400 || status! > 599)) return {};
    const outcomeCode = metrics.outcomeCode!;
    if ((outcomeCode === API_REQUEST_OUTCOME_CODES.httpServerError && (status === undefined || status < 500)) ||
      (outcomeCode === API_REQUEST_OUTCOME_CODES.authenticationRejected &&
        status !== 401 && status !== 403) ||
      (outcomeCode === API_REQUEST_OUTCOME_CODES.httpClientError && (status === undefined || status >= 500)) ||
      (outcomeCode >= API_REQUEST_OUTCOME_CODES.transportFailure && status !== undefined) ||
      (outcomeCode === API_REQUEST_OUTCOME_CODES.cancelled
        ? outcome !== "incomplete"
        : outcome !== "failure")) return {};
    safe.outcomeCode = outcomeCode;
    safe.operationCode = metrics.operationCode!;
    safe.backgroundCode = metrics.backgroundCode!;
    if (status !== undefined) safe.httpStatusCode = status!;
    return safe;
  }
  if (checkName === "stale-deployment-recovery") return {};
  if (workflowChecks.has(checkName)) {
    const durationMs = metrics.durationMs;
    if (!Number.isFinite(durationMs) || durationMs! < 0 || durationMs! > FIELD_CHECK_WORKFLOW_MAX_DURATION_MS) {
      return {};
    }
    const safe: Record<string, number> = { durationMs: Math.round(durationMs! * 100) / 100 };
    const failureCode = metrics.failureCode;
    if (
      checkName === "production-run-save-sync" &&
      outcome === "failure" &&
      Number.isInteger(failureCode) &&
      Object.values(PRODUCTION_RUN_SAVE_FAILURE_CODES).includes(
        failureCode as (typeof PRODUCTION_RUN_SAVE_FAILURE_CODES)[keyof typeof PRODUCTION_RUN_SAVE_FAILURE_CODES],
      )
    ) {
      safe.failureCode = failureCode!;
    }
    return safe;
  }
  return Object.fromEntries(
    Object.entries(metrics)
      .filter(([key, value]) => /^[a-z][a-zA-Z0-9]{0,31}$/.test(key) && Number.isFinite(value) && value >= 0 && value <= 10_000_000)
      .slice(0, maxMetrics)
      .map(([key, value]) => [key, Math.round(value * 100) / 100]),
  );
}

function loadQueue(): Array<{
  observationId: string;
  originScope?: string | null;
  checkName: CheckName;
  checkVersion: string;
  outcome: Outcome;
  observedAt: string;
  appBuild: string;
  deviceCategory: ReturnType<typeof deviceCategory>;
  metrics: Record<string, number>;
  reportedRequestCorrelationId?: string;
}> {
  try {
    const parsed = JSON.parse(localStorage.getItem(queueKey) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item) =>
      item && typeof item.observationId === "string" &&
      typeof item.checkName === "string" &&
      FIELD_CHECK_CATALOG.some((check) => check.name === item.checkName && check.observedBy === "browser") &&
      (item.outcome === "success" || item.outcome === "failure" || item.outcome === "incomplete") &&
      typeof item.observedAt === "string" && typeof item.appBuild === "string" &&
      typeof item.deviceCategory === "string" && item.metrics && typeof item.metrics === "object",
    ).slice(-maxQueue).map((item) => ({
      ...item,
      // Older queue entries have no trustworthy account origin. Keep them
      // visible locally, but never attribute them to a later sign-in.
      originScope: typeof item.originScope === "string" && item.originScope.length <= 120
        ? item.originScope
        : null,
      ...(safeCorrelationId.test(item.reportedRequestCorrelationId ?? "")
        ? { reportedRequestCorrelationId: item.reportedRequestCorrelationId }
        : {}),
    }));
  } catch {
    return [];
  }
}

function isFieldCheckObservationExpired(
  observation: { observedAt: string },
  now: number,
): boolean {
  const observedAt = Date.parse(observation.observedAt);
  return !Number.isFinite(observedAt) || isFieldCheckTimestampOutsideClockWindow(observedAt, now);
}

function getQueueDisplacementCount(): number {
  try {
    const count = Number(localStorage.getItem(queueDisplacementKey));
    return Number.isSafeInteger(count) && count >= 0 ? count : 0;
  } catch {
    return 0;
  }
}

function recordQueueDisplacement(): void {
  try {
    localStorage.setItem(
      queueDisplacementKey,
      String(Math.min(Number.MAX_SAFE_INTEGER, getQueueDisplacementCount() + 1)),
    );
  } catch {
    // Queue accounting is best-effort telemetry and must never affect operations.
  }
}

function saveQueue(queue: ReturnType<typeof loadQueue>): void {
  try {
    localStorage.setItem(queueKey, JSON.stringify(queue.slice(-maxQueue)));
  } catch {
    // Collection must never affect production persistence.
  }
  if (typeof window !== "undefined") window.dispatchEvent(new Event(FIELD_CHECK_QUEUE_EVENT));
}

export type FieldCheckQueueStatus = {
  available: boolean;
  /** All retained entries, including expired entries that remain unconfirmed. */
  count: number;
  retryableCount: number;
  expiredCount: number;
  /** Cumulative entries displaced by the local queue cap; delivery is unconfirmed. */
  displacedCount: number;
  oldestAgeMs: number | null;
};

export function getFieldCheckQueueStatus(now = Date.now()): FieldCheckQueueStatus {
  try {
    // Probe storage separately so a denied localStorage read is not mistaken
    // for a confirmed empty queue.
    localStorage.getItem(queueKey);
    const queue = loadQueue();
    const retryableCount = queue.filter((item) => !isFieldCheckObservationExpired(item, now)).length;
    const oldest = queue
      .map((item) => Date.parse(item.observedAt))
      .filter(Number.isFinite)
      .reduce<number | null>((value, timestamp) => value === null ? timestamp : Math.min(value, timestamp), null);
    return {
      available: true,
      count: queue.length,
      retryableCount,
      expiredCount: queue.length - retryableCount,
      displacedCount: getQueueDisplacementCount(),
      oldestAgeMs: oldest === null ? null : Math.min(30 * 24 * 60 * 60 * 1000, Math.max(0, now - oldest)),
    };
  } catch {
    return {
      available: false,
      count: 0,
      retryableCount: 0,
      expiredCount: 0,
      displacedCount: 0,
      oldestAgeMs: null,
    };
  }
}

export function emitFieldCheckSignal(
  checkName: CheckName,
  outcome: Outcome,
  metrics?: Record<string, number>,
  reportedRequestCorrelationId?: string,
): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<Signal>(FIELD_CHECK_SIGNAL_EVENT, {
    detail: {
      checkName,
      outcome,
      metrics: safeMetrics(checkName, outcome, metrics),
      ...(reportedRequestCorrelationId ? { reportedRequestCorrelationId } : {}),
    },
  }));
}

function queueSignal(signal: Signal, appBuild: string, originScope: string): void {
  const metrics = safeMetrics(signal.checkName, signal.outcome, signal.metrics);
  if (workflowChecks.has(signal.checkName) && metrics.durationMs === undefined) return;
  if (signal.checkName === "performance" && metrics.sourceCode === undefined) return;
  if (signal.checkName === "sync-acknowledgment" && signal.outcome === "failure" && metrics.failureCode === undefined) return;
  const now = Date.now();
  // Separate builds and source classes; the state below distinguishes bounded causes
  // so a recovery followed by the same failure can be recorded again.
  let buildHash = 2166136261;
  for (const char of appBuild) buildHash = Math.imul(buildHash ^ char.charCodeAt(0), 16777619);
  const sourceBucket = metrics.sourceCode ?? 0;
  const category = metrics.sourceCode === undefined
    ? String(metrics.failureCode ?? 0)
    : `${metrics.sourceCode}:${metrics.outcomeCode ?? 0}:${metrics.operationCode ?? 0}`;
  const bucket = `${originScope}:${(buildHash >>> 0).toString(16)}:${signal.checkName}:${Math.floor(now / bucketMs)}:${sourceBucket}`;
  const state = `${signal.outcome}:${category}`;
  // Keep repeated samples deduplicated even after delivery, but do not hide a
  // new failure following recovery in the same bucket. This is telemetry state,
  // wholly separate from sync persistence and retry state.
  let dedup: Array<{ bucket: string; state: string; sequence: number }> = [];
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(dedupKey) ?? "[]");
    if (Array.isArray(parsed)) dedup = parsed.filter((item) =>
      item && typeof item.bucket === "string" && item.bucket.length <= 220 &&
      /^(success|failure|incomplete):[0-9:]{1,16}$/.test(item.state) &&
      Number.isSafeInteger(item.sequence) && item.sequence >= 0,
    ).slice(-maxQueue);
  } catch {}
  const previous = dedup.find((item) => item.bucket === bucket);
  if (previous?.state === state) return;
  const sequence = (previous?.sequence ?? -1) + 1;
  const id = `${localClientId()}:${hashScope(originScope)}:${signal.checkName}:v${FIELD_CHECK_VERSION}:${(buildHash >>> 0).toString(16)}:${Math.floor(now / bucketMs)}:${signal.outcome}:${category}:${sequence}`;
  const queue = loadQueue();
  if (queue.some((item) => item.observationId === id)) return;
  if (queue.length >= maxQueue) recordQueueDisplacement();
  queue.push({
    observationId: id,
    originScope,
    checkName: signal.checkName,
    checkVersion: FIELD_CHECK_VERSION,
    outcome: signal.outcome,
    observedAt: new Date(now).toISOString(),
    appBuild: appBuild.slice(0, 100) || "local",
    deviceCategory: deviceCategory(),
    metrics,
    ...(signal.checkName === "performance" && safeCorrelationId.test(signal.reportedRequestCorrelationId ?? "")
      ? { reportedRequestCorrelationId: signal.reportedRequestCorrelationId }
      : {}),
  });
  saveQueue(queue);
  try {
    localStorage.setItem(dedupKey, JSON.stringify([
      ...dedup.filter((item) => item.bucket !== bucket),
      { bucket, state, sequence },
    ].slice(-maxQueue)));
  } catch {
    // A storage failure may duplicate diagnostics, never affect operational writes.
  }
}

export function createFieldCheckObserver(appBuild: string, originScope: string): () => void {
  if (typeof window === "undefined" || typeof document === "undefined") return () => {};
  let stopped = false;
  let wasHidden = document.visibilityState === "hidden";
  let wasOffline = navigator.onLine === false;
  let flushInFlight: Promise<void> | null = null;
  let retryTimer: number | null = null;

  const flush = async () => {
    if (stopped || flushInFlight || retryTimer !== null || !navigator.onLine) return;
    const now = Date.now();
    const queued = loadQueue().filter((item) =>
      item.originScope === originScope && !isFieldCheckObservationExpired(item, now),
    );
    if (queued.length === 0) return;
    const batch = queued.slice(0, 20);
    const payload = batch.map((item) => {
      const observation = { ...item };
      delete observation.originScope;
      return observation;
    });
    flushInFlight = submitFieldCheckObservations(payload)
      .then(() => {
        const sent = new Set(batch.map((item) => item.observationId));
        saveQueue(loadQueue().filter((item) => !sent.has(item.observationId)));
      })
      .catch((error: unknown) => {
        const requestedDelay = (error as { retryAfterMs?: unknown } | null)?.retryAfterMs;
        const delay = typeof requestedDelay === "number" && Number.isFinite(requestedDelay)
          ? Math.min(120_000, Math.max(1_000, requestedDelay))
          : defaultRetryMs;
        if (!stopped && retryTimer === null) {
          const nextExpiration = queued
            .map((item) => Date.parse(item.observedAt) + FIELD_CHECK_QUEUE_MAX_AGE_MS)
            .reduce((earliest, expiration) => Math.min(earliest, expiration), Number.POSITIVE_INFINITY);
          const boundedDelay = Math.min(delay, Math.max(0, nextExpiration - Date.now()));
          retryTimer = window.setTimeout(() => {
            retryTimer = null;
            void flush();
          }, boundedDelay);
        }
      })
      .finally(() => {
        flushInFlight = null;
        if (!stopped && retryTimer === null) void flush();
      });
    await flushInFlight;
  };
  const onSignal = (event: Event) => {
    const signal = (event as CustomEvent<Signal>).detail;
    if (!signal || !FIELD_CHECK_CATALOG.some((check) => check.name === signal.checkName && check.observedBy === "browser")) return;
    if (!["success", "failure", "incomplete"].includes(signal.outcome)) return;
    queueSignal(signal, appBuild, originScope);
    void flush();
  };
  const onVisibility = () => {
    const hidden = document.visibilityState === "hidden";
    if (!hidden && wasHidden) {
      emitFieldCheckSignal("foreground-recovery", "success");
      void flush();
    }
    wasHidden = hidden;
  };
  const onOnline = () => {
    if (wasOffline) emitFieldCheckSignal("offline-recovery", "success");
    wasOffline = false;
    void flush();
  };
  const onOffline = () => { wasOffline = true; };
  const onPerformance = (event: Event) => {
    const entry = (event as CustomEvent<{ name?: string; durationMs?: number }>).detail;
    if (typeof entry?.name !== "string" || !Number.isFinite(entry.durationMs) || entry.durationMs! < 0) return;
    const sourceCode = entry.name === "startup:home-chunk-load" ? PERFORMANCE_SOURCE_CODES.homeChunkLoad
      : entry.name === "browser:navigation-to-load" ? PERFORMANCE_SOURCE_CODES.navigationLoad
        : entry.name.startsWith("api-failure:") && entry.name.endsWith(":timeout") ? PERFORMANCE_SOURCE_CODES.apiTimeout
          : entry.name.startsWith("api-failure:") && entry.name.endsWith(":network") ? PERFORMANCE_SOURCE_CODES.apiNetwork
            : undefined;
    if (sourceCode === undefined) return;
    const budget = sourceCode === PERFORMANCE_SOURCE_CODES.homeChunkLoad
      ? AUTHENTICATED_STARTUP_PERFORMANCE_BUDGETS.runReadyMs : PERFORMANCE_BUDGETS.initialLoadMs;
    emitFieldCheckSignal("performance", entry.durationMs! > budget ? "failure" : "success",
      { durationMs: entry.durationMs!, sourceCode });
  };
  const onApiFailure = (event: Event) => {
    const detail = (event as CustomEvent<ApiFailureEvent>).detail;
    if (!detail || !Number.isFinite(detail.elapsedMs) || detail.elapsedMs < 0) return;
    if (detail.cancellationClassification === "expected_auth_lifecycle") return;
    const outcomeCode = ({
      http_server_error: API_REQUEST_OUTCOME_CODES.httpServerError,
      authentication_rejected: API_REQUEST_OUTCOME_CODES.authenticationRejected,
      http_client_error: API_REQUEST_OUTCOME_CODES.httpClientError,
      transport_failure: API_REQUEST_OUTCOME_CODES.transportFailure,
      offline_failure: API_REQUEST_OUTCOME_CODES.offlineFailure,
      timeout: API_REQUEST_OUTCOME_CODES.timeout,
      cancelled: API_REQUEST_OUTCOME_CODES.cancelled,
    } as const)[detail.requestOutcome];
    const operationCode = ({
      authentication: API_OPERATION_CODES.authentication,
      diagnostics: API_OPERATION_CODES.diagnostics,
      import: API_OPERATION_CODES.import,
      inventory: API_OPERATION_CODES.inventory,
      master_data: API_OPERATION_CODES.masterData,
      sync: API_OPERATION_CODES.sync,
      other: API_OPERATION_CODES.other,
    } as const)[detail.operationCategory];
    const sourceCode = detail.requestOutcome === "timeout"
      ? PERFORMANCE_SOURCE_CODES.apiTimeout
      : detail.requestOutcome === "cancelled"
        ? PERFORMANCE_SOURCE_CODES.apiCancelled
        : detail.requestOutcome === "http_server_error" ||
            detail.requestOutcome === "http_client_error" ||
            detail.requestOutcome === "authentication_rejected"
          ? PERFORMANCE_SOURCE_CODES.apiHttpFailure
          : PERFORMANCE_SOURCE_CODES.apiNetwork;
    const outcome = detail.requestOutcome === "cancelled" ? "incomplete" : "failure";
    emitFieldCheckSignal("performance", outcome, {
      durationMs: detail.elapsedMs,
      sourceCode,
      outcomeCode,
      operationCode,
      backgroundCode: detail.backgroundObserved ? 1 : 0,
      ...(detail.httpStatus === undefined ? {} : { httpStatusCode: detail.httpStatus }),
    }, detail.correlationId);
  };

  window.addEventListener(FIELD_CHECK_SIGNAL_EVENT, onSignal);
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("online", onOnline);
  window.addEventListener("offline", onOffline);
  window.addEventListener("calculator-performance", onPerformance);
  window.addEventListener("app:api-failure", onApiFailure);
  queueSignal({ checkName: "startup", outcome: "success" }, appBuild, originScope);
  if (consumeStaleAssetRecoveryAttempt(appBuild)) {
    queueSignal({ checkName: "stale-deployment-recovery", outcome: "success" }, appBuild, originScope);
  }
  const navigation = performance.getEntriesByType("navigation").at(-1) as PerformanceNavigationTiming | undefined;
  if (navigation?.type === "reload") queueSignal({ checkName: "reload-persistence", outcome: "success" }, appBuild, originScope);
  const interval = window.setInterval(() => void flush(), 120_000);
  void flush();

  return () => {
    stopped = true;
    window.clearInterval(interval);
    if (retryTimer !== null) window.clearTimeout(retryTimer);
    window.removeEventListener(FIELD_CHECK_SIGNAL_EVENT, onSignal);
    document.removeEventListener("visibilitychange", onVisibility);
    window.removeEventListener("online", onOnline);
    window.removeEventListener("offline", onOffline);
    window.removeEventListener("calculator-performance", onPerformance);
    window.removeEventListener("app:api-failure", onApiFailure);
  };
}

export function FieldVerificationObserver({ appBuild }: { appBuild: string }) {
  const { isAuthenticated, isLoading, me } = useAuth();
  useEffect(() => {
    if (isLoading || !isAuthenticated || !me) return;
    const originScope = `${me.sandbox ? "sandbox" : "live"}:${me.userId}`;
    return createFieldCheckObserver(appBuild, originScope);
  }, [appBuild, isAuthenticated, isLoading, me]);
  return null;
}