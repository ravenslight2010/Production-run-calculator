import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import {
  summarizeTypescript7Report,
  verifyTypescript7ResourceApproval,
} from "./verify-typescript-7-resource-approval.mts";

const revision = "a".repeat(40);
const evidenceCommit = "b".repeat(40);
const runId = 123;
const runner = {
  platform: "linux",
  arch: "x64",
  image: "ubuntu24@fixture",
  hardwareClass: "c".repeat(64),
  logicalCpuCount: 4,
  memoryGiB: 16,
};
const row = (mode: string, elapsed: number, rss: number) => ({
  check: "build",
  mode,
  elapsedMs: { baseline: 10, candidate: elapsed, delta: elapsed - 10, ratio: elapsed / 10 },
  peakRssKiB: { baseline: 100, candidate: rss, delta: rss - 100, ratio: rss / 100 },
});
const checks = [
  "build",
  "scripts",
  "api-server",
  "run-calculator",
  "mockup-sandbox",
  "ai-evaluation",
  "corpus-harness",
];
const report = {
  schemaVersion: 3,
  sourceRevision: revision,
  status: "ADVISORY_DRIFT",
  runner: { ...runner, supported: true, supportedRunners: [] },
  performanceComparison: [
    ...checks.map((check, index) => ({
      ...row("cold", 12 - index / 10, 110 - index),
      check,
    })),
    ...checks.map((check, index) => ({
      ...row("warm", 11 - index / 10, 105 - index),
      check,
    })),
  ],
};

test("summarizes only compact resource approval fields", () => {
  assert.deepEqual(summarizeTypescript7Report(report), {
    sourceRevision: revision,
    reportSchemaVersion: 3,
    reportStatus: "ADVISORY_DRIFT",
    runner,
    measurementRows: { cold: 7, warm: 7 },
    coldMaxima: {
      candidateElapsedMs: 12,
      elapsedRatio: 1.2,
      candidatePeakRssKiB: 110,
      peakRssRatio: 1.1,
    },
    warmMaxima: {
      candidateElapsedMs: 11,
      elapsedRatio: 1.1,
      candidatePeakRssKiB: 105,
      peakRssRatio: 1.05,
    },
  });
});

test("rejects an approval record whose report hash does not match CI", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "ts7-approval-"));
  try {
    const runDir = resolve(root, String(runId));
    await mkdir(runDir);
    const reportBytes = Buffer.from(`${JSON.stringify(report)}\n`);
    await writeFile(resolve(runDir, "typescript-7-comparison.json"), reportBytes);
    await writeFile(
      resolve(runDir, "workflow-run.json"),
      JSON.stringify({
        id: runId,
        html_url: `https://github.com/example/repo/actions/runs/${runId}`,
        conclusion: "success",
        head_sha: evidenceCommit,
      }),
    );
    const summary = summarizeTypescript7Report(report);
    const payload = {
      schemaVersion: 1,
      reviewedAt: "2026-09-15",
      captureWorkflow: "TypeScript 7 resource capture",
      approvedBudgets: {
        maxElapsedRatio: 1.25,
        maxPeakRssRatio: 1.25,
        maxCandidateElapsedMs: 60000,
        maxCandidatePeakRssKiB: 1048576,
        minimumRevisions: 1,
        requiredModes: ["cold", "warm"],
      },
      samples: [{
        sourceRevision: revision,
        workflowRunId: runId,
        workflowRunUrl: `https://github.com/example/repo/actions/runs/${runId}`,
        workflowConclusion: "success",
        evidenceCommit,
        reportPath: "release-evidence/typescript-7-comparison.json",
        reportSha256: "d".repeat(64),
        ...summary,
      }],
    };
    const approval = {
      ...payload,
      integrity: {
        algorithm: "sha256",
        scope: "record-excluding-integrity",
        sha256: createHash("sha256").update(JSON.stringify(payload)).digest("hex"),
      },
    };
    const approvalPath = resolve(root, "approval.json");
    await writeFile(approvalPath, JSON.stringify(approval));
    await assert.rejects(
      verifyTypescript7ResourceApproval(approvalPath, root),
      /report SHA-256/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("accepts matching CI evidence and rejects report or workflow metadata drift", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "ts7-approval-match-"));
  try {
    const runDir = resolve(root, String(runId));
    await mkdir(runDir);
    const reportBytes = Buffer.from(`${JSON.stringify(report)}\n`);
    await writeFile(resolve(runDir, "typescript-7-comparison.json"), reportBytes);
    const workflowRunPath = resolve(runDir, "workflow-run.json");
    const workflowRun = {
      id: runId,
      html_url: `https://github.com/example/repo/actions/runs/${runId}`,
      conclusion: "success",
      head_sha: evidenceCommit,
    };
    await writeFile(workflowRunPath, JSON.stringify(workflowRun));
    const summary = summarizeTypescript7Report(report);
    const makeApproval = (sampleOverrides: Record<string, unknown> = {}) => {
      const payload = {
        schemaVersion: 1,
        reviewedAt: "2026-09-15",
        captureWorkflow: "TypeScript 7 resource capture",
        approvedBudgets: {
          maxElapsedRatio: 1.25,
          maxPeakRssRatio: 1.25,
          maxCandidateElapsedMs: 60000,
          maxCandidatePeakRssKiB: 1048576,
          minimumRevisions: 1,
          requiredModes: ["cold", "warm"],
        },
        samples: [{
          workflowRunId: runId,
          workflowRunUrl: workflowRun.html_url,
          workflowConclusion: "success",
          evidenceCommit,
          reportPath: "release-evidence/typescript-7-comparison.json",
          reportSha256: createHash("sha256").update(reportBytes).digest("hex"),
          ...summary,
          ...sampleOverrides,
        }],
      };
      return {
        ...payload,
        integrity: {
          algorithm: "sha256",
          scope: "record-excluding-integrity",
          sha256: createHash("sha256").update(JSON.stringify(payload)).digest("hex"),
        },
      };
    };
    const approvalPath = resolve(root, "approval.json");
    await writeFile(approvalPath, JSON.stringify(makeApproval()));
    await assert.doesNotReject(
      verifyTypescript7ResourceApproval(approvalPath, root),
    );

    await writeFile(
      approvalPath,
      JSON.stringify(makeApproval({
        coldMaxima: {
          ...(summary.coldMaxima as Record<string, unknown>),
          candidateElapsedMs: 13,
        },
      })),
    );
    await assert.rejects(
      verifyTypescript7ResourceApproval(approvalPath, root),
      /report summary/,
    );

    await writeFile(approvalPath, JSON.stringify(makeApproval()));
    await writeFile(
      workflowRunPath,
      JSON.stringify({ ...workflowRun, conclusion: "failure" }),
    );
    await assert.rejects(
      verifyTypescript7ResourceApproval(approvalPath, root),
      /workflow result/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});