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
const CORRELATION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
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
function buildIdentity(value: unknown) {
  const identity = record(value);
  const unknown = "unknown";
  return {
    appBuildId: typeof identity.appBuildId === "string" &&
      /^app-build:[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(identity.appBuildId)
      ? identity.appBuildId : unknown,
    revision: typeof identity.revision === "string" && /^[a-f0-9]{40}$/i.test(identity.revision)
      ? identity.revision : unknown,
    environment: category(identity.environment, ["deployed", "development", "unknown"]) === MISSING
      ? unknown : identity.environment as string,
  };
}
function diagnostics(name: string, value: unknown) {
  const metrics = record(value);
  const duration = metrics.durationMs;
  const durationMs = typeof duration === "number" && Number.isFinite(duration) && duration >= 0 && duration <= 10_000_000
    ? duration : MISSING;
  const failureCodes = name === "sync-acknowledgment" ? [1, 2, 3, 4]
    : name === "production-run-save-sync" ? [1, 2, 3, 4] : [];
  const failureCode = typeof metrics.failureCode === "number" && failureCodes.includes(metrics.failureCode)
    ? metrics.failureCode : MISSING;
  const sourceCode = name === "performance" && typeof metrics.sourceCode === "number" &&
    [1, 2, 3, 4, 5, 6].includes(metrics.sourceCode) ? metrics.sourceCode : MISSING;
  const requestOutcomeCode = name === "performance" && typeof metrics.outcomeCode === "number" &&
    [1, 2, 3, 4, 5, 6, 7].includes(metrics.outcomeCode) ? metrics.outcomeCode : MISSING;
  const operationCode = name === "performance" && typeof metrics.operationCode === "number" &&
    [1, 2, 3, 4, 5, 6, 7].includes(metrics.operationCode) ? metrics.operationCode : MISSING;
  const backgroundCode = name === "performance" && (metrics.backgroundCode === 0 || metrics.backgroundCode === 1)
    ? metrics.backgroundCode : MISSING;
  const httpStatusCode = name === "performance" && typeof metrics.httpStatusCode === "number" &&
    Number.isInteger(metrics.httpStatusCode) && metrics.httpStatusCode >= 400 && metrics.httpStatusCode <= 599
    ? metrics.httpStatusCode : MISSING;
  const requestDetailsAvailable = name === "performance" && requestOutcomeCode !== MISSING;
  return {
    durationMs, durationAtCeiling: durationMs === 10_000_000,
    failureCode, sourceCode,
    ...(requestDetailsAvailable
      ? { requestOutcomeCode, operationCode, backgroundCode, httpStatusCode }
      : {}),
  };
}

export function createFieldCheckExport(input: unknown, capturedAt = new Date()) {
  const report = record(input);
  const population = record(report.population);
  if (!Array.isArray(report.checks) || report.checks.length > CHECKS.length ||
      report.scope !== "current facility" || !Number.isFinite(capturedAt.getTime())) {
    throw new Error("Field-check report unavailable or too large");
  }
  const serverBuildIdentity = buildIdentity(report.buildIdentity);
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
      lastHardwareConfirmation: (() => {
        if (check.lastHardwareConfirmation === null || check.lastHardwareConfirmation === undefined) return null;
        const confirmation = record(check.lastHardwareConfirmation);
        return {
          outcome: category(confirmation.outcome, ["success", "failure", "incomplete"]),
          observedAt: timestamp(confirmation.observedAt),
          deviceCategory: category(confirmation.deviceCategory, DEVICES),
          buildIdentity: buildIdentity(confirmation.buildIdentity),
        };
      })(),
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
          reportedRequestCorrelationId:
            typeof failure.reportedRequestCorrelationId === "string" &&
            CORRELATION_ID.test(failure.reportedRequestCorrelationId)
              ? failure.reportedRequestCorrelationId : MISSING,
        };
      }),
    };
  });
  const envelope = {
    schemaVersion: 2,
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
      environment: serverBuildIdentity.environment,
      buildIdentity: serverBuildIdentity.appBuildId === MISSING || serverBuildIdentity.appBuildId === "unknown"
        ? "unknown" : "server-reported",
      serverBuildIdentity,
      notice: "Not release readiness or physical-device verification. Hardware entries are reported confirmations only. Server build identity does not prove which client bundle was installed on the device or published behavior.",
      missingDetailLabel: MISSING,
      coverage: "Existing report snapshot only; at most five recent non-successes per check. Not a complete observation history.",
      sanitization: "Server build identity is accepted only from the API's validated build record; exported fields are allowlisted. Fixed categories, canonical timestamps and bounded numeric diagnostics only. Request elapsed time is client-observed, not server duration. No secret values, device fingerprints, operational payloads or personal identifiers; an optional opaque correlation reference may be included.",
    },
    diagnosticCodeLegend: {
      syncFailure: { 1: "Login or permission rejected", 2: "Stale/reset write rejected", 3: "Sync retries exhausted" },
      productionRunSaveFailure: { 1: "Login or permission rejected", 2: "Stale/reset save rejected", 3: "Unrecoverable sync conflict", 4: "Sync retries exhausted" },
      performanceSource: { 1: "Home bundle load", 2: "Page navigation load", 3: "API timeout", 4: "API transport failure", 5: "API HTTP failure", 6: "API request cancelled" },
      requestOutcome: { 1: "HTTP 5xx", 2: "Authentication rejected", 3: "HTTP 4xx", 4: "Transport failure", 5: "Browser reported offline", 6: "Client timeout", 7: "Cancelled" },
      apiOperation: { 1: "Authentication", 2: "Diagnostics", 3: "Import", 4: "Inventory", 5: "Master data", 6: "Sync", 7: "Other" },
      backgroundInvolvement: { 0: "No browser-hidden transition observed; OS suspension unknown", 1: "Background/hidden transition observed" },
      reportedRequestCorrelationId: "Client-reported opaque server reference; not independently verified and never used for authorization.",
      legacyRequestClassification: "Missing structured request codes were not captured by the older record; do not infer an outcome, operation or background state.",
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
    filename: `field-check-report-v2-${capturedAt.toISOString().replace(/[:.]/g, "-")}.json`,
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
