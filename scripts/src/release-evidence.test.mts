import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  RELEASE_EVIDENCE_ALLOWLIST,
  formatReleaseReport,
  runStep,
  verifyReleaseEvidence,
} from "./release-check.mts";

async function fixture(
  files: string[] = ["release-check-report.md"],
): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "release-evidence-"));
  for (const file of files) {
    const path = join(root, file);
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(path, "fixture evidence\n");
  }
  return root;
}

async function run(): Promise<void> {
  const timedOut = await runStep({
    label: "timed-out fixture",
    args: ["exec", "node", "-e", "setTimeout(() => {}, 5000)"],
    timeoutMs: 50,
  });
  assert.equal(timedOut.exitCode, 124);
  assert.equal(timedOut.status, "INFRASTRUCTURE TIMEOUT");
  assert.match(
    formatReleaseReport([
      {
        label: "timed-out fixture",
        status: timedOut.status,
        elapsedMs: timedOut.elapsedMs,
      },
    ]),
    /\| timed-out fixture \| INFRASTRUCTURE TIMEOUT \|/,
  );

  const failedChild = await runStep({
    label: "failed-child fixture",
    args: ["exec", "node", "-e", "process.exit(7)"],
  });
  assert.equal(failedChild.exitCode, 7);
  assert.equal(failedChild.status, "FAIL");
  assert.match(
    formatReleaseReport([
      {
        label: "failed-child fixture",
        status: failedChild.status,
        elapsedMs: failedChild.elapsedMs,
      },
    ]),
    /\| failed-child fixture \| FAIL \|/,
  );

  const signaledChild = await runStep({
    label: "signaled-child fixture",
    command: process.execPath,
    args: ["-e", "process.kill(process.pid, 'SIGTERM')"],
  });
  assert.equal(signaledChild.exitCode, 1);
  assert.equal(signaledChild.status, "INFRASTRUCTURE ERROR");
  assert.match(
    formatReleaseReport([
      {
        label: "signaled-child fixture",
        status: signaledChild.status,
        elapsedMs: signaledChild.elapsedMs,
      },
    ]),
    /\| signaled-child fixture \| INFRASTRUCTURE ERROR \|/,
  );

  const allowlistedFiles = [...RELEASE_EVIDENCE_ALLOWLIST];
  const root = await fixture(allowlistedFiles);
  try {
    await assert.doesNotReject(
      verifyReleaseEvidence(root),
      "an allowlisted evidence set should pass",
    );

    await rm(join(root, "release-check-report.md"));
    await assert.rejects(
      verifyReleaseEvidence(root),
      /release-check-report\.md \(missing\)/,
      "a missing report should be clearly identified",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }

  const forbiddenRoot = await fixture();
  try {
    await writeFile(join(forbiddenRoot, "debug.log"), "not retained\n");
    await assert.rejects(
      verifyReleaseEvidence(forbiddenRoot),
      /- debug\.log/,
      "a forbidden file should be listed in the validation error",
    );
  } finally {
    await rm(forbiddenRoot, { recursive: true, force: true });
  }

  const symlinkRoot = await fixture();
  try {
    await mkdir(join(symlinkRoot, "clean-start"), { recursive: true });
    await symlink(
      join(symlinkRoot, "release-check-report.md"),
      join(symlinkRoot, "clean-start", "startup-api.log"),
    );
    await assert.rejects(
      verifyReleaseEvidence(symlinkRoot),
      /- clean-start\/startup-api\.log/,
      "a symlink should be listed as an invalid evidence entry",
    );
  } finally {
    await rm(symlinkRoot, { recursive: true, force: true });
  }

  console.log(
    "Release evidence tests passed (allowlist, missing report, forbidden file, symlink).",
  );
}

await run();