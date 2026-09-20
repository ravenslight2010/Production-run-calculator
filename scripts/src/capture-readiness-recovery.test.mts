import { describe, expect, it } from "vitest";
import {
  READINESS_EVIDENCE_MAX_SAMPLES,
  READINESS_EVIDENCE_RETENTION_MS,
  buildReadinessEvidence,
  sanitizeReadinessResponse,
} from "./capture-readiness-recovery.mjs";

const revision = "a".repeat(40);
const generatedAt = "2026-09-18T12:00:00.000Z";

function healthySample() {
  return sanitizeReadinessResponse({
    capturedAt: generatedAt,
    httpStatus: 200,
    payload: {
      status: "ok",
      checks: {
        process: "ok",
        startup: "ok",
        database: "ok",
        dependencies: "ok",
        backgroundWorkers: "ok",
      },
      diagnostics: {
        backgroundOperations: {
          "daily-rollover": { status: "ok", recentFailureCount: 0, threshold: 3 },
        },
      },
      request: "must never be retained",
      recipe: "must never be retained",
    },
  });
}

function incidentSample() {
  return sanitizeReadinessResponse({
    capturedAt: "2026-09-18T12:00:05.000Z",
    httpStatus: 503,
    payload: {
      status: "degraded",
      checks: {
        process: "ok",
        startup: "ok",
        database: "ok",
        dependencies: "ok",
        backgroundWorkers: "error",
      },
      diagnostics: {
        backgroundOperations: {
          "daily-rollover": {
            status: "warning",
            recentFailureCount: 3,
            threshold: 3,
            lastFailureAt: "2026-09-18T12:00:04.000Z",
            errorCode: "PRIVATE_DATABASE_DETAIL",
          },
        },
      },
    },
  });
}

describe("readiness evidence projection", () => {
  it("retains only bounded readiness and worker outcomes", () => {
    const sample = healthySample();
    expect(sample).toMatchObject({
      httpStatus: 200,
      outcome: "healthy",
      checks: { database: "ok", backgroundWorkers: "ok" },
    });
    expect(JSON.stringify(sample)).not.toMatch(
      /request|recipe|PRIVATE_DATABASE_DETAIL|diagnostics/,
    );
    expect(sample.workers).toHaveLength(4);
  });

  it("distinguishes sustained normal operation from an incident and recovery", () => {
    const evidence = buildReadinessEvidence({
      environment: "release",
      deploymentId: "published-deployment-1",
      revision,
      generatedAt,
      mode: "recovery",
      samples: [healthySample(), incidentSample(), healthySample()],
    });

    expect(evidence.summary).toMatchObject({
      normal200Samples: 2,
      workerIncident503Samples: 1,
      recovery200Samples: 1,
      finalState: "incident_recovered",
      observedStates: ["normal_200", "worker_incident_503", "recovery_200"],
    });
    expect(evidence.verification).toMatchObject({ passed: true, mode: "recovery" });
    expect(evidence.expiresAt).toBe(
      new Date(Date.parse(generatedAt) + READINESS_EVIDENCE_RETENTION_MS).toISOString(),
    );
  });

  it("requires sustained 200 samples in normal mode", () => {
    const evidence = buildReadinessEvidence({
      environment: "development",
      deploymentId: "dev",
      revision,
      generatedAt,
      mode: "normal",
      samples: [healthySample(), healthySample()],
    });
    expect(evidence.verification.passed).toBe(true);
  });

  it("rejects unbounded sample collections", () => {
    expect(() =>
      buildReadinessEvidence({
        environment: "release",
        deploymentId: "published-deployment-1",
        revision,
        generatedAt,
        mode: "observe",
        samples: Array.from({ length: READINESS_EVIDENCE_MAX_SAMPLES + 1 }, healthySample),
      }),
    ).toThrow(/requires 1-60 samples/);
  });
});