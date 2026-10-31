import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, writeFile, rm, symlink, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { assessmentRevision } from "./release-source-identity.mjs";
import { SOURCE_POLICY } from "./build-source-files.mjs";
import { formatLocalReleaseReport } from "./local-release-evidence.mts";
import { compareLocalReleaseReports, parseLocalComparisonReport, readLocalComparisonInput } from "./compare-local-release.mts";
import type { ReleaseStepResult } from "./release-check.mts";

function report(checks: [string, ReleaseStepResult["status"]][], options: {
  source?: string; verification?: string; full?: boolean; completed?: boolean;
} = {}): string {
  const source = (options.source ?? "a").repeat(64);
  const verification = (options.verification ?? "b").repeat(64);
  return formatLocalReleaseReport({
    identity: {
      revision: assessmentRevision(SOURCE_POLICY, source, verification),
      sourceRevision: `source-sha256:${source}`, sourcePolicy: SOURCE_POLICY,
      sourceFingerprintSha256: source, verificationFingerprintSha256: verification,
    },
    full: options.full ?? false, completed: options.completed ?? true,
    expectedLabels: checks.map(([label]) => label),
    results: checks.map(([label, status]) => ({ label, status, elapsedMs: 0 })),
  });
}

test("exact identities, transitions, added/removed checks and source changes", () => {
  const before = report([["Case A", "PASS"], ["Case a", "FAIL"], ["same", "PASS"],
    ["still failed", "FAIL"], ["removed", "FAIL"]]);
  const after = report([["Case A", "FAIL"], ["Case a", "PASS"], ["same", "PASS"],
    ["still failed", "FAIL"], ["added", "PASS"]], { source: "c", full: true });
  const output = compareLocalReleaseReports(before, after);
  assert.match(output, /## newly failing \(1\)\n- Case A: PASS -> FAIL/);
  assert.match(output, /## recovered \(1\)\n- Case a: FAIL -> PASS/);
  assert.match(output, /## unchanged \(2\)/);
  assert.match(output, /## not comparable \(2\)/);
  assert.match(output, /added: MISSING -> PASS \(missing before\)/);
  assert.match(output, /removed: FAIL -> MISSING \(missing after\)/);
  assert.match(output, /Source changed: yes/);
  assert.match(output, /Check set changed: yes/);
  for (const value of ["a", "b", "c"]) assert.ok(output.includes(value.repeat(64)));
  assert.match(output, /Production decision: NOT ASSESSED/);
});

test("changed verification, incomplete attempts and non-final statuses never recover", () => {
  const before = report([["probe", "FAIL"]]);
  for (const after of [
    report([["probe", "PASS"]], { verification: "d" }),
    report([["probe", "PASS"]], { completed: false }),
    ...(["NOT REACHED", "BLOCKED", "INFRASTRUCTURE ERROR", "INFRASTRUCTURE TIMEOUT"] as const)
      .map((status) => report([["probe", status]])),
  ]) {
    const output = compareLocalReleaseReports(before, after);
    assert.match(output, /## recovered \(0\)/);
    assert.match(output, /## not comparable \(1\)/);
  }
  assert.match(compareLocalReleaseReports(report([["probe", "FAIL"]], { completed: false }),
    report([["probe", "PASS"]])), /incomplete attempt/);
});

test("malformed, duplicate, unsupported and inconsistent reports fail closed", () => {
  const good = report([["probe", "PASS"]]);
  for (const text of [
    "", good + "PRIVATE_PAYLOAD\n", good.replace("local-only", "production"),
    good.replace("- PASS probe", "- PASS probe\n- FAIL probe"),
    good.replace("- PASS probe", "- UNKNOWN probe"),
    good.replace("- PASS probe", "- PASS probe\u001b"),
    good.replace("Local result: PASS", "Local result: FAIL"),
    good.replace("Source fingerprint SHA-256: " + "a".repeat(64), "Source fingerprint SHA-256: " + "c".repeat(64)),
    good.replace("Check set: standard", "Check set: full"),
    good.replace("Captured: ", "Captured: PRIVATE_PAYLOAD\nCaptured: "),
    good.replace("Production decision: NOT ASSESSED", "Production decision: GO"),
    "x".repeat(1024 * 1024 + 1),
    report(Array.from({ length: 2001 }, (_, i) => [`case ${i}`, "PASS"])),
  ]) {
    assert.throws(() => parseLocalComparisonReport(text), /Invalid local report/);
    assert.throws(() => compareLocalReleaseReports(good, text), /Invalid local report/);
  }
});

test("bounded read-only CLI, private errors, symlink/device and UTF-8 rejection", async () => {
  const dir = await mkdtemp(join(tmpdir(), "local-compare-"));
  try {
    const before = join(dir, "before.md");
    const after = join(dir, "after.md");
    const text = report([["probe", "PASS"]]);
    await writeFile(before, text, { mode: 0o600 });
    await writeFile(after, text, { mode: 0o600 });
    assert.equal(await readLocalComparisonInput(before), text);
    const invoke = (args: string[]) => spawnSync(process.execPath,
      ["--import", "tsx", new URL("./compare-local-release.mts", import.meta.url).pathname, ...args],
      { encoding: "utf8" });
    const initial = await stat(before);
    const success = invoke([before, after]);
    assert.equal(success.status, 0, success.stderr);
    assert.match(success.stdout, /## unchanged \(1\)/);
    assert.equal(invoke(["--", before, after]).status, 0);
    assert.equal(await readFile(before, "utf8"), text);
    assert.equal((await stat(before)).mtimeMs, initial.mtimeMs);
    for (const args of [[], [before], [before, after, "extra"], [before, join(dir, "PRIVATE_PATH")]]) {
      const failure = invoke(args);
      assert.equal(failure.status, 1);
      assert.equal(failure.stdout, "");
      assert.doesNotMatch(failure.stderr, /PRIVATE_PATH|Error:|\/tmp\//);
    }
    await writeFile(after, "PRIVATE_PAYLOAD");
    const bad = invoke([before, after]);
    assert.equal(bad.status, 1);
    assert.doesNotMatch(bad.stdout + bad.stderr, /PRIVATE_PAYLOAD/);
    await symlink(before, join(dir, "link"));
    await assert.rejects(readLocalComparisonInput(join(dir, "link")));
    await assert.rejects(readLocalComparisonInput(dir));
    await assert.rejects(readLocalComparisonInput("/dev/zero"));
    await writeFile(after, Buffer.from([0xff]));
    await assert.rejects(readLocalComparisonInput(after));
    await writeFile(after, Buffer.alloc(1024 * 1024 + 1));
    await assert.rejects(readLocalComparisonInput(after));
  } finally { await rm(dir, { recursive: true, force: true }); }
});
