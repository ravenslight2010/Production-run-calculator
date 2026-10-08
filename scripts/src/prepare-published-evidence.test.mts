import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { buildInfoFromRecord, createSourceRecord, writeRecord } from "./build-source-identity.mjs";
import {
  buildReadinessEvidence,
  sanitizeReadinessResponse,
  validateReadinessDeploymentHandoff,
} from "./capture-readiness-recovery.mts";
import { sourceFixture } from "./fixtures/build-identity-fixture.mjs";
import { preparePublishedEvidence } from "./prepare-published-evidence.mts";

async function optionsFor(t: Parameters<typeof sourceFixture>[0]) {
  const root = await mkdtemp(path.join(os.tmpdir(), "published-evidence-"));
  t.after(async () => {
    const { rm } = await import("node:fs/promises");
    await rm(root, { recursive: true, force: true });
  });
  const expected = createSourceRecord(sourceFixture(t));
  const expectedFile = path.join(root, "expected-source.json");
  const reportPath = path.join(root, "report.json");
  const evidenceDirectory = path.join(root, "release-evidence");
  const sourceMatchPath = path.join(root, "published-source-match.json");
  const sourceHandoffPath = path.join(root, "published-source-handoff.json");
  writeRecord(expectedFile, expected);
  await writeFile(reportPath, "{}\n");
  const calls: string[] = [];
  const fetchImpl: typeof fetch = async (input) => {
    const url = new URL(String(input));
    calls.push(url.pathname);
    if (url.pathname === "/api/build-info") {
      return new Response(JSON.stringify(buildInfoFromRecord(expected, "release")), {
        status: 200,
        headers: { "content-type": "application/json", "cache-control": "no-store" },
      });
    }
    if (url.pathname === "/api") {
      return new Response(JSON.stringify({ status: "ok" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (url.pathname === "/api/profile-data/source-library-reconciliation/capture") {
      return new Response(JSON.stringify({ fixture: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response("not found", { status: 404 });
  };
  const captureReadinessEvidence = async (captureOptions: {
    deploymentHandoffPath?: string;
    outputPath?: string;
    environment: "development" | "release";
  }) => {
    assert.equal(captureOptions.environment, "release");
    const handoff = validateReadinessDeploymentHandoff(
      await readFile(captureOptions.deploymentHandoffPath!),
    );
    const capturedAt = new Date().toISOString();
    const sample = sanitizeReadinessResponse({
      capturedAt,
      httpStatus: 200,
      payload: { status: "ok" },
    });
    const evidence = buildReadinessEvidence({
      environment: "release",
      deploymentId: handoff.deploymentId,
      revision: handoff.deployedRevision,
      generatedAt: capturedAt,
      mode: "normal",
      samples: [sample, sample],
    });
    await writeFile(captureOptions.outputPath!, JSON.stringify(evidence));
    return evidence;
  };
  const importSourceLibraryReconciliationEvidence = async (importOptions: {
    inputBytes?: Uint8Array;
    output: string;
  }) => {
    assert.deepEqual(JSON.parse(Buffer.from(importOptions.inputBytes!).toString("utf8")), {
      fixture: true,
    });
    await writeFile(importOptions.output, JSON.stringify({ fixture: true }));
  };
  return {
    expected,
    calls,
    options: {
      url: "https://published.example/",
      expectedFile,
      evidenceDirectory,
      reportPath,
      healId: "source-library-reconciliation-2026-08-26-v2",
      fromDate: "2026-08-26",
      sourceMatchPath,
      sourceHandoffPath,
      fetchImpl,
    },
    dependencies: {
      captureReadinessEvidence,
      importSourceLibraryReconciliationEvidence,
    },
  };
}

test("post-publish evidence is staged and bound to the independent source record", async (t) => {
  const fixture = await optionsFor(t);
  const result = await preparePublishedEvidence(fixture.options, fixture.dependencies);
  assert.equal(result.appBuildId, fixture.expected.appBuildId);
  assert.equal(
    result.sourceFingerprintSha256,
    fixture.expected.sourceFingerprintSha256,
  );
  assert.deepEqual(fixture.calls.filter((path) => path === "/api/build-info").length, 2);
  assert.equal(fixture.calls.filter((path) => path === "/api").length, 2);
  assert.equal(
    fixture.calls.filter((path) =>
      path === "/api/profile-data/source-library-reconciliation/capture").length,
    1,
  );

  const [matchPath, handoffPath, readinessPath, reconciliationPath] = result.files;
  const match = JSON.parse(await readFile(matchPath!, "utf8"));
  const handoff = validateReadinessDeploymentHandoff(
    JSON.parse(await readFile(handoffPath!, "utf8")),
  );
  const readiness = JSON.parse(await readFile(readinessPath!, "utf8"));
  const reconciliation = JSON.parse(await readFile(reconciliationPath!, "utf8"));
  assert.equal(match.productionGo, false);
  assert.equal(handoff.deploymentId, fixture.expected.appBuildId);
  assert.equal(handoff.deployedRevision,
    `source-sha256:${fixture.expected.sourceFingerprintSha256}`);
  assert.equal(readiness.deploymentId, handoff.deploymentId);
  assert.deepEqual(reconciliation, { fixture: true });
  for (const file of result.files)
    assert(!JSON.stringify(JSON.parse(await readFile(file, "utf8"))).includes(fixture.options.url));
});

test("a failed current reconciliation capture does not promote partial evidence", async (t) => {
  const fixture = await optionsFor(t);
  const failingFetch: typeof fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname === "/api/profile-data/source-library-reconciliation/capture")
      return new Response("unavailable", { status: 503 });
    return fixture.options.fetchImpl!(input);
  };
  await assert.rejects(preparePublishedEvidence({
    ...fixture.options,
    fetchImpl: failingFetch,
  }, fixture.dependencies), /Published reconciliation capture is unavailable/);
  for (const file of [
    fixture.options.sourceMatchPath!,
    fixture.options.sourceHandoffPath!,
    path.join(fixture.options.evidenceDirectory, "readiness-recovery/readiness-recovery.json"),
    path.join(fixture.options.evidenceDirectory, "source-library-reconciliation.json"),
  ]) {
    await assert.rejects(readFile(file));
  }
});
