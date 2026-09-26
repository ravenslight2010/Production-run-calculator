import { execFile as execFileCallback } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import {
  READINESS_EVIDENCE_MAX_SAMPLES,
  READINESS_EVIDENCE_RETENTION_MS,
  READINESS_DEPLOYMENT_HANDOFF_MAX_AGE_MS,
  buildReadinessEvidence,
  sanitizeReadinessResponse,
  validateReadinessDeploymentHandoff,
  validateReadinessEvidence,
} from "./capture-readiness-recovery.mjs";

const execFile = promisify(execFileCallback);
const rootDir = path.resolve(new URL("../..", import.meta.url).pathname);
const revision = "a".repeat(40);
const generatedAt = "2026-09-18T12:00:00.000Z";
const deploymentId = "published-deployment-1";

function deploymentHandoff(overrides: Record<string, unknown> = {}) {
  const issuedAt = new Date(Date.now() - 1_000).toISOString();
  return {
    schemaVersion: 1,
    kind: "published-deployment-handoff",
    deploymentId,
    deployedRevision: revision,
    issuedAt,
    expiresAt: new Date(
      Date.parse(issuedAt) + READINESS_DEPLOYMENT_HANDOFF_MAX_AGE_MS,
    ).toISOString(),
    ...overrides,
  };
}

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
  it("accepts only a current bounded deployment handoff", () => {
    const handoff = validateReadinessDeploymentHandoff(deploymentHandoff());

    expect(handoff).toMatchObject({
      deploymentId,
      deployedRevision: revision,
      kind: "published-deployment-handoff",
    });
    expect(JSON.stringify(handoff)).not.toMatch(
      /url|response|credential|password|diagnostic|provider/i,
    );

    expect(() =>
      validateReadinessDeploymentHandoff(
        deploymentHandoff({
          expiresAt: new Date(Date.now() - 1_000).toISOString(),
        }),
      ),
    ).toThrow("Readiness deployment handoff is stale");
  });

  it("rejects conflicting deployment metadata before probing or writing evidence", async () => {
    const outputDirectory = await mkdtemp(
      path.join(rootDir, "tmp-readiness-handoff-conflict-"),
    );
    const handoffPath = path.join(outputDirectory, "deployment-handoff.json");
    const outputPath = path.join(outputDirectory, "readiness-recovery.json");
    await writeFile(handoffPath, `${JSON.stringify(deploymentHandoff())}\n`, "utf8");

    try {
      await expect(
        execFile(
          "pnpm",
          [
            "--filter",
            "@workspace/scripts",
            "exec",
            "tsx",
            "./src/capture-readiness-recovery.mts",
            "--url",
            "http://127.0.0.1:1/api/readyz",
            "--environment",
            "development",
            "--deployment-handoff",
            handoffPath,
            "--deployment-id",
            "different-published-deployment",
            "--samples",
            "1",
            "--interval-ms",
            "1",
            "--timeout-ms",
            "50",
            "--output",
            outputPath,
          ],
          {
            cwd: rootDir,
            env: process.env,
            maxBuffer: 128_000,
          },
        ),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining(
          "Readiness deployment handoff conflicts with --deployment-id",
        ),
      });
      await expect(readFile(outputPath)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await rm(outputDirectory, { recursive: true, force: true });
    }
  });

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

  it("captures a real HTTP normal, hard-failure, and recovery sequence", async () => {
    const servedStatuses: number[] = [];
    const servedPaths: string[] = [];
    let targetUrl = "";
    const server = createServer((request, response) => {
      const requestNumber = servedStatuses.length + 1;
      const isNormal = requestNumber <= 2;
      const isIncident = requestNumber > 2 && requestNumber <= 4;
      servedPaths.push(request.url ?? "");

      const payload = {
        status: isIncident ? "degraded" : "ok",
        checks: {
          process: "ok",
          // The fixture's 503 is caused by a hard readiness condition. Worker
          // diagnostics are included to prove they remain visible separately.
          startup: isIncident ? "error" : "ok",
          database: "ok",
          dependencies: "ok",
          backgroundWorkers: isIncident ? "error" : "ok",
        },
        startup: isIncident
          ? {
            phase: "failed",
            stage: "data_heals",
            errorCode: "fixture_startup_not_ready",
            privateDiagnostic: "FIXTURE_PRIVATE_STARTUP_DETAIL",
          }
          : undefined,
        diagnostics: {
          backgroundOperations: {
            "daily-rollover": {
              status: isIncident ? "warning" : "ok",
              recentFailureCount: isIncident ? 3 : 0,
              threshold: 3,
              lastFailureAt: isIncident
                ? "2026-09-18T12:00:04.000Z"
                : undefined,
              privateDiagnostic: "FIXTURE_PRIVATE_WORKER_DETAIL",
            },
          },
        },
        request: "FIXTURE_REQUEST_PAYLOAD",
        recipe: "FIXTURE_RECIPE_PAYLOAD",
        url: targetUrl,
        privateDiagnostic: "FIXTURE_PRIVATE_RESPONSE_DETAIL",
      };
      const status = isIncident ? 503 : 200;
      servedStatuses.push(status);
      response.statusCode = status;
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify(payload));

      // Keep this explicit so the test fails if the command probes a
      // different route or the fixture is accidentally reused for another
      // endpoint.
      if (request.url !== "/api/readyz") {
        response.destroy(new Error(`unexpected fixture path: ${request.url}`));
      }
    });

    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });

    const address = server.address();
    if (address === null || typeof address === "string") {
      server.close();
      throw new Error("readiness fixture did not receive a TCP address");
    }
    targetUrl = `http://127.0.0.1:${address.port}/api/readyz`;
    const outputDirectory = await mkdtemp(
      path.join(rootDir, "tmp-readiness-recovery-cli-"),
    );
    const outputPath = path.join(outputDirectory, "readiness-recovery.json");
    const handoffPath = path.join(outputDirectory, "deployment-handoff.json");
    await writeFile(
      handoffPath,
      `${JSON.stringify(
        deploymentHandoff({
          deploymentId: "local-recovery-fixture",
        }),
      )}\n`,
      "utf8",
    );

    try {
      const result = await execFile(
        "pnpm",
        [
          "--filter",
          "@workspace/scripts",
          "exec",
          "tsx",
          "./src/capture-readiness-recovery.mts",
          "--url",
          targetUrl,
          "--environment",
          "development",
          "--deployment-handoff",
          handoffPath,
          "--mode",
          "recovery",
          "--samples",
          "6",
          "--interval-ms",
          "1",
          "--timeout-ms",
          "1000",
          "--output",
          outputPath,
        ],
        {
          cwd: rootDir,
          env: process.env,
          maxBuffer: 128_000,
        },
      );
      expect(result.stdout).toContain("incident_recovered");
      expect(result.stderr).toBe("");

      const retainedJson = await readFile(outputPath, "utf8");
      const evidence = JSON.parse(retainedJson) as {
        samples: Array<{
          httpStatus: number;
          outcome: string;
          checks: Record<string, string>;
          workers: Array<{
            operation: string;
            status: string;
            recentFailureCount: number;
          }>;
        }>;
        summary: {
          normal200Samples: number;
          workerIncident503Samples: number;
          recovery200Samples: number;
          observedStates: string[];
          finalState: string;
        };
        verification: { mode: string; passed: boolean };
      };

      expect(servedStatuses).toEqual([200, 200, 503, 503, 200, 200]);
      expect(servedPaths).toEqual(Array(6).fill("/api/readyz"));
      expect(evidence.samples.map(({ httpStatus, outcome }) => [httpStatus, outcome]))
        .toEqual([
          [200, "healthy"],
          [200, "healthy"],
          [503, "worker_incident"],
          [503, "worker_incident"],
          [200, "healthy"],
          [200, "healthy"],
        ]);
      expect(evidence.samples[2]).toMatchObject({
        checks: {
          startup: "error",
          backgroundWorkers: "error",
        },
      });
      expect(evidence.samples[2]?.workers.find(
        ({ operation }) => operation === "daily-rollover",
      )).toMatchObject({
        operation: "daily-rollover",
        status: "warning",
        recentFailureCount: 3,
      });
      expect(evidence.summary).toEqual({
        normal200Samples: 4,
        workerIncident503Samples: 2,
        recovery200Samples: 2,
        observedStates: ["normal_200", "worker_incident_503", "recovery_200"],
        finalState: "incident_recovered",
      });
      expect(evidence.verification).toMatchObject({
        mode: "recovery",
        passed: true,
      });
      expect(
        validateReadinessEvidence(Buffer.from(retainedJson), {
          expectedDeploymentId: "local-recovery-fixture",
          expectedRevision: revision,
          now: new Date(),
        }),
      ).toMatchObject({
        deploymentId: "local-recovery-fixture",
        revision,
      });

      expect(retainedJson).not.toMatch(
        /FIXTURE_(?:REQUEST_PAYLOAD|RECIPE_PAYLOAD|PRIVATE_STARTUP_DETAIL|PRIVATE_WORKER_DETAIL|PRIVATE_RESPONSE_DETAIL)/,
      );
      expect(retainedJson).not.toContain(targetUrl);
      expect(retainedJson).not.toMatch(
        /"url"|"request"|"recipe"|"privateDiagnostic"|"diagnostics"/,
      );
    } finally {
      await rm(outputDirectory, { recursive: true, force: true });
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
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

  it("accepts only an unexpired record bound to the published deployment and revision", () => {
    const evidence = buildReadinessEvidence({
      environment: "release",
      deploymentId,
      revision,
      generatedAt,
      mode: "normal",
      samples: [healthySample(), healthySample()],
    });

    expect(
      validateReadinessEvidence(evidence, {
        expectedDeploymentId: deploymentId,
        expectedRevision: revision,
        now: new Date("2026-09-18T12:01:00.000Z"),
      }),
    ).toMatchObject({ deploymentId, revision });
  });

  it("rejects expired records and records that exceed the sample bound", () => {
    const evidence = buildReadinessEvidence({
      environment: "release",
      deploymentId,
      revision,
      generatedAt,
      mode: "normal",
      samples: [healthySample(), healthySample()],
    });
    expect(() =>
      validateReadinessEvidence(evidence, {
        expectedDeploymentId: deploymentId,
        expectedRevision: revision,
        now: new Date(evidence.expiresAt),
      }),
    ).toThrow("Readiness evidence is expired");

    const overBound = {
      ...evidence,
      samples: Array.from(
        { length: READINESS_EVIDENCE_MAX_SAMPLES + 1 },
        () => evidence.samples[0],
      ),
    };
    expect(() =>
      validateReadinessEvidence(overBound, {
        expectedDeploymentId: deploymentId,
        expectedRevision: revision,
        now: new Date("2026-09-18T12:01:00.000Z"),
      }),
    ).toThrow(/requires 1-60 samples/);
  });

  it("rejects provenance mismatches without echoing evidence details", () => {
    const evidence = buildReadinessEvidence({
      environment: "release",
      deploymentId,
      revision,
      generatedAt,
      mode: "normal",
      samples: [healthySample(), healthySample()],
    });
    expect(() =>
      validateReadinessEvidence(evidence, {
        expectedDeploymentId: "another-published-deployment",
        expectedRevision: "b".repeat(40),
        now: new Date("2026-09-18T12:01:00.000Z"),
      }),
    ).toThrow(/does not match the expected published deployment/);
    expect(() =>
      validateReadinessEvidence(evidence, {
        expectedDeploymentId: deploymentId,
        expectedRevision: "b".repeat(40),
        now: new Date("2026-09-18T12:01:00.000Z"),
      }),
    ).toThrow(/does not match the expected deployed revision/);
  });

  it("rejects prose snapshots and incomplete probe records as current proof", () => {
    for (const input of [
      "The published app was healthy during a live probe.",
      {
        kind: "readiness-recovery",
        deploymentId,
        revision,
        generatedAt,
        expiresAt: new Date(
          Date.parse(generatedAt) + READINESS_EVIDENCE_RETENTION_MS,
        ).toISOString(),
      },
    ]) {
      expect(() =>
        validateReadinessEvidence(input, {
          expectedDeploymentId: deploymentId,
          expectedRevision: revision,
          now: new Date("2026-09-18T12:01:00.000Z"),
        }),
      ).toThrow(/Readiness evidence/);
    }
    let failure: unknown;
    try {
      validateReadinessEvidence(
        Buffer.from("a prose snapshot with recipe details"),
        {
          expectedDeploymentId: deploymentId,
          expectedRevision: revision,
          now: new Date("2026-09-18T12:01:00.000Z"),
        },
      );
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toMatch(/valid JSON|JSON object/);
    expect((failure as Error).message).not.toMatch(/recipe|snapshot details/);
  });
});