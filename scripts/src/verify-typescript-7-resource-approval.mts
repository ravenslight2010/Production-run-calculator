import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { validateTypescript7ResourceApprovalEvidence } from "./compare-typescript-7.mts";

type JsonRecord = Record<string, unknown>;

function record(value: unknown, label: string): JsonRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as JsonRecord;
}

function finite(values: unknown[], label: string): number {
  if (!values.every((value) => typeof value === "number" && Number.isFinite(value))) {
    throw new Error(`TypeScript 7 report has invalid ${label}.`);
  }
  return Math.max(...(values as number[]));
}

export function summarizeTypescript7Report(reportValue: unknown): JsonRecord {
  const report = record(reportValue, "TypeScript 7 report");
  if (!Array.isArray(report.performanceComparison)) {
    throw new Error("TypeScript 7 report has no performance comparison.");
  }
  const rows = report.performanceComparison.map((value) =>
    record(value, "TypeScript 7 performance row"),
  );
  const summarizeMode = (mode: string) => {
    const selected = rows.filter((row) => row.mode === mode);
    if (selected.length === 0) {
      throw new Error(`TypeScript 7 report has no ${mode} measurements.`);
    }
    return {
      measurementRows: selected.length,
      maxima: {
        candidateElapsedMs: finite(
          selected.map((row) => record(row.elapsedMs, "elapsedMs").candidate),
          `${mode} candidate elapsed measurements`,
        ),
        elapsedRatio: finite(
          selected.map((row) => record(row.elapsedMs, "elapsedMs").ratio),
          `${mode} elapsed ratios`,
        ),
        candidatePeakRssKiB: finite(
          selected.map((row) => record(row.peakRssKiB, "peakRssKiB").candidate),
          `${mode} candidate peak RSS measurements`,
        ),
        peakRssRatio: finite(
          selected.map((row) => record(row.peakRssKiB, "peakRssKiB").ratio),
          `${mode} peak RSS ratios`,
        ),
      },
    };
  };
  const cold = summarizeMode("cold");
  const warm = summarizeMode("warm");
  const runner = record(report.runner, "TypeScript 7 runner");
  return {
    sourceRevision: report.sourceRevision,
    reportSchemaVersion: report.schemaVersion,
    reportStatus: report.status,
    runner: {
      platform: runner.platform,
      arch: runner.arch,
      image: runner.image,
      hardwareClass: runner.hardwareClass,
      logicalCpuCount: runner.logicalCpuCount,
      memoryGiB: runner.memoryGiB,
    },
    measurementRows: {
      cold: cold.measurementRows,
      warm: warm.measurementRows,
    },
    coldMaxima: cold.maxima,
    warmMaxima: warm.maxima,
  };
}

function assertEqual(actual: unknown, expected: unknown, label: string): void {
  if (!isDeepStrictEqual(actual, expected)) {
    throw new Error(
      `TypeScript 7 approval mismatch for ${label}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}.`,
    );
  }
}

export async function verifyTypescript7ResourceApproval(
  approvalPath: string,
  reportsRoot: string,
): Promise<void> {
  const approvalBytes = await readFile(approvalPath);
  validateTypescript7ResourceApprovalEvidence(approvalBytes);
  const approval = record(JSON.parse(approvalBytes.toString("utf8")), "approval");
  const samples = approval.samples as JsonRecord[];

  for (const sample of samples) {
    const runId = String(sample.workflowRunId);
    const reportPath = resolve(reportsRoot, runId, "typescript-7-comparison.json");
    const runPath = resolve(reportsRoot, runId, "workflow-run.json");
    const reportBytes = await readFile(reportPath);
    const run = record(JSON.parse(await readFile(runPath, "utf8")), "workflow run");
    const summary = summarizeTypescript7Report(JSON.parse(reportBytes.toString("utf8")));
    const expectedSummary = {
      sourceRevision: sample.sourceRevision,
      reportSchemaVersion: sample.reportSchemaVersion,
      reportStatus: sample.reportStatus,
      runner: sample.runner,
      measurementRows: sample.measurementRows,
      coldMaxima: sample.coldMaxima,
      warmMaxima: sample.warmMaxima,
    };

    assertEqual(
      createHash("sha256").update(reportBytes).digest("hex"),
      sample.reportSha256,
      `${runId} report SHA-256`,
    );
    assertEqual(summary, expectedSummary, `${runId} report summary`);
    assertEqual(run.id, sample.workflowRunId, `${runId} workflow run ID`);
    assertEqual(run.html_url, sample.workflowRunUrl, `${runId} workflow URL`);
    assertEqual(run.conclusion, sample.workflowConclusion, `${runId} workflow result`);
    assertEqual(run.head_sha, sample.evidenceCommit, `${runId} evidence commit`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  const approvalPath =
    process.argv[2] ?? "docs/typescript-7-resource-approval-evidence.json";
  const reportsRoot = process.argv[3];
  if (!reportsRoot) {
    throw new Error("Usage: verify-typescript-7-resource-approval.mts <approval> <reports-dir>");
  }
  await verifyTypescript7ResourceApproval(approvalPath, reportsRoot);
  console.log("Verified every TypeScript 7 approval sample against its CI report.");
}