import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const cli = fileURLToPath(new URL("./summarize-database-phases.mts", import.meta.url));
function run(input: string) {
  return spawnSync(process.execPath, ["--import", import.meta.resolve("tsx"), cli, input], {
    encoding: "utf8", timeout: 10_000,
  });
}

test("offline CLI summarizes only allowlisted evidence and flags malformed JSON without echoing it", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "phase-summary-fixture-"));
  try {
    const input = path.join(directory, "synthetic.jsonl");
    writeFileSync(input, [
      JSON.stringify({
        event: "background_database_phase",
        databasePhase: {
          version: 1, stage: "status_aggregate", coverage: "complete",
          phase: "post_checkout", outcome: "success",
          observedFrom: "2026-10-24T00:00:00.000Z", observedUntil: "2026-10-24T00:00:00.125Z",
          elapsedMs: 125, acquisitionMs: 25, postCheckoutMs: 100, timeoutOverrunMs: null,
        },
        sql: "PRIVATE_FIXTURE",
      }),
      JSON.stringify({ event: "scheduled_evaluation_queue_monitor", queryDurationMs: 9_999, identity: "PRIVATE_FIXTURE" }),
      JSON.stringify({ event: "unrelated", payload: "PRIVATE_FIXTURE" }),
    ].join("\n"));
    const successful = run(input);
    assert.equal(successful.status, 0, successful.stderr);
    const result = JSON.parse(successful.stdout);
    assert.equal(result.records, 2);
    assert.equal(result.legacyOrInvalid, 1);
    assert.equal(result.acquisition.maxMs, 25);
    assert.equal(result.postCheckout.maxMs, 100);
    assert.equal(result.provenance, "offline_input_environment_and_revision_not_verified");
    assert.doesNotMatch(successful.stdout + successful.stderr, /PRIVATE_FIXTURE|9999|identity|sql/);
    writeFileSync(input, "MALFORMED_PRIVATE_FIXTURE\n");
    const malformed = run(input);
    assert.equal(malformed.status, 1);
    assert.equal(JSON.parse(malformed.stdout).invalidJsonLines, 1);
    assert.doesNotMatch(malformed.stdout + malformed.stderr, /MALFORMED_PRIVATE_FIXTURE/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("offline CLI fails closed on oversized input lines and unreadable paths without echoing content or paths", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "phase-summary-fixture-"));
  try {
    const input = path.join(directory, "PRIVATE_FIXTURE.jsonl");
    writeFileSync(input, JSON.stringify({ payload: "PRIVATE_FIXTURE".repeat(6_000) }));
    for (const file of [input, path.join(directory, "MISSING_PRIVATE_FIXTURE")]) {
      const result = run(file);
      assert.equal(result.status, 1);
      assert.equal(result.stdout, "");
      assert.match(result.stderr, /Cannot summarize/);
      assert.doesNotMatch(result.stderr, /PRIVATE_FIXTURE|phase-summary-fixture/);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
