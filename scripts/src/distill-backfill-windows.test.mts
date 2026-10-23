import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { replaceWindowsMetadataFile, runWindowsMetadataHelper } from "./metadata-maintenance-windows.mts";

assert.equal(process.platform, "win32", "Windows lock cases must run on native Windows, not Linux emulation");
assert.equal(process.arch, "x64", "the supported Windows runtime is x64");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "metadata-windows-synthetic-"));
const entry = {
  date: "2026-10-21",
  changeType: "metadata-only",
  note: "Synthetic Windows lock recovery test.",
};
function makeDecision() {
  return {
    format: "distill-backfill-decision",
    version: 1,
    decision: "no-go",
    decisionDate: "2026-10-02",
    currentParseVersion: "41",
    productionSystemPromptSha256: "a".repeat(64),
    benchmark: { outcome: "inconclusive", evidenceSha256: "b".repeat(64) },
    trainingEvaluation: { outcome: "no-go", evidenceSha256: "c".repeat(64) },
    datasetSafety: { outcome: "no-go", evidenceSha256: "d".repeat(64) },
    reasonCodes: ["test_no_go"],
    maintenanceHistory: [],
  };
}
function fixture(name: string) {
  const decisionPath = path.join(root, `${name}.json`);
  const before = Buffer.from(`${JSON.stringify(makeDecision(), null, 2)}\n`);
  fs.writeFileSync(decisionPath, before, { flag: "wx" });
  return { decisionPath, before, lockPath: `${decisionPath}.metadata-maintenance.lock` };
}
function owner(pid: number, creationTimeFileTime: string) {
  return JSON.stringify({
    pid,
    identity: { platform: "win32", creationTimeFileTime },
  });
}
function assertUnchanged(filePath: string, before: Buffer) {
  assert.deepEqual(fs.readFileSync(filePath), before, "rejected recovery must preserve the decision bytes");
}

try {
  const live = fixture("active-owner");
  const currentIdentity = runWindowsMetadataHelper({ operation: "identity", ownerPid: process.pid });
  fs.writeFileSync(live.lockPath, owner(process.pid, currentIdentity), { flag: "wx" });
  assert.throws(
    () => replaceWindowsMetadataFile(live.decisionPath, live.before, "must not replace"),
    /active|leave it untouched/u,
  );
  assertUnchanged(live.decisionPath, live.before);
  assert.ok(fs.existsSync(live.lockPath), "active owner lock must remain untouched");

  const reused = fixture("reused-pid");
  fs.writeFileSync(reused.lockPath, owner(process.pid, "1"), { flag: "wx" });
  replaceWindowsMetadataFile(reused.decisionPath, reused.before, `${JSON.stringify({
    ...makeDecision(),
    maintenanceHistory: [entry],
  }, null, 2)}\n`);
  assert.deepEqual(
    (JSON.parse(fs.readFileSync(reused.decisionPath, "utf8")) as ReturnType<typeof makeDecision>).maintenanceHistory,
    [entry],
    "a live PID with a different verified start identity is safely reclaimed",
  );

  let deadPid = 2_000_000_000;
  while (deadPid < 2_000_010_000) {
    try {
      process.kill(deadPid, 0);
      deadPid++;
    } catch (error) {
      if (typeof error === "object" && error !== null && "code" in error && error.code === "ESRCH") break;
      throw error;
    }
  }
  assert.ok(deadPid < 2_000_010_000, "find a definitely unused synthetic PID");
  const dead = fixture("dead-owner");
  fs.writeFileSync(dead.lockPath, owner(deadPid, "1"), { flag: "wx" });
  replaceWindowsMetadataFile(dead.decisionPath, dead.before, `${JSON.stringify({
    ...makeDecision(),
    maintenanceHistory: [entry],
  }, null, 2)}\n`);
  assert.equal(fs.existsSync(dead.lockPath), false);

  const legacy = fixture("legacy-lock");
  fs.writeFileSync(legacy.lockPath, `${process.pid}\n`, { flag: "wx" });
  assert.throws(
    () => replaceWindowsMetadataFile(legacy.decisionPath, legacy.before, "must not replace"),
    /legacy PID-only lock.*leave it untouched/u,
  );
  assertUnchanged(legacy.decisionPath, legacy.before);
  assert.equal(fs.readFileSync(legacy.lockPath, "utf8"), `${process.pid}\n`);

  const malformed = fixture("malformed-lock");
  fs.writeFileSync(malformed.lockPath, '{"pid":', { flag: "wx" });
  assert.throws(
    () => replaceWindowsMetadataFile(malformed.decisionPath, malformed.before, "must not replace"),
    /malformed|invalid owner|leave it untouched/u,
  );
  assertUnchanged(malformed.decisionPath, malformed.before);
  assert.equal(fs.readFileSync(malformed.lockPath, "utf8"), '{"pid":');

  const malformedRecovery = fixture("malformed-recovery-lock");
  fs.writeFileSync(`${malformedRecovery.lockPath}.recovery`, "not-json", { flag: "wx" });
  assert.throws(
    () => replaceWindowsMetadataFile(malformedRecovery.decisionPath, malformedRecovery.before, "must not replace"),
    /malformed|invalid owner|leave it untouched/u,
  );
  assertUnchanged(malformedRecovery.decisionPath, malformedRecovery.before);
  assert.equal(fs.readFileSync(`${malformedRecovery.lockPath}.recovery`, "utf8"), "not-json");

  const raced = fixture("changed-during-validation");
  const changed = Buffer.from(`${JSON.stringify({ ...makeDecision(), externalChange: true })}\n`);
  fs.writeFileSync(raced.decisionPath, changed);
  assert.throws(
    () => replaceWindowsMetadataFile(raced.decisionPath, raced.before, "must not replace"),
    /changed during validation/u,
  );
  assert.deepEqual(fs.readFileSync(raced.decisionPath), changed);
  console.log("Native Windows metadata lock recovery cases passed.");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
