import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { replaceWindowsMetadataFile, runWindowsMetadataHelper } from "./metadata-maintenance-windows.mts";
import { exportApplyLog } from "./distill-applylog-export.mts";

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

async function holdWindowsHandle(target: ReturnType<typeof fixture>, kind: "gate" | "decision") {
  const script = [
    "$ErrorActionPreference = 'Stop'",
    "$share = [IO.FileShare]::Read",
    "$filePath = $env:METADATA_TEST_DECISION",
    "if ($env:METADATA_TEST_KIND -eq 'gate') {",
    "  $share = [IO.FileShare]::None",
    "  $filePath = $env:METADATA_TEST_LOCK + '.recovery.gate'",
    "}",
    "$handle = [IO.File]::Open($filePath, [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, $share)",
    "if ($env:METADATA_TEST_KIND -eq 'gate') {",
    "  $time = (Get-Process -Id $PID).StartTime.ToFileTimeUtc().ToString([Globalization.CultureInfo]::InvariantCulture)",
    "  $owner = @{ pid=$PID; identity=@{ platform='win32'; creationTimeFileTime=$time } }",
    "  [IO.File]::WriteAllText($env:METADATA_TEST_LOCK, ($owner | ConvertTo-Json -Compress), (New-Object Text.UTF8Encoding($false)))",
    "}",
    "[Console]::WriteLine('handle-ready')",
    "[Console]::Out.Flush()",
    "Start-Sleep -Seconds 60",
  ].join("\n");
  const child = spawn(
    path.join(process.env.SystemRoot!, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
    ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script],
    {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        METADATA_TEST_DECISION: target.decisionPath,
        METADATA_TEST_LOCK: target.lockPath,
        METADATA_TEST_KIND: kind,
      },
    },
  );
  let output = "";
  let errors = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => { errors += chunk; });
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error(`Windows fixture handle did not become ready: ${errors}`));
    }, 10_000);
    const fail = (error: Error) => { clearTimeout(timeout); reject(error); };
    child.once("error", fail);
    child.once("exit", (code) => fail(new Error(`Windows fixture holder exited (${code}): ${errors}`)));
    child.stdout.on("data", (chunk: string) => {
      output += chunk;
      if (output.includes("handle-ready")) { clearTimeout(timeout); resolve(); }
    });
  });
  return {
    async stop() {
      await new Promise<void>((resolve, reject) => {
        child.once("error", reject);
        child.once("exit", () => resolve());
        child.kill();
      });
    },
  };
}

try {
  const forbiddenExportPath = path.join(root, "must-not-be-created.jsonl");
  await assert.rejects(exportApplyLog({
    apiBase: "https://example.invalid",
    cookieFile: path.join(root, "must-not-be-read.cookie"),
    out: forbiddenExportPath,
    repoRoot: root,
  }), /Private Apply-log export is not supported on Windows/u);
  assert.equal(fs.existsSync(forbiddenExportPath), false);

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

  const deadLegacy = fixture("dead-legacy");
  fs.writeFileSync(deadLegacy.lockPath, `${deadPid}\n`, { flag: "wx" });
  replaceWindowsMetadataFile(deadLegacy.decisionPath, deadLegacy.before, deadLegacy.before.toString("utf8"));
  assert.equal(fs.existsSync(deadLegacy.lockPath), false);

  const malformedCases = [
    '{"pid":',
    "null",
    JSON.stringify({ pid: process.pid, identity: { platform: "win32" } }),
    JSON.stringify({ pid: process.pid, identity: { platform: "linux", creationTimeFileTime: "1" } }),
    JSON.stringify({ pid: "123", identity: { platform: "win32", creationTimeFileTime: "1" } }),
    "x".repeat(257),
  ];
  for (const [index, contents] of malformedCases.entries()) {
    const malformed = fixture(`malformed-lock-${index}`);
    fs.writeFileSync(malformed.lockPath, contents, { flag: "wx" });
    assert.throws(
      () => replaceWindowsMetadataFile(malformed.decisionPath, malformed.before, "must not replace"),
      /malformed|invalid owner|leave it untouched/u,
    );
    assertUnchanged(malformed.decisionPath, malformed.before);
    assert.equal(fs.readFileSync(malformed.lockPath, "utf8"), contents);
  }

  const malformedRecovery = fixture("malformed-recovery-lock");
  fs.writeFileSync(`${malformedRecovery.lockPath}.recovery`, "not-json", { flag: "wx" });
  assert.throws(
    () => replaceWindowsMetadataFile(malformedRecovery.decisionPath, malformedRecovery.before, "must not replace"),
    /malformed|invalid owner|leave it untouched/u,
  );
  assertUnchanged(malformedRecovery.decisionPath, malformedRecovery.before);
  assert.equal(fs.readFileSync(`${malformedRecovery.lockPath}.recovery`, "utf8"), "not-json");

  const staleRecovery = fixture("stale-recovery");
  fs.writeFileSync(staleRecovery.lockPath, owner(deadPid, "1"), { flag: "wx" });
  fs.writeFileSync(`${staleRecovery.lockPath}.recovery`, owner(deadPid, "1"), { flag: "wx" });
  replaceWindowsMetadataFile(staleRecovery.decisionPath, staleRecovery.before, staleRecovery.before.toString("utf8"));
  assert.equal(fs.existsSync(staleRecovery.lockPath), false);
  assert.equal(fs.existsSync(`${staleRecovery.lockPath}.recovery`), false);
  assert.equal(fs.existsSync(`${staleRecovery.lockPath}.recovery.gate`), true);

  const interrupted = fixture("interrupted-writer");
  const holder = await holdWindowsHandle(interrupted, "gate");
  try {
    assert.throws(
      () => replaceWindowsMetadataFile(interrupted.decisionPath, interrupted.before, "must not replace"),
      /already in progress|gate is unavailable/u,
    );
    assertUnchanged(interrupted.decisionPath, interrupted.before);
  } finally {
    await holder.stop();
  }
  replaceWindowsMetadataFile(interrupted.decisionPath, interrupted.before, interrupted.before.toString("utf8"));
  assert.equal(fs.existsSync(interrupted.lockPath), false, "a terminated owner's lock is recoverable");

  const denied = fixture("replacement-denied");
  const destinationHolder = await holdWindowsHandle(denied, "decision");
  try {
    assert.throws(
      () => replaceWindowsMetadataFile(denied.decisionPath, denied.before, "must not replace"),
      /Windows metadata maintenance failed/u,
    );
    assertUnchanged(denied.decisionPath, denied.before);
  } finally {
    await destinationHolder.stop();
  }
  assert.equal(fs.existsSync(denied.lockPath), false);
  assert.equal(fs.readdirSync(root).some((name) => name.endsWith(".tmp")), false);

  const unicode = fixture("spaces caf\u00e9 \u4e2d\u6587");
  const unicodeAfter = JSON.stringify({ ...makeDecision(), maintenanceHistory: [{ ...entry, note: "Caf\u00e9 \u4e2d\u6587" }] });
  replaceWindowsMetadataFile(unicode.decisionPath, unicode.before, unicodeAfter);
  assert.equal(fs.readFileSync(unicode.decisionPath, "utf8"), unicodeAfter);

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
