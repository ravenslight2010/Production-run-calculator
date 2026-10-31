// Fixed numeric categories. Keep v4 ingestion validation and the v3 legacy
// reader in sync; route names and request text are never retained here.
export const SYNC_ACK_FAILURE_CODES = {
  authenticationRejected: 1,
  staleOrResetWrite: 2,
  retriesExhausted: 3,
  requestRejected: 4,
} as const;
export const PERFORMANCE_SOURCE_CODES = {
  homeChunkLoad: 1,
  navigationLoad: 2,
  apiTimeout: 3,
  apiNetwork: 4,
  apiHttpFailure: 5,
  apiCancelled: 6,
} as const;
export const API_REQUEST_OUTCOME_CODES = {
  httpServerError: 1,
  authenticationRejected: 2,
  httpClientError: 3,
  transportFailure: 4,
  offlineFailure: 5,
  timeout: 6,
  cancelled: 7,
} as const;
export const API_OPERATION_CODES = {
  authentication: 1,
  diagnostics: 2,
  import: 3,
  inventory: 4,
  masterData: 5,
  sync: 6,
  other: 7,
} as const;

export function fieldCheckDiagnosticLabel(checkName: string, metrics: Record<string, number>): string {
  if (checkName === "sync-acknowledgment") {
    return ({
      1: "The account or permission was rejected",
      2: "The saved update was out of date or came after a reset",
      3: "The app tried to sync again but did not receive confirmation",
      4: "The server rejected the sync request",
    } as Record<number, string>)[metrics.failureCode!] ?? "Failure category unavailable (older evidence)";
  }
  if (checkName === "performance") {
    const source = ({
      1: "Home screen did not load",
      2: "Page did not open",
      3: "App request timed out",
      4: "App could not reach the server",
      5: "Server returned an error",
      6: "Request ended before a reply",
    } as Record<number, string>)[metrics.sourceCode!] ?? "Source unavailable (older evidence)";
    const outcome = ({
      1: "server error",
      2: "account or permission rejected",
      3: "request rejected",
      4: "network connection failed",
      5: "browser reported no connection",
      6: "no reply before the app wait limit",
      7: "cancelled before a reply",
    } as Record<number, string>)[metrics.outcomeCode!];
    const operation = ({
      1: "signing in",
      2: "loading diagnostics",
      3: "importing",
      4: "loading inventory",
      5: "loading shared lists",
      6: "syncing",
      7: "another app request",
    } as Record<number, string>)[metrics.operationCode!];
    const background = metrics.backgroundCode === 1
      ? "app went into the background while waiting"
      : Number.isInteger(metrics.backgroundCode)
        ? "no background change observed; operating-system pause is unknown"
        : null;
    const status = Number.isInteger(metrics.httpStatusCode) ? ` · HTTP ${metrics.httpStatusCode}` : "";
    const requestDetail = outcome
      ? ` · ${operation ?? "operation unavailable"} · ${outcome}${status}`
      : "";
    return `${source}${requestDetail}${Number.isFinite(metrics.durationMs) ? ` · browser wait ${metrics.durationMs === 10_000_000 ? "at least " : ""}${Math.round(metrics.durationMs!)} ms` : " · wait duration unavailable"}${background ? ` · ${background}` : ""}. Browser wait is not server processing time.`;
  }
  return "";
}
