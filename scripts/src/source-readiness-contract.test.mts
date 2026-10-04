import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { buildInfoFromRecord, createSourceRecord } from "./build-source-identity.mjs";
import { sourceFixture } from "./fixtures/build-identity-fixture.mjs";
import { createPublishedSourceHandoff } from "./verify-published-build.mjs";
import { buildReadinessEvidence, sanitizeReadinessResponse,
  validateReadinessDeploymentHandoff, validateReadinessEvidence } from "./capture-readiness-recovery.mts";
import { resolveSourceLibraryRevision } from "./verify-source-library-reconciliation.mts";
import { captureReleaseIdentity } from "./release-source-identity.mjs";
import { formatReleaseReport, validateReleaseReport } from "./release-check.mts";

async function setup(t: Parameters<typeof sourceFixture>[0]) {
  const expected = createSourceRecord(sourceFixture(t));
  const server = createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(buildInfoFromRecord(expected, "release")));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const address = server.address();
  assert(address && typeof address !== "string");
  return createPublishedSourceHandoff({ url: `http://127.0.0.1:${address.port}`, expected });
}

test("source handoff/readiness/reconciliation operate with null Git revision", async (t) => {
  const raw = await setup(t);
  const handoff = validateReadinessDeploymentHandoff(raw);
  assert.equal(handoff.schemaVersion, 2);
  const capturedAt = new Date().toISOString();
  const sample = sanitizeReadinessResponse({
    capturedAt, httpStatus: 200, payload: { status: "ok" },
  });
  const evidence = buildReadinessEvidence({
    environment: "release", deploymentId: handoff.deploymentId,
    revision: handoff.deployedRevision, generatedAt: capturedAt,
    mode: "normal", samples: [sample, sample],
  });
  assert.equal(evidence.schemaVersion, 2);
  assert(validateReadinessEvidence(evidence, {
    expectedDeploymentId: handoff.deploymentId,
    expectedRevision: handoff.deployedRevision,
    expectedEnvironment: "release", expectedModes: ["normal"],
  }).verification.passed);
  assert.equal(resolveSourceLibraryRevision("release", handoff.deployedRevision), handoff.deployedRevision);
  assert.throws(() => validateReadinessEvidence(evidence, {
    expectedDeploymentId: handoff.deploymentId,
    expectedRevision: `source-sha256:${"f".repeat(64)}`,
  }), /stale|match/);
  assert.throws(() => validateReadinessEvidence({ ...evidence, schemaVersion: 1 }, {
    expectedDeploymentId: handoff.deploymentId,
    expectedRevision: handoff.deployedRevision,
  }), /malformed/);
});

test("source handoffs reject missing/mismatched independent expectations and expiry", async (t) => {
  const raw = await setup(t);
  for (const change of [
    { expectedSource: undefined },
    { expectedRecordSha256: "e".repeat(64) },
    { appBuildId: "app-build:00000000-0000-0000-0000-000000000000" },
    { sourceFingerprintSha256: "f".repeat(64) },
    { sourcePolicy: "unsupported-source-policy" },
    { expiresAt: new Date(0).toISOString() },
  ]) assert.throws(() => validateReadinessDeploymentHandoff({ ...raw, ...change }));
  assert.throws(() => validateReadinessDeploymentHandoff({
    ...raw, schemaVersion: 1, kind: "published-deployment-handoff",
  }), /revision.*malformed/);
});

test("release reports bind the source and test-definition fingerprints separately", () => {
  const identity = captureReleaseIdentity(path.resolve(new URL("../..", import.meta.url).pathname));
  const report = formatReleaseReport([], "standard", new Set(), {
    revision: identity.revision, expectedLabels: [], decision: "NO-GO",
  });
  assert(report.includes(`Source version: ${identity.sourceRevision}`));
  assert(report.includes(`Verification input fingerprint: ${identity.verificationFingerprintSha256}`));
  // This record is deliberately NO-GO: identity coverage cannot waive gates.
  for (const mutation of [
    report.replace(identity.sourceRevision, `source-sha256:${"f".repeat(64)}`),
    report.replace(identity.verificationFingerprintSha256, "e".repeat(64)),
    report.replace(/^Source version:.*\n/m, ""),
  ]) assert.throws(() => validateReleaseReport(mutation, {
    currentRevision: identity.revision, expectedLabels: [],
  }), /binding.*missing or stale/);
});

test("CLI discovers the source handoff automatically without Git identifiers", async (t) => {
  const root = sourceFixture(t);
  const expected = createSourceRecord(root);
  const input = path.join(root, "expected.json");
  const output = path.join(root, "readiness.json");
  await writeFile(input, JSON.stringify(expected));
  const server = createServer((request, response) => {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify(request.url === "/api/build-info"
      ? buildInfoFromRecord(expected, "release")
      : { status: "ok" }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const address = server.address();
  assert(address && typeof address !== "string");
  const project = path.resolve(new URL("../..", import.meta.url).pathname);
  const code = await new Promise<number | null>((resolve, reject) => {
    const child = spawn(process.execPath, [
      "--import", path.join(project, "scripts/node_modules/tsx/dist/loader.mjs"),
      path.join(project, "scripts/src/capture-readiness-recovery.mts"),
      "--url", `http://127.0.0.1:${address.port}/api/readyz`,
      "--environment", "release", "--expected-file", input,
      "--samples", "2", "--interval-ms", "1", "--output", output,
    ], { stdio: "ignore", timeout: 15_000 });
    child.once("error", reject);
    child.once("close", resolve);
  });
  assert.equal(code, 0);
  const evidence = JSON.parse(await readFile(output, "utf8"));
  assert.equal(evidence.schemaVersion, 2);
  assert.equal(evidence.revision, `source-sha256:${expected.sourceFingerprintSha256}`);
  assert.equal(evidence.deploymentId, expected.appBuildId);
  assert(evidence.verification.passed);
});