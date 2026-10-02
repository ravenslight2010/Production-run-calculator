import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { FULL_BROWSER_EXPECTED_CASES } from "./full-browser-case-contract.mts";
import { releaseGateLabelsForMode } from "./release-check.mts";
import { buildReleaseEvidenceHandoff } from "./release-evidence-handoff.mts";

const REVISION = "a".repeat(40);
const OTHER_REVISION = "b".repeat(40);

function passingReport(mode: "standard" | "full", revision = REVISION): string {
  const labels = releaseGateLabelsForMode(mode);
  return [
    "# Release Check Report",
    "",
    "Generated: 2026-10-01T12:00:00.000Z",
    `Revision: ${revision}`,
    `Mode: ${mode}`,
    "Environment: local release validation",
    "Source-library evidence environment: development",
    `Source-library evidence revision: ${revision}`,
    "Deployed revision: not applicable",
    "Readiness evidence: not produced",
    "Commands: listed in the gate results table below",
    "Evidence paths: release-evidence/ and retained files linked below",
    "",
    "## Gate results",
    "",
    "| Gate | Result | Elapsed | Command |",
    "| --- | --- | ---: | --- |",
    ...labels.map((label) => `| ${label} | PASS | 1s | \`pnpm test\` |`),
    "",
    "## Retained evaluations",
    "",
    "- [Deterministic corpus evaluation](ai-evaluations/deterministic-import-corpus.json)",
    "",
    "## Operational review",
    "",
    "Operational warnings: none",
    "Failures or accepted exceptions: none",
    "Interrupted gates: none",
    "Not-reached gates: none",
    "Accepted exceptions: none",
    "",
    "Decision: GO",
    "",
  ].join("\n");
}

function passingBrowserReport(revision = REVISION): string {
  return [
    "# Full Browser Release Run",
    "",
    "Generated: 2026-10-01T12:01:00.000Z",
    `Revision: ${revision}`,
    "Result: PASS",
    `Expected cases: ${FULL_BROWSER_EXPECTED_CASES}`,
    `Enumerated cases: ${FULL_BROWSER_EXPECTED_CASES}`,
    `Completed cases: ${FULL_BROWSER_EXPECTED_CASES}`,
    `Passed cases: ${FULL_BROWSER_EXPECTED_CASES}`,
    "Skipped cases: 0",
    "Failed cases: 0",
    "Not-run cases: 0",
    "Coverage: COMPLETE",
  ].join("\n");
}

async function writeEvidenceFile(
  evidenceRoot: string,
  path: string,
  contents = "{}\n",
): Promise<void> {
  const filePath = join(evidenceRoot, path);
  await mkdir(join(filePath, ".."), { recursive: true });
  await writeFile(filePath, contents, "utf8");
}

async function makeCompleteEvidence(
  root: string,
  mode: "standard" | "full",
  revision = REVISION,
): Promise<void> {
  const evidenceRoot = join(
    root,
    mode === "full" ? "release-evidence-full" : "release-evidence",
  );
  await mkdir(evidenceRoot, { recursive: true });
  await writeFile(join(evidenceRoot, "release-check-report.md"), passingReport(mode, revision));
  await writeEvidenceFile(evidenceRoot, "clean-start/clean-start-evidence.json");
  await writeEvidenceFile(evidenceRoot, "clean-start/browser-result.json");
  await writeEvidenceFile(
    evidenceRoot,
    "browser-smoke/webkit-result.json",
    `${JSON.stringify({ revision, environment: "ci", result: "passed" })}\n`,
  );
  await writeEvidenceFile(evidenceRoot, "report-key-rotation-preflight.json");
  await writeEvidenceFile(evidenceRoot, "source-library-reconciliation.json");
  await writeEvidenceFile(evidenceRoot, "typescript-7-comparison.json");
  await writeEvidenceFile(
    evidenceRoot,
    "ai-evaluations/deterministic-import-corpus.json",
  );
  if (mode === "full") {
    await writeEvidenceFile(
      evidenceRoot,
      "browser-full/FINAL-REPORT.md",
      passingBrowserReport(revision),
    );
  }
}

test("complete full evidence is revision-bound and never claims production GO", async () => {
  const root = await mkdtemp(join(tmpdir(), "release-handoff-complete-"));
  try {
    await makeCompleteEvidence(root, "full");
    const handoff = await buildReleaseEvidenceHandoff({
      mode: "full",
      revision: REVISION,
      repositoryRoot: root,
    });
    assert.equal(handoff.testEvidenceStatus, "PASS");
    assert.equal(handoff.exitCode, 0);
    assert.equal(handoff.browserEvidence.status, "PASS");
    assert.equal(handoff.webkitEvidence.status, "PASS");
    assert.equal(handoff.productionBinding, "GAP");
    assert.match(handoff.markdown, /Production GO: NOT CLAIMED/u);
    assert.match(
      handoff.markdown,
      new RegExp(`${FULL_BROWSER_EXPECTED_CASES}/${FULL_BROWSER_EXPECTED_CASES} passed`),
    );
    assert.match(
      handoff.markdown,
      /ai-evaluations\/deterministic-import-corpus\.json/u,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("complete standard evidence uses the standard gate and artifact contract", async () => {
  const root = await mkdtemp(join(tmpdir(), "release-handoff-standard-"));
  try {
    await makeCompleteEvidence(root, "standard");
    const handoff = await buildReleaseEvidenceHandoff({
      mode: "standard",
      revision: REVISION,
      repositoryRoot: root,
    });
    assert.equal(handoff.testEvidenceStatus, "PASS");
    assert.equal(handoff.exitCode, 0);
    assert.equal(handoff.browserEvidence.status, "MISSING");
    assert.equal(handoff.webkitEvidence.status, "PASS");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a newer same-revision checkpoint remains incomplete despite an older GO report", async () => {
  const root = await mkdtemp(join(tmpdir(), "release-handoff-checkpoint-"));
  try {
    await makeCompleteEvidence(root, "full");
    const evidenceRoot = join(root, "release-evidence-full");
    const checkpoint = [
      "# Release Check Checkpoint — INCOMPLETE / NO-GO",
      "",
      "Generated: 2026-10-01T12:02:00.000Z",
      `Revision: ${REVISION}`,
      "Mode: full",
      "Report status: INCOMPLETE CHECKPOINT",
      "Retained evidence: NOT UPDATED",
      "Environment: disposable CI gate test (not production reconciliation evidence)",
      "",
      "## Gate results",
      "",
      "| Gate | Result | Elapsed | Command |",
      "| --- | --- | ---: | --- |",
      `| ${releaseGateLabelsForMode("full")[0]} | FAIL | 1s | \`pnpm test\` |`,
      `| ${releaseGateLabelsForMode("full")[1]} | NOT REACHED | 0s | \`pnpm test\` |`,
      "",
      "## Operational review",
      "",
      `Root blockers: ${releaseGateLabelsForMode("full")[0]} (FAIL)`,
      "",
      "Decision: NO-GO",
    ].join("\n");
    await writeFile(join(evidenceRoot, "release-check-checkpoint.md"), checkpoint);
    const handoff = await buildReleaseEvidenceHandoff({
      mode: "full",
      revision: REVISION,
      repositoryRoot: root,
    });
    assert.equal(handoff.report.status, "PASS");
    assert.equal(handoff.checkpoint.status, "INCOMPLETE CHECKPOINT");
    assert.equal(handoff.testEvidenceStatus, "INCOMPLETE CHECKPOINT");
    assert.equal(handoff.exitCode, 2);
    assert.match(handoff.markdown, /retained evidence NOT UPDATED/u);
    assert.match(handoff.markdown, /NOT REACHED/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("missing evidence fails visibly", async () => {
  const root = await mkdtemp(join(tmpdir(), "release-handoff-missing-"));
  try {
    const handoff = await buildReleaseEvidenceHandoff({
      mode: "standard",
      revision: REVISION,
      repositoryRoot: root,
    });
    assert.equal(handoff.report.status, "MISSING");
    assert.equal(handoff.testEvidenceStatus, "MISSING");
    assert.equal(handoff.exitCode, 2);
    assert.match(handoff.markdown, /release-check-report\.md/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("missing required supporting evidence prevents a passing handoff", async () => {
  const root = await mkdtemp(join(tmpdir(), "release-handoff-missing-support-"));
  try {
    await makeCompleteEvidence(root, "standard");
    await rm(join(root, "release-evidence", "source-library-reconciliation.json"));
    const handoff = await buildReleaseEvidenceHandoff({
      mode: "standard",
      revision: REVISION,
      repositoryRoot: root,
    });
    assert.equal(handoff.report.status, "PASS");
    assert.equal(handoff.testEvidenceStatus, "INCOMPLETE");
    assert.equal(handoff.exitCode, 2);
    assert.match(
      handoff.markdown,
      /MISSING \(required\): \[`source-library-reconciliation\.json`\]/u,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("evidence-directory symlinks cannot escape the repository", async () => {
  const root = await mkdtemp(join(tmpdir(), "release-handoff-symlink-"));
  const outside = await mkdtemp(join(tmpdir(), "release-handoff-outside-"));
  try {
    await symlink(outside, join(root, "outside-evidence"));
    await assert.rejects(
      buildReleaseEvidenceHandoff({
        mode: "standard",
        revision: REVISION,
        repositoryRoot: root,
        evidenceDirectory: "outside-evidence",
      }),
      /evidence directory resolves outside the repository/u,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test("a report and browser result from another revision cannot be used as a pass", async () => {
  const root = await mkdtemp(join(tmpdir(), "release-handoff-stale-"));
  try {
    await makeCompleteEvidence(root, "full", OTHER_REVISION);
    const handoff = await buildReleaseEvidenceHandoff({
      mode: "full",
      revision: REVISION,
      repositoryRoot: root,
    });
    await writeEvidenceFile(
      join(root, "release-evidence-full"),
      "release-check-checkpoint.md",
      [
        "# Release Check Checkpoint — INCOMPLETE / NO-GO",
        "",
        "Generated: 2026-10-01T12:02:00.000Z",
        `Revision: ${OTHER_REVISION}`,
        "Mode: full",
        "Report status: INCOMPLETE CHECKPOINT",
        "Retained evidence: NOT UPDATED",
      ].join("\n"),
    );
    const withStaleCheckpoint = await buildReleaseEvidenceHandoff({
      mode: "full",
      revision: REVISION,
      repositoryRoot: root,
    });
    assert.equal(handoff.report.status, "STALE");
    assert.equal(handoff.browserEvidence.status, "STALE");
    assert.equal(handoff.testEvidenceStatus, "STALE");
    assert.equal(handoff.exitCode, 2);
    assert.match(handoff.markdown, /does not match requested revision/u);
    assert.equal(withStaleCheckpoint.checkpoint.status, "INCOMPLETE CHECKPOINT");
    assert.match(withStaleCheckpoint.markdown, /stale for the requested mode or revision/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});