import assert from "node:assert/strict";
import { test } from "node:test";
import * as fc from "fast-check";
import {
  assessConnectionBudget,
  buildSseCapacityReport,
} from "./sse-capacity-report-core.mts";
import { runSseCapacityReport } from "./sse-capacity-report.mts";

const fingerprint = "a".repeat(64);
const revision = {
  assessmentRevision: `test-sha256:${"b".repeat(64)}`,
  sourceRevision: `source-sha256:${"c".repeat(64)}`,
  verificationFingerprintSha256: "d".repeat(64),
};
const windowStart = "2026-10-11T00:00:00.000Z";
const windowEnd = "2026-10-11T00:10:00.000Z";
const platformMetrics = {
  schemaVersion: 1,
  kind: "sse-platform-capacity-metrics",
  windowStartUtc: windowStart,
  windowEndUtc: windowEnd,
  deploymentSourceFingerprintSha256: fingerprint,
  deploymentSourceFingerprintSource: "verified-deployment-handoff",
  apiProcessesPerMachine: 1,
  apiProcessesPerMachineSource: "verified-deployment-config",
  representativeWindowConfirmed: true,
  configuredMaximumMachines: 3,
  configuredMaximumCapturedAtUtc: "2026-10-11T00:10:00.000Z",
  configuredMaximumSource: "owner-reported",
  peakActiveMachines: 3,
  peakDatabaseClientBackends: 12,
  peakMetricsCapturedAtUtc: "2026-10-11T00:10:00.000Z",
  providerConnectionLimit: 450,
  providerReservedSlots: 4,
  providerMetricsCapturedAtUtc: "2026-10-11T00:10:00.000Z",
  providerMetricsSource: "provider-capacity-evidence",
  peakMetricsSource: "replit-monitoring-export",
};

function sample(
  capturedAt: string,
  database: Record<string, unknown> = {},
  schemaVersion = 1,
) {
  return {
    event: "database_capacity_sample",
    schemaVersion,
    environment: "production",
    capturedAt,
    intervalMs: 300_000,
    build: { appBuildId: "app-build:test", sourceFingerprintSha256: fingerprint },
    pool: { max: 10, total: 8, idle: 3, waiting: 0 },
    database: {
      status: "observed",
      primaryVerified: true,
      maxConnections: 450,
      superuserReservedSlots: 4,
      roleReservedSlots: 0,
      serverClientBackends: 9,
      ...(schemaVersion >= 2
        ? { activeWaitingBackends: 0, lockWaitingBackends: 0 }
        : {}),
      ...database,
    },
  };
}

function report(
  samples: unknown[],
  metrics: Record<string, unknown> = platformMetrics,
  extraLines: string[] = [],
  generatedAtUtc = "2026-10-11T00:11:00.000Z",
) {
  return buildSseCapacityReport({
    rawLogLines: [...samples, ...extraLines].map((entry) => JSON.stringify(entry)).join("\n"),
    platformMetrics: metrics,
    revision,
    generatedAtUtc,
  });
}

const completeSamples = [
  sample(windowStart),
  sample("2026-10-11T00:05:00.000Z"),
  sample(windowEnd),
];

test("emits a sanitized revision-bound report but never enables peer SSE", () => {
  const result = report(completeSamples);
  assert.equal(result.budgetAssessment.gate, "PROVEN_WITHIN_BUDGET");
  assert.equal(result.budgetAssessment.apiPoolConnectionUpperBound, 30);
  assert.equal(result.deploymentMetrics.configuredMaximumApiProcesses, 3);
  assert.equal(result.deploymentMetrics.observedPeakApiProcesses, 3);
  assert.equal(result.budgetAssessment.conservativeDemand, 42);
  assert.equal(result.budgetAssessment.doubleCountsObservedApplicationClients, true);
  assert.equal(result.reportRevision.sourceRevision, revision.sourceRevision);
  assert.equal(result.platformEvidenceFreshness.status, "fresh");
  assert.equal(result.platformEvidenceFreshness.maxAgeMs, 24 * 60 * 60 * 1_000);
  assert.equal(result.sourceCaptureFreshness.autoscale.status, "fresh");
  assert.equal(result.sourceCaptureFreshness.providerLimits.status, "fresh");
  assert.equal(result.sourceCaptureFreshness.peakMetrics.status, "fresh");
  assert.equal(result.deploymentMetrics.configuredMaximumCapturedAtUtc,
    platformMetrics.configuredMaximumCapturedAtUtc);
  assert.equal(result.deploymentMetrics.providerMetricsCapturedAtUtc,
    platformMetrics.providerMetricsCapturedAtUtc);
  assert.equal(result.deploymentMetrics.peakMetricsCapturedAtUtc,
    platformMetrics.peakMetricsCapturedAtUtc);
  assert.equal(result.conclusion.livePeerSseSupported, false);
  assert.equal(result.conclusion.deploymentSettingsChanged, false);
});

test("summarizes bounded PostgreSQL wait counts and keeps missing historical counts unknown", () => {
  const middleV2WithoutWaitCounts = {
    ...sample("2026-10-11T00:05:00.000Z"),
    schemaVersion: 2,
  };
  const legacy = report([
    sample(windowStart),
    middleV2WithoutWaitCounts,
    sample(windowEnd),
  ]);
  assert.deepEqual(legacy.capacitySamples.postgresWaitEvents, {
    sampleCount: 0,
    samplesWithActiveWaiters: 0,
    maximumActiveWaiters: null,
    samplesWithLockWaiters: 0,
    maximumLockWaiters: null,
  });

  const withWaitCounts = report([
    sample(windowStart, { activeWaitingBackends: 0, lockWaitingBackends: 0 }, 2),
    sample("2026-10-11T00:05:00.000Z", {
      activeWaitingBackends: 4,
      lockWaitingBackends: 2,
    }, 2),
    sample(windowEnd, { activeWaitingBackends: 1, lockWaitingBackends: 0 }, 2),
  ]);
  assert.deepEqual(withWaitCounts.capacitySamples.postgresWaitEvents, {
    sampleCount: 3,
    samplesWithActiveWaiters: 2,
    maximumActiveWaiters: 4,
    samplesWithLockWaiters: 1,
    maximumLockWaiters: 2,
  });
});

test("wait-count parser preserves bounds across generated inputs", () => {
  fc.assert(fc.property(
    fc.integer({ min: 0, max: 100 }),
    fc.integer({ min: 0, max: 100 }),
    (activeWaiters, candidateLockWaiters) => {
      const lockWaiters = Math.min(activeWaiters, candidateLockWaiters);
      const validSamples = [
        sample(windowStart, { activeWaitingBackends: activeWaiters, lockWaitingBackends: lockWaiters }, 2),
        sample("2026-10-11T00:05:00.000Z", {
          activeWaitingBackends: activeWaiters, lockWaitingBackends: lockWaiters,
        }, 2),
        sample(windowEnd, { activeWaitingBackends: activeWaiters, lockWaitingBackends: lockWaiters }, 2),
      ];
      const valid = report(validSamples);
      assert.equal(valid.capacitySamples.postgresWaitEvents.maximumActiveWaiters, activeWaiters);
      assert.equal(valid.capacitySamples.postgresWaitEvents.maximumLockWaiters, lockWaiters);

      if (candidateLockWaiters > activeWaiters) {
        const invalidSamples = [
          sample(windowStart, { activeWaitingBackends: activeWaiters, lockWaitingBackends: lockWaiters }, 2),
          sample("2026-10-11T00:05:00.000Z", {
            activeWaitingBackends: activeWaiters,
            lockWaitingBackends: candidateLockWaiters,
          }, 2),
          sample(windowEnd, { activeWaitingBackends: activeWaiters, lockWaitingBackends: lockWaiters }, 2),
        ];
        assert.throws(() => report(invalidSamples), /wait-event counts are inconsistent/i);
      }
    },
  ));

  const incomplete = sample("2026-10-11T00:05:00.000Z", {
    activeWaitingBackends: 1,
    lockWaitingBackends: undefined,
  }, 2);
  assert.throws(
    () => report([sample(windowStart), incomplete, sample(windowEnd)]),
    /incomplete wait-event counts/i,
  );
});

test("platform metrics remain fresh through 24 hours; older or future windows cannot prove a budget", () => {
  const freshnessBoundaryGeneratedAt = "2026-10-11T00:10:00.000Z";
  const staleWindowEnd = "2026-10-10T00:09:59.999Z";
  const staleWindowStart = "2026-10-09T23:59:59.999Z";
  const staleSamples = completeSamples.map((entry) => ({
    ...entry,
    capturedAt: new Date(Date.parse(entry.capturedAt) - 24 * 60 * 60 * 1_000 - 1)
      .toISOString(),
  }));
  const staleMetrics = {
    ...platformMetrics,
    windowStartUtc: staleWindowStart,
    windowEndUtc: staleWindowEnd,
  };
  const stale = report(staleSamples, staleMetrics, [], freshnessBoundaryGeneratedAt);
  assert.equal(stale.platformEvidenceFreshness.status, "stale");
  assert.equal(stale.platformEvidenceFreshness.windowEndAgeMs, 24 * 60 * 60 * 1_000 + 1);
  assert.equal(stale.budgetAssessment.gate, "UNKNOWN");
  assert.equal(stale.budgetAssessment.safeBudgetProven, false);
  assert.ok(stale.budgetAssessment.blockers.includes("platform_metrics_window_not_fresh"));
  assert.equal(stale.conclusion.livePeerSseSupported, false);

  const staleOverBudget = report(staleSamples, {
    ...staleMetrics,
    peakDatabaseClientBackends: 420,
  }, [], freshnessBoundaryGeneratedAt);
  assert.equal(staleOverBudget.budgetAssessment.gate, "UNKNOWN");
  assert.ok(staleOverBudget.budgetAssessment.blockers.includes(
    "platform_metrics_window_not_fresh",
  ));

  const freshWindowEnd = "2026-10-10T00:10:00.000Z";
  const freshWindowStart = "2026-10-10T00:00:00.000Z";
  const freshSamples = completeSamples.map((entry) => ({
    ...entry,
    capturedAt: new Date(Date.parse(entry.capturedAt) - 24 * 60 * 60 * 1_000)
      .toISOString(),
  }));
  const freshAtLimit = report(freshSamples, {
    ...platformMetrics,
    windowStartUtc: freshWindowStart,
    windowEndUtc: freshWindowEnd,
  }, [], freshnessBoundaryGeneratedAt);
  assert.equal(freshAtLimit.platformEvidenceFreshness.status, "fresh");
  assert.equal(freshAtLimit.platformEvidenceFreshness.windowEndAgeMs, 24 * 60 * 60 * 1_000);
  assert.equal(freshAtLimit.budgetAssessment.gate, "PROVEN_WITHIN_BUDGET");

  const future = report(completeSamples, platformMetrics, [], "2026-10-11T00:09:00.000Z");
  assert.equal(future.platformEvidenceFreshness.status, "future");
  assert.equal(future.budgetAssessment.gate, "UNKNOWN");
  assert.ok(future.budgetAssessment.blockers.includes("platform_metrics_window_not_fresh"));
  assert.equal(future.conclusion.livePeerSseSupported, false);
});

test("database client peak is derived from samples; missing platform/provider metrics remain UNKNOWN", () => {
  const incomplete = {
    ...platformMetrics,
    peakActiveMachines: null,
    peakDatabaseClientBackends: null,
    providerConnectionLimit: null,
    providerReservedSlots: null,
    providerMetricsSource: "unknown",
    peakMetricsSource: "unknown",
  };
  const result = report(completeSamples, incomplete);
  assert.equal(result.budgetAssessment.gate, "UNKNOWN");
  assert.equal(result.budgetAssessment.safeBudgetProven, false);
  assert.ok(result.budgetAssessment.blockers.includes("provider_connection_limit_missing"));
  assert.ok(result.budgetAssessment.blockers.includes("peak_machine_count_missing"));
  assert.equal(result.deploymentMetrics.peakDatabaseClientBackends, 9);
  assert.equal(result.deploymentMetrics.peakDatabaseClientSource, "sanitized-database-samples");
});

test("uses automatic sampled client peaks without a separate Replit metric", () => {
  const result = report(completeSamples, {
    ...platformMetrics,
    peakDatabaseClientBackends: null,
  });
  assert.equal(result.budgetAssessment.gate, "PROVEN_WITHIN_BUDGET");
  assert.equal(result.budgetAssessment.conservativeObservedClientCount, 9);
  assert.equal(result.deploymentMetrics.peakDatabaseClientSource, "sanitized-database-samples");
});

test("stale Autoscale capture makes only Autoscale values unknown", () => {
  const result = report(completeSamples, {
    ...platformMetrics,
    configuredMaximumCapturedAtUtc: "2026-10-10T00:10:00.000Z",
  });
  assert.equal(result.sourceCaptureFreshness.autoscale.status, "stale");
  assert.equal(result.deploymentMetrics.configuredMaximumMachines, null);
  assert.equal(result.deploymentMetrics.configuredMaximumSource, "unknown");
  assert.equal(result.deploymentMetrics.providerConnectionLimit, 450);
  assert.equal(result.deploymentMetrics.observedPeakMachines, 3);
  assert.ok(result.budgetAssessment.blockers.includes(
    "configured_machine_maximum_capture_time_stale",
  ));
  assert.equal(result.conclusion.livePeerSseSupported, false);
});

test("missing provider capture time makes only provider values unknown", () => {
  const result = report(completeSamples, {
    ...platformMetrics,
    providerMetricsCapturedAtUtc: null,
  });
  assert.equal(result.sourceCaptureFreshness.providerLimits.status, "missing");
  assert.equal(result.deploymentMetrics.providerConnectionLimit, null);
  assert.equal(result.deploymentMetrics.providerReservedSlots, null);
  assert.equal(result.deploymentMetrics.configuredMaximumMachines, 3);
  assert.equal(result.deploymentMetrics.observedPeakMachines, 3);
  assert.ok(result.budgetAssessment.blockers.includes(
    "provider_metrics_capture_time_missing",
  ));
});

test("future peak capture time makes only platform peak values unknown", () => {
  const result = report(completeSamples, {
    ...platformMetrics,
    peakMetricsCapturedAtUtc: "2026-10-11T00:12:00.000Z",
  });
  assert.equal(result.sourceCaptureFreshness.peakMetrics.status, "future");
  assert.equal(result.deploymentMetrics.observedPeakMachines, null);
  assert.equal(result.deploymentMetrics.peakDatabaseClientBackends, 9);
  assert.equal(result.deploymentMetrics.providerConnectionLimit, 450);
  assert.ok(result.budgetAssessment.blockers.includes("peak_metrics_capture_time_future"));
});

test("unverified deployment configuration or a mismatched sample window cannot pass", () => {
  const unverified = report(completeSamples, {
    ...platformMetrics,
    deploymentSourceFingerprintSha256: null,
    deploymentSourceFingerprintSource: "unknown",
    apiProcessesPerMachineSource: "unknown",
  });
  assert.equal(unverified.budgetAssessment.gate, "UNKNOWN");
  assert.ok(unverified.budgetAssessment.blockers.includes(
    "deployment_source_fingerprint_unverified",
  ));
  assert.ok(unverified.budgetAssessment.blockers.includes("api_process_count_source_unverified"));

  const outsideWindow = report([sample("2026-10-11T01:00:00.000Z")]);
  assert.equal(outsideWindow.capacitySamples.sampleCount, 0);
  assert.equal(outsideWindow.capacitySamples.completeForWindow, false);
  assert.equal(outsideWindow.budgetAssessment.gate, "UNKNOWN");
});

test("unavailable or non-primary samples break peak-window completeness", () => {
  const unavailable = sample("2026-10-11T00:05:00.000Z", {
    status: "unavailable",
    primaryVerified: false,
  });
  const result = report([completeSamples[0], unavailable, completeSamples[2]]);
  assert.equal(result.capacitySamples.completeForWindow, false);
  assert.equal(result.budgetAssessment.gate, "UNKNOWN");
  assert.equal(result.capacitySamples.unavailableReasonCounts.legacy_unclassified, 1);
});

test("reports bounded unavailable reasons without treating failures as complete samples", () => {
  const unavailable = sample("2026-10-11T00:05:00.000Z", {
    status: "unavailable",
    primaryVerified: false,
    unavailableReason: "pool_checkout_timeout",
    error: "must-not-be-retained",
  }, 2);
  const result = report([completeSamples[0], unavailable, completeSamples[2]]);
  assert.equal(result.capacitySamples.unavailableCount, 1);
  assert.equal(result.capacitySamples.unavailableReasonCounts.pool_checkout_timeout, 1);
  assert.equal(result.capacitySamples.completeForWindow, false);
  assert.equal(result.budgetAssessment.gate, "UNKNOWN");
  assert.equal(JSON.stringify(result).includes("must-not-be-retained"), false);
});

test("requires a v2 failure reason and rejects every reason outside the allowlist", () => {
  const missingReason = sample("2026-10-11T00:05:00.000Z", {
    status: "unavailable",
    primaryVerified: false,
  }, 2);
  assert.throws(() => report([completeSamples[0], missingReason, completeSamples[2]]));

  const validReasons = new Set([
    "pool_checkout_timeout",
    "pool_checkout_failed",
    "capacity_query_timeout",
    "capacity_query_cancelled",
    "capacity_query_failed",
    "invalid_capacity_result",
  ]);
  fc.assert(fc.property(
    fc.string().filter((reason) => !validReasons.has(reason)),
    (reason) => {
      const invalid = sample("2026-10-11T00:05:00.000Z", {
        status: "unavailable",
        primaryVerified: false,
        unavailableReason: reason,
      }, 2);
      assert.throws(() => report([completeSamples[0], invalid, completeSamples[2]]));
    },
  ));
});

test("reports allowlisted unavailable reasons and keeps pre-v2 history unclassified", () => {
  const samples = [
    sample(windowStart, {
      status: "unavailable",
      primaryVerified: false,
      unavailableReason: "pool_checkout_failed",
    }, 2),
    sample("2026-10-11T00:05:00.000Z", {
      status: "unavailable",
      primaryVerified: false,
      unavailableReason: "capacity_query_failed",
    }, 2),
    sample(windowEnd, { status: "unavailable", primaryVerified: false }),
  ];
  const result = report(samples);
  assert.deepEqual(result.capacitySamples.unavailableReasonCounts, {
    pool_checkout_timeout: 0,
    pool_checkout_failed: 1,
    capacity_query_timeout: 0,
    capacity_query_cancelled: 0,
    capacity_query_failed: 1,
    invalid_capacity_result: 0,
    legacy_unclassified: 1,
  });
  assert.equal(result.capacitySamples.unavailableCount, 3);
  assert.equal(result.capacitySamples.completeForWindow, false);
  assert.throws(
    () => report([sample(windowStart, {
      status: "unavailable",
      primaryVerified: false,
      unavailableReason: "private SQL error",
    })]),
    /invalid unavailable reason/i,
  );
  assert.throws(
    () => report([sample(windowStart, { unavailableReason: "pool_checkout_failed" })]),
    /cannot include an unavailable reason/i,
  );
});

test("mixed source revisions and unstructured lines cannot prove a budget", () => {
  const mixed = {
    ...completeSamples[1],
    build: { appBuildId: "app-build:other", sourceFingerprintSha256: "e".repeat(64) },
  };
  const mixedResult = report([completeSamples[0], mixed, completeSamples[2]]);
  assert.equal(mixedResult.budgetAssessment.gate, "UNKNOWN");
  assert.ok(mixedResult.budgetAssessment.blockers.includes("capacity_source_identity_inconsistent"));

  const wrongExpectedFingerprint = report(completeSamples, {
    ...platformMetrics,
    deploymentSourceFingerprintSha256: "f".repeat(64),
  });
  assert.equal(wrongExpectedFingerprint.budgetAssessment.gate, "UNKNOWN");
  assert.ok(wrongExpectedFingerprint.budgetAssessment.blockers.includes(
    "capacity_deployment_fingerprint_mismatch",
  ));

  const brokenExport = report(completeSamples, platformMetrics, ["not-json"]);
  assert.equal(brokenExport.budgetAssessment.gate, "UNKNOWN");
  assert.ok(brokenExport.budgetAssessment.blockers.includes("unstructured_log_lines_present"));
});

test("known demand above available slots produces NO_GO", () => {
  const overBudget = {
    ...platformMetrics,
    peakDatabaseClientBackends: 420,
  };
  const result = report(completeSamples, overBudget);
  assert.equal(result.budgetAssessment.gate, "NO_GO");
  assert.ok(result.budgetAssessment.blockers.includes("connection_demand_exceeds_available_slots"));
});

test("unrelated log payloads and extra capacity fields are never retained", () => {
  const sensitiveValue = "do-not-copy-this-host-or-token";
  const augmented = {
    ...completeSamples[1],
    host: sensitiveValue,
    password: sensitiveValue,
    database: { ...completeSamples[1]!.database, queryText: sensitiveValue },
  };
  const unrelated = {
    event: "application_request",
    session: sensitiveValue,
    requestBody: sensitiveValue,
  };
  const result = report([completeSamples[0], augmented, completeSamples[2], unrelated]);
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes(sensitiveValue), false);
  assert.equal(serialized.includes("requestBody"), false);
});

test("connection budget is monotone under added connection demand and provider reserves", () => {
  fc.assert(fc.property(
    fc.integer({ min: 0, max: 1_000_000 }),
    fc.integer({ min: 0, max: 1_000_000 }),
    fc.integer({ min: 0, max: 1_000_000 }),
    fc.integer({ min: 0, max: 1_000_000 }),
    fc.integer({ min: 0, max: 1_000_000 }),
    fc.integer({ min: 0, max: 1_000_000 }),
    (apiPool, peakClients, pgSlots, providerLimit, reserved, increase) => {
      const base = assessConnectionBudget({
        apiPoolUpperBound: apiPool,
        observedDatabaseClientPeak: peakClients,
        postgresOrdinarySlots: pgSlots,
        providerConnectionLimit: providerLimit,
        providerReservedSlots: reserved,
      });
      const moreDemand = assessConnectionBudget({
        apiPoolUpperBound: apiPool + increase,
        observedDatabaseClientPeak: peakClients,
        postgresOrdinarySlots: pgSlots,
        providerConnectionLimit: providerLimit,
        providerReservedSlots: reserved,
      });
      const moreReserved = assessConnectionBudget({
        apiPoolUpperBound: apiPool,
        observedDatabaseClientPeak: peakClients,
        postgresOrdinarySlots: pgSlots,
        providerConnectionLimit: providerLimit,
        providerReservedSlots: reserved + increase,
      });
      if (base.status === "over_budget") {
        assert.equal(moreDemand.status, "over_budget");
        assert.equal(moreReserved.status, "over_budget");
      }
    },
  ), { numRuns: 1_000 });
});

test("CLI help accepts pnpm's argument separator", async () => {
  const help = await runSseCapacityReport(["--", "--help"]);
  assert.match(help, /sanitized, revision-bound capacity report/);
  assert.match(help, /--samples/);
});
