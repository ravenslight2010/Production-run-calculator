import { WEB_BUILD_ID } from "./buildIdentity";
import type { ApiFailureEvent } from "./performanceDiagnostics";
import {
  reportIncident,
  type IncidentDiagnosis,
  type ReportIncidentBody,
} from "./inventoryShared";

const DEDUPE_WINDOW_MS = 60_000;
const MAX_REPORTS_PER_WINDOW = 4;
const recent = new Map<string, number>();
let windowStartedAt = 0;
let windowCount = 0;

function fingerprint(kind: string, message: string): string {
  return `${kind}|${WEB_BUILD_ID}|${location.pathname}|${message.slice(0, 160)}`;
}

export function reportBrowserFailure(
  kind: "crash" | "rejected_promise" | "api_failure" | "startup" | "update" | "sync",
  error: unknown,
  extra: Partial<ReportIncidentBody> = {},
): Promise<IncidentDiagnosis | undefined> {
  if (
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("screen") !== null
  ) {
    return Promise.resolve(undefined);
  }
  const now = Date.now();
  if (now - windowStartedAt >= DEDUPE_WINDOW_MS) {
    windowStartedAt = now;
    windowCount = 0;
    recent.clear();
  }
  const value = error instanceof Error ? error : new Error(typeof error === "string" ? error : "Unknown browser failure");
  const key = fingerprint(kind, value.message);
  if (windowCount >= MAX_REPORTS_PER_WINDOW || now - (recent.get(key) ?? 0) < DEDUPE_WINDOW_MS) {
    return Promise.resolve(undefined);
  }
  recent.set(key, now);
  windowCount += 1;
  return reportIncident({
    source: "auto_crash",
    screen: location.pathname,
    appPlatform: "web",
    appVersion: WEB_BUILD_ID,
    errorMessage: value.message,
    errorStack: value.stack,
    userAgent: navigator.userAgent,
    diagnostics: {
      action: kind === "rejected_promise" ? "complete_async_action"
        : kind === "api_failure" || kind === "sync" ? "call_api" : "render_screen",
      outcome: "error",
      retryCount: 0,
      connectivity: navigator.onLine ? "online" : "offline",
      syncState: "unknown",
      signalKind: kind,
    },
    ...extra,
  }).catch(() => undefined);
}

export function installBrowserFailureCapture(): () => void {
  const rejection = (event: PromiseRejectionEvent) => {
    void reportBrowserFailure("rejected_promise", event.reason);
  };
  window.addEventListener("unhandledrejection", rejection);
  const apiFailure = (event: Event) => {
    const detail = (event as CustomEvent<ApiFailureEvent>).detail;
    if (!detail?.requestOutcome || !detail.operationCategory) return;
    if (detail.cancellationClassification === "expected_auth_lifecycle") return;
    const kind = detail.operationCategory === "sync" ? "sync" : "api_failure";
    const errorMessage = detail.httpStatus !== undefined
      ? `API ${detail.httpStatus}`
      : ({
        transport_failure: "API transport failure",
        offline_failure: "API request failed while browser reported offline",
        timeout: "API request timed out",
        cancelled: "API request cancelled",
        http_server_error: "API server error",
        http_client_error: "API client error",
        authentication_rejected: "API authentication rejected",
      } as const)[detail.requestOutcome];
    void reportBrowserFailure(kind, new Error(errorMessage), {
      screen: "/",
      diagnostics: {
        action: "call_api",
        outcome: detail.requestOutcome === "cancelled" ? "degraded" : "error",
        retryCount: 0,
        connectivity: detail.connectivity ?? (navigator.onLine ? "online" : "offline"),
        syncState: kind === "sync" ? "blocked" : "unknown",
        signalKind: kind,
        ...(detail.correlationId ? { correlationId: detail.correlationId } : {}),
        requestOperationCategory: detail.operationCategory,
        ...(detail.requestRoute ? { requestRoute: detail.requestRoute } : {}),
        requestOutcome: detail.requestOutcome,
        ...(detail.reasonCode ? { requestReasonCode: detail.reasonCode } : {}),
        requestElapsedMs: detail.elapsedMs,
        requestObservedAt: detail.observedAt,
        requestBackgroundInvolvement: detail.backgroundObserved ? "observed" : "not_observed",
        requestHttpStatus: detail.httpStatus,
      },
    });
  };
  window.addEventListener("app:api-failure", apiFailure);
  return () => {
    window.removeEventListener("unhandledrejection", rejection);
    window.removeEventListener("app:api-failure", apiFailure);
  };
}

export function clearBrowserIncidentCaptureForTests(): void {
  recent.clear();
  windowStartedAt = 0;
  windowCount = 0;
}