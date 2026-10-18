import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { exportApplyLog } from "./distill-applylog-export.mts";
import { cleanupExpiredApplyLogExports } from "./distill-applylog-retention.mts";
import { IMPORT_SOURCE_RETENTION_MS } from "@workspace/db/schema";
import { sha256 } from "@workspace/distill-dataset";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "distill-applylog-export-"));
const repoRoot = path.join(root, "repo");
const privateDir = path.join(root, "private");
fs.mkdirSync(repoRoot, { recursive: true });
fs.mkdirSync(privateDir, { recursive: true, mode: 0o700 });
const cookieFile = path.join(privateDir, "manager-cookie.txt");
const outputFile = path.join(privateDir, "applylog.jsonl");
fs.writeFileSync(cookieFile, "session=synthetic-session", { mode: 0o600 });

const sourceText = "=== SHEET: Synthetic ===\nBrand\tAlpine Foods\nFlavor\tFour Cheese";
const page = {
  records: [{
    operationId: "import_1234567890123456",
    importType: "spec",
    scope: "live",
    status: "applied",
    undoneAt: null,
    actorCapability: "manage-profiles",
    actorIdSha256: "b".repeat(64),
    sourceSha256: sha256(sourceText),
    appliedAt: "2026-10-02T12:01:00.000Z",
    sourceText,
    parseVersion: "41",
    appliedValues: {
      brandProfiles: [{
        brand: "Alpine Foods",
        flavor: "Four Cheese",
        values: { pizzasPerCase: 12 },
      }],
    },
  }],
  nextCursor: null,
};

try {
  let requestedCookie = "";
  const result = await exportApplyLog({
    apiBase: "https://example.invalid",
    cookieFile,
    out: outputFile,
    repoRoot,
  }, {
    contract: { systemPrompt: "Synthetic prompt", systemPromptSha256: "a".repeat(64), currentParseVersion: "41" },
    fetchPage: async (_input, init) => {
      requestedCookie = new Headers(init?.headers).get("cookie") ?? "";
      return new Response(JSON.stringify(page), { status: 200, headers: { "content-type": "application/json" } });
    },
  });
  assert.deepEqual(result, { exported: 1, skipped: 0 });
  assert.equal(requestedCookie, "session=synthetic-session");
  assert.equal(fs.statSync(outputFile).mode & 0o777, 0o600);
  const line = JSON.parse(fs.readFileSync(outputFile, "utf8")) as Record<string, unknown>;
  assert.equal(line.sourceText, sourceText);
  assert.equal("actorId" in line, false);
  assert.equal(JSON.stringify(line).includes("synthetic-session"), false);
  const retentionMarkerPath = `${outputFile}.applylog-retention.json`;
  assert.equal(fs.statSync(retentionMarkerPath).mode & 0o777, 0o600);
  const marker = JSON.parse(fs.readFileSync(retentionMarkerPath, "utf8")) as {
    format: string;
    createdAt: string;
    expiresAt: string;
    outputFile: string;
  };
  assert.equal(marker.format, "private-applylog-export-retention-v1");
  assert.equal(marker.outputFile, path.basename(outputFile));
  assert.equal(Date.parse(marker.expiresAt) - Date.parse(marker.createdAt), IMPORT_SOURCE_RETENTION_MS);

  const unmarkedExport = path.join(privateDir, "unmarked-copy.jsonl");
  fs.writeFileSync(unmarkedExport, "private data", { mode: 0o600 });
  const beforeExpiry = await cleanupExpiredApplyLogExports({
    directory: privateDir,
    repoRoot,
    now: Date.parse(marker.expiresAt) - 1,
  });
  assert.deepEqual(beforeExpiry, {
    markedExportsExamined: 1,
    expiredExportsRemoved: 0,
    unexpiredExportsRetained: 1,
    invalidMarkersSkipped: 0,
    deletionFailures: 0,
  });
  assert.equal(fs.existsSync(outputFile), true);

  const afterExpiry = await cleanupExpiredApplyLogExports({
    directory: privateDir,
    repoRoot,
    now: Date.parse(marker.expiresAt),
  });
  assert.deepEqual(afterExpiry, {
    markedExportsExamined: 1,
    expiredExportsRemoved: 1,
    unexpiredExportsRetained: 0,
    invalidMarkersSkipped: 0,
    deletionFailures: 0,
  });
  assert.equal(fs.existsSync(outputFile), false);
  assert.equal(fs.existsSync(retentionMarkerPath), false);
  assert.equal(fs.existsSync(unmarkedExport), true);
  assert.deepEqual(await cleanupExpiredApplyLogExports({
    directory: privateDir,
    repoRoot,
    now: Date.parse(marker.expiresAt) + IMPORT_SOURCE_RETENTION_MS,
  }), {
    markedExportsExamined: 0,
    expiredExportsRemoved: 0,
    unexpiredExportsRetained: 0,
    invalidMarkersSkipped: 0,
    deletionFailures: 0,
  });

  await assert.rejects(exportApplyLog({
    apiBase: "https://example.invalid",
    cookieFile,
    out: path.join(repoRoot, "must-not-exist.jsonl"),
    repoRoot,
  }, {
    contract: { systemPrompt: "Synthetic prompt", systemPromptSha256: "a".repeat(64), currentParseVersion: "41" },
    fetchPage: async () => new Response("{}", { status: 200 }),
  }), /outside the repository/u);
  assert.equal(fs.existsSync(path.join(repoRoot, "must-not-exist.jsonl")), false);
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}