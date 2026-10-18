// Numeric categories only. Keep the v3 ingestion allowlist in sync.
export const SYNC_ACK_FAILURE_CODES = {
  authenticationRejected: 1,
  staleOrResetWrite: 2,
  retriesExhausted: 3,
} as const;
export const PERFORMANCE_SOURCE_CODES = {
  homeChunkLoad: 1,
  navigationLoad: 2,
  apiTimeout: 3,
  apiNetwork: 4,
} as const;

export function fieldCheckDiagnosticLabel(checkName: string, metrics: Record<string, number>): string {
  if (checkName === "sync-acknowledgment") {
    return ({
      1: "Login or permission rejected",
      2: "Server rejected a stale/reset write",
      3: "Sync retries exhausted",
    } as Record<number, string>)[metrics.failureCode!] ?? "Failure category unavailable (older evidence)";
  }
  if (checkName === "performance") {
    const source = ({
      1: "Home bundle load", 2: "Page navigation load",
      3: "API timeout / abort", 4: "API network failure",
    } as Record<number, string>)[metrics.sourceCode!] ?? "Source unavailable (older evidence)";
    return `${source}${Number.isFinite(metrics.durationMs) ? ` · ${metrics.durationMs === 10_000_000 ? "≥" : ""}${Math.round(metrics.durationMs!)} ms` : " · duration unavailable"}`;
  }
  return "";
}
