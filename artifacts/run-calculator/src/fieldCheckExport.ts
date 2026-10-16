// Deliberately independent of report DTO serialization: every output field is allowlisted.
const CHECKS = [
  "startup", "foreground-recovery", "sync-acknowledgment", "production-run-save-sync",
  "spec-import-review-commit", "cross-device-convergence", "reload-persistence",
  "offline-recovery", "offline-queue-replay", "pwa-update-handoff",
  "stale-deployment-recovery", "performance",
  "touch-accuracy", "keyboard-clearance", "orientation-layout", "safe-area-clearance",
  "camera-file-selection", "update-handoff", "process-kill-recovery",
] as const;
const DEVICES = ["desktop-chrome", "desktop-safari", "desktop-firefox", "mobile-chrome",
  "mobile-safari", "tablet-browser", "other-browser", "android-phone", "android-tablet", "ipad", "iphone"];
const STATUSES = ["healthy", "collecting", "needs-review", "unsupported"];
const COVERAGES = ["never-observed", "current", "stale", "no-success"];
export const FIELD_CHECK_EXPORT_MAX_BYTES = 64_000;
const MISSING = "unavailable";
function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}
function category(value: unknown, allowed: readonly string[]) {
  return typeof value === "string" && allowed.includes(value) ? value : MISSING;
}
function timestamp(value: unknown) {
  if (typeof value !== "string" || value.length > 40 ||
      !/^\d{4}-\d\d-\d\dT[\d:.]+(?:Z|[+-]\d\d:\d\d)$/.test(value)) return MISSING;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : MISSING;
}
function count(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 10_000_000
    ? value : MISSING;
}
function receiptDelay(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 172_800_000
    ? value : MISSING;
}
function diagnostics(name: string, value: unknown) {
  const metrics = record(value);
  const duration = metrics.durationMs;
  const durationMs = typeof duration === "number" && Number.isFinite(duration) && duration >= 0 && duration <= 10_000_000
    ? duration : MISSING;
  const failureCodes = name === "sync-acknowledgment" ? [1, 2, 3]
    : name === "production-run-save-sync" ? [1, 2, 3, 4] : [];
  const failureCode = typeof metrics.failureCode === "number" && failureCodes.includes(metrics.failureCode)
    ? metrics.failureCode : MISSING;
  const sourceCode = name === "performance" && typeof metrics.sourceCode === "number" &&
    [1, 2, 3, 4].includes(metrics.sourceCode) ? metrics.sourceCode : MISSING;
  return {
    durationMs, durationAtCeiling: durationMs === 10_000_000,
    failureCode, sourceCode,
  };
}

export function createFieldCheckExport(input: unknown, capturedAt = new Date()) {
  const report = record(input);
  const population = record(report.population);
  if (!Array.isArray(report.checks) || report.checks.length > CHECKS.length ||
      report.scope !== "current facility" || !Number.isFinite(capturedAt.getTime())) {
    throw new Error("Field-check report unavailable or too large");
  }
  const checks = report.checks.map((inputCheck) => {
    const check = record(inputCheck);
    const name = category(check.name, CHECKS);
    if (name === MISSING || !Array.isArray(check.recentFailures) || check.recentFailures.length > 5) {
      throw new Error("Unsupported or oversized field-check evidence");
    }
    return {
      name,
      status: category(check.status, STATUSES),
      coverage: category(check.coverage, COVERAGES),
      observedBy: category(check.observedBy, ["browser", "hardware"]),
      lastObservedAt: timestamp(check.lastObservedAt),
      lastReceiptDelayMs: receiptDelay(check.lastReceiptDelayMs),
      lastSuccessfulAt: timestamp(check.lastSuccessfulAt),
      lastSuccessfulDiagnostics: diagnostics(name, check.lastSuccessfulMetrics),
      failureCount: count(check.failureCount),
      incompleteCount: count(check.incompleteCount),
      actionable: typeof check.actionable === "boolean" ? check.actionable : MISSING,
      issueStatus: category(check.issueStatus, ["open", "recovered"]),
      recentFailures: check.recentFailures.map((inputFailure) => {
        const failure = record(inputFailure);
        return {
          outcome: category(failure.outcome, ["success", "failure", "incomplete"]),
          observedAt: timestamp(failure.observedAt),
          // Never echo an arbitrary build string, even if the API accepted it.
          buildCategory: failure.appBuild === "local" ? "unknown-local"
            : typeof failure.appBuild === "string" && /^[a-f0-9]{7,40}$/i.test(failure.appBuild)
              ? "revision-shaped-unverified" : "unknown",
          deviceCategory: category(failure.deviceCategory, DEVICES),
          diagnostics: diagnostics(name, failure.metrics),
        };
      }),
    };
  });
  const envelope = {
    schemaVersion: 1,
    capturedAt: capturedAt.toISOString(),
    facilityScope: "current facility",
    population: {
      selection: population.countBasis === "retained-observations" ? "filtered"
        : population.countBasis === "lifetime-issues" ? "unfiltered" : MISSING,
      countBasis: category(population.countBasis, ["retained-observations", "lifetime-issues"]),
      retentionDays: population.retentionDays === 30 ? 30 : MISSING,
      // Preserve population semantics without exporting a free-form build ID.
      buildSelection: population.appBuild === null ? "all"
        : population.appBuild === "local" ? "unknown-local"
          : typeof population.appBuild === "string" ? "selected-unverified" : MISSING,
      deviceCategory: population.deviceCategory === null ? "all"
        : category(population.deviceCategory, DEVICES),
    },
    provenance: {
      kind: "advisory-field-evidence",
      environment: "unknown",
      buildIdentity: "unknown",
      notice: "Not release readiness or physical-device verification. Hardware entries are reported confirmations only. Build categories do not verify revision identity or environment.",
      missingDetailLabel: MISSING,
      coverage: "Existing report snapshot only; at most five recent non-successes per check. Not a complete observation history.",
      sanitization: "Fixed categories, canonical timestamps and bounded numeric diagnostics only. No operational payloads or identifiers.",
    },
    diagnosticCodeLegend: {
      syncFailure: { 1: "Login or permission rejected", 2: "Stale/reset write rejected", 3: "Sync retries exhausted" },
      productionRunSaveFailure: { 1: "Login or permission rejected", 2: "Stale/reset save rejected", 3: "Unrecoverable sync conflict", 4: "Sync retries exhausted" },
      performanceSource: { 1: "Home bundle load", 2: "Page navigation load", 3: "API timeout / abort", 4: "API network failure" },
      durationAtCeiling: "A duration of 10000000 ms is a lower bound, not an exact duration.",
    },
    reportGeneratedAt: timestamp(report.generatedAt),
    overallStatus: category(report.overallStatus, STATUSES),
    checks,
  };
  const json = JSON.stringify(envelope, null, 2);
  if (new TextEncoder().encode(json).length > FIELD_CHECK_EXPORT_MAX_BYTES) {
    throw new Error("Field-check export too large");
  }
  return {
    json,
    filename: `field-check-report-v1-${capturedAt.toISOString().replace(/[:.]/g, "-")}.json`,
  };
}

export function downloadFieldCheckExport(input: unknown) {
  const { json, filename } = createFieldCheckExport(input);
  const blob = new Blob([json], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  try {
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
  } finally {
    anchor.remove();
    // Allow WebKit time to consume the object URL before releasing it.
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }
}
