import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  importSourceLibraryReconciliationEvidence,
} from "./import-source-library-reconciliation-evidence.mts";
import {
  DEFAULT_FROM_DATE,
  DEFAULT_HEAL_ID,
  DEFAULT_REPORT,
  computeSourceLibraryEvidenceId,
} from "./verify-source-library-reconciliation.mts";

const root = path.resolve(new URL("../../", import.meta.url).pathname);
const revision = "a".repeat(40);
const capturedAt = "2026-09-08T12:00:00.000Z";

function evidence(reportSha256: string, overrides: Record<string, unknown> = {}) {
  const value = {
    verifier: "source-library-reconciliation",
    environment: "release",
    revision,
    capturedAt,
    healId: DEFAULT_HEAL_ID,
    repairBoundary: { fromDate: DEFAULT_FROM_DATE },
    report: { sha256: reportSha256 },
    idempotencyFingerprint: {
      algorithm: "sha256",
      value: "b".repeat(64),
    },
    ok: true,
    failures: [],
    ...overrides,
  };
  return {
    ...value,
    evidenceId: computeSourceLibraryEvidenceId(value),
  };
}

const directory = await mkdtemp(path.join(tmpdir(), "source-evidence-import-"));
try {
  const report = path.resolve(root, DEFAULT_REPORT);
  const reportSha256 = createHash("sha256")
    .update(await readFile(report))
    .digest("hex");
  const input = path.join(directory, "input.json");
  const output = path.join(directory, "output.json");
  const now = new Date("2026-09-08T12:01:00.000Z");
  await writeFile(input, JSON.stringify(evidence(reportSha256)));

  await importSourceLibraryReconciliationEvidence({
    input,
    output,
    report,
    healId: DEFAULT_HEAL_ID,
    fromDate: DEFAULT_FROM_DATE,
    revision,
    now,
  });
  assert.deepEqual(await readFile(output), await readFile(input));

  const staleInput = path.join(directory, "stale.json");
  await writeFile(
    staleInput,
    JSON.stringify(evidence(reportSha256, { revision: "c".repeat(40) })),
  );
  await assert.rejects(
    importSourceLibraryReconciliationEvidence({
      input: staleInput,
      output,
      report,
      healId: DEFAULT_HEAL_ID,
      fromDate: DEFAULT_FROM_DATE,
      revision,
      now,
    }),
    /revision is stale or missing/,
  );

  await assert.rejects(
    importSourceLibraryReconciliationEvidence({
      input,
      output,
      report,
      healId: DEFAULT_HEAL_ID,
      fromDate: DEFAULT_FROM_DATE,
      revision: "unknown",
      now,
    }),
    /exact deployed 40-character Git commit SHA/,
  );

  const tamperedInput = path.join(directory, "tampered.json");
  const tampered = evidence(reportSha256);
  tampered.ok = false;
  await writeFile(tamperedInput, JSON.stringify(tampered));
  await assert.rejects(
    importSourceLibraryReconciliationEvidence({
      input: tamperedInput,
      output,
      report,
      healId: DEFAULT_HEAL_ID,
      fromDate: DEFAULT_FROM_DATE,
      revision,
      now,
    }),
    /invalid bounded content digest/,
  );

  const linkedInput = path.join(directory, "linked.json");
  await symlink(input, linkedInput);
  await assert.rejects(
    importSourceLibraryReconciliationEvidence({
      input: linkedInput,
      output,
      report,
      healId: DEFAULT_HEAL_ID,
      fromDate: DEFAULT_FROM_DATE,
      revision,
      now,
    }),
    /regular file/,
  );
} finally {
  await rm(directory, { recursive: true, force: true });
}

console.log("Source-library evidence importer tests passed.");