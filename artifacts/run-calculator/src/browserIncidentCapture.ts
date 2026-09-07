import { WEB_BUILD_ID } from "./buildIdentity";
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
    const detail = (event as CustomEvent<{ path?: string; status?: number; correlationId?: string }>).detail;
    const kind = detail?.path?.includes("/sync") ? "sync" : "api_failure";
    void reportBrowserFailure(kind, new Error(`API ${detail?.status ?? "failure"}`), {
      diagnostics: {
        action: "call_api",
        outcome: "error",
        retryCount: 0,
        connectivity: navigator.onLine ? "online" : "offline",
        syncState: kind === "sync" ? "blocked" : "unknown",
        signalKind: kind,
        correlationId: detail?.correlationId,
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