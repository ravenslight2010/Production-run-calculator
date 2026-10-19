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
      1: "Login or permission rejected",
      2: "Server rejected a stale/reset write",
      3: "Sync retries exhausted",
      4: "Server rejected the sync request",
    } as Record<number, string>)[metrics.failureCode!] ?? "Failure category unavailable (older evidence)";
  }
  if (checkName === "performance") {
    const source = ({
      1: "Home bundle load", 2: "Page navigation load",
      3: "API timeout", 4: "API transport failure",
      5: "API HTTP failure", 6: "API request cancelled",
    } as Record<number, string>)[metrics.sourceCode!] ?? "Source unavailable (older evidence)";
    const outcome = ({
      1: "HTTP 5xx",
      2: "authentication rejected",
      3: "HTTP 4xx",
      4: "transport failure",
      5: "browser reported offline",
      6: "client timeout",
      7: "cancelled",
    } as Record<number, string>)[metrics.outcomeCode!];
    const operation = ({
      1: "authentication",
      2: "diagnostics",
      3: "import",
      4: "inventory",
      5: "master data",
      6: "sync",
      7: "other API operation",
    } as Record<number, string>)[metrics.operationCode!];
    const background = metrics.backgroundCode === 1
      ? "background involvement observed"
      : Number.isInteger(metrics.backgroundCode)
        ? "no browser-hidden transition observed; OS suspension unknown"
        : null;
    const status = Number.isInteger(metrics.httpStatusCode) ? ` · HTTP ${metrics.httpStatusCode}` : "";
    const requestDetail = outcome
      ? ` · ${operation ?? "operation unavailable"} · ${outcome}${status}`
      : "";
    return `${source}${requestDetail}${Number.isFinite(metrics.durationMs) ? ` · client elapsed request wait ${metrics.durationMs === 10_000_000 ? "≥" : ""}${Math.round(metrics.durationMs!)} ms` : " · elapsed duration unavailable"}${background ? ` · ${background}` : ""}`;
  }
  return "";
}
