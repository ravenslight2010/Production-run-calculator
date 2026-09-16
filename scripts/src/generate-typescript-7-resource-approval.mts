import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { validateTypescript7ResourceApprovalEvidence } from "./compare-typescript-7.mts";
import { validateTypescript7ComparisonEvidence } from "./release-check.mts";
import { TYPESCRIPT_7_RESOURCE_BUDGETS } from "./typescript-7-resource-contract.mts";

const REPORT_PATH = "release-evidence/typescript-7-comparison.json";
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const REVISION_PATTERN = /^[a-f0-9]{40}$/u;
const WORKFLOW_URL_PATTERN =
  /^https:\/\/github\.com\/[^/]+\/[^/]+\/actions\/runs\/(\d+)$/u;
const MODES = ["cold", "warm"] as const;

type Provenance = {
  workflowRunId: number;
  workflowRunUrl: string;
  workflowConclusion: "success";
  evidenceCommit: string;
};

export type Typescript7ApprovalInput = {
  reportBytes: Buffer;
  provenance: Provenance;
};

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function requireExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  label: string,
): void {
  const actual = Object.keys(value).sort();
  const allowed = [...expected].sort();
  if (
    actual.length !== allowed.length ||
    actual.some((key, index) => key !== allowed[index])
  ) {
    throw new Error(`${label} contains unexpected or missing fields.`);
  }
}

function assertStrictSchemaV3(report: Record<string, unknown>): void {
  requireExactKeys(
    report,
    [
      "schemaVersion", "sourceRevision", "status", "authoritativeCompiler",
      "candidateCompiler", "runner", "commands", "performanceComparison",
      "resourceBudgets", "trend", "promotionAssessment", "promotionAttempt",
      "editorService", "diagnosticsEqual", "declarations",
      "acceptanceGatesMet", "advisory", "authoritativeOutputsChanged",
      "containment",
    ],
    "TypeScript 7 comparison report",
  );
  requireExactKeys(
    record(report.runner, "runner"),
    [
      "platform", "arch", "supported", "supportedRunners", "image",
      "hardwareClass", "logicalCpuCount", "memoryGiB",
    ],
    "runner",
  );
  for (const [index, command] of (report.commands as unknown[]).entries()) {
    requireExactKeys(
      record(command, `commands[${index}]`),
      ["name", "exitCode", "elapsedMs", "peakRssKiB", "diagnostics"],
      `commands[${index}]`,
    );
  }
  for (const [index, comparison] of (
    report.performanceComparison as unknown[]
  ).entries()) {
    const item = record(comparison, `performanceComparison[${index}]`);
    requireExactKeys(
      item,
      ["check", "mode", "elapsedMs", "peakRssKiB"],
      `performanceComparison[${index}]`,
    );
    for (const metric of ["elapsedMs", "peakRssKiB"] as const) {
      requireExactKeys(
        record(item[metric], `performanceComparison[${index}].${metric}`),
        ["baseline", "candidate", "delta", "ratio"],
        `performanceComparison[${index}].${metric}`,
      );
    }
  }
  requireExactKeys(
    record(report.resourceBudgets, "resourceBudgets"),
    [
      "maxElapsedRatio", "maxPeakRssRatio", "maxCandidateElapsedMs",
      "maxCandidatePeakRssKiB", "minimumRevisions", "requiredModes",
      "approvedForPromotion",
    ],
    "resourceBudgets",
  );
  requireExactKeys(
    record(report.trend, "trend"),
    [
      "historyLimit", "incompatibleRunnerClassSamples",
      "distinctRevisionCount", "regressedRevisions", "revisionSamples",
    ],
    "trend",
  );
  requireExactKeys(
    record(report.promotionAssessment, "promotionAssessment"),
    [
      "eligible", "thresholdApprovalRequired", "repeatedEvidenceMet",
      "resourceBudgetsMet", "resourceRegressions",
    ],
    "promotionAssessment",
  );
  requireExactKeys(
    record(report.declarations, "declarations"),
    ["baseline", "candidate", "changedPaths"],
    "declarations",
  );
  requireExactKeys(
    record(report.containment, "containment"),
    ["beforeStatusSha256", "afterStatusSha256"],
    "containment",
  );
}

function validateProvenance(provenance: Provenance): void {
  const urlRunId = provenance.workflowRunUrl.match(WORKFLOW_URL_PATTERN)?.[1];
  if (
    !Number.isSafeInteger(provenance.workflowRunId) ||
    provenance.workflowRunId <= 0 ||
    urlRunId !== String(provenance.workflowRunId) ||
    provenance.workflowConclusion !== "success" ||
    !REVISION_PATTERN.test(provenance.evidenceCommit)
  ) {
    throw new Error("TypeScript 7 approval provenance is invalid.");
  }
}

function maxima(
  comparisons: Array<Record<string, unknown>>,
  mode: "cold" | "warm",
) {
  const rows = comparisons.filter((item) => item.mode === mode);
  const values = rows.map((item) => ({
    elapsed: item.elapsedMs as Record<string, number>,
    memory: item.peakRssKiB as Record<string, number>,
  }));
  return {
    rows: rows.length,
    value: {
      candidateElapsedMs: Math.max(...values.map(({ elapsed }) => elapsed.candidate)),
      elapsedRatio: Math.max(...values.map(({ elapsed }) => elapsed.ratio)),
      candidatePeakRssKiB: Math.max(...values.map(({ memory }) => memory.candidate)),
      peakRssRatio: Math.max(...values.map(({ memory }) => memory.ratio)),
    },
  };
}

export function generateTypescript7ResourceApprovalEvidence(
  reviewedAt: string,
  inputs: readonly Typescript7ApprovalInput[],
): Buffer {
  if (
    !/^\d{4}-\d{2}-\d{2}$/u.test(reviewedAt) ||
    inputs.length < TYPESCRIPT_7_RESOURCE_BUDGETS.minimumRevisions
  ) {
    throw new Error(
      `A review date and at least ${TYPESCRIPT_7_RESOURCE_BUDGETS.minimumRevisions} reports are required.`,
    );
  }
  const samples = inputs.map(({ reportBytes, provenance }) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(reportBytes.toString("utf8"));
    } catch {
      throw new Error("TypeScript 7 comparison evidence must be valid JSON.");
    }
    const report = record(parsed, "TypeScript 7 comparison report");
    const revision = String(report.sourceRevision ?? "");
    validateTypescript7ComparisonEvidence(reportBytes, revision);
    assertStrictSchemaV3(report);
    if (report.status !== "ADVISORY_DRIFT") {
      throw new Error(
        "TypeScript 7 approval reports must have ADVISORY_DRIFT status.",
      );
    }
    validateProvenance(provenance);
    const comparisons = report.performanceComparison as Array<Record<string, unknown>>;
    const cold = maxima(comparisons, "cold");
    const warm = maxima(comparisons, "warm");
    const runner = report.runner as Record<string, unknown>;
    return {
      sourceRevision: revision,
      ...provenance,
      reportPath: REPORT_PATH,
      reportSha256: createHash("sha256").update(reportBytes).digest("hex"),
      reportSchemaVersion: 3,
      reportStatus: report.status,
      runner: {
        platform: runner.platform,
        arch: runner.arch,
        image: runner.image,
        hardwareClass: runner.hardwareClass,
        logicalCpuCount: runner.logicalCpuCount,
        memoryGiB: runner.memoryGiB,
      },
      measurementRows: { cold: cold.rows, warm: warm.rows },
      coldMaxima: cold.value,
      warmMaxima: warm.value,
    };
  }).sort((a, b) => a.sourceRevision.localeCompare(b.sourceRevision));
  if (new Set(samples.map(({ sourceRevision }) => sourceRevision)).size !== samples.length) {
    throw new Error("TypeScript 7 approval reports must use distinct revisions.");
  }
  const firstReport = JSON.parse(inputs[0]!.reportBytes.toString("utf8"));
  const budgets = firstReport.resourceBudgets;
  const payload = {
    schemaVersion: 1,
    reviewedAt,
    captureWorkflow: "TypeScript 7 resource capture",
    approvedBudgets: {
      maxElapsedRatio: budgets.maxElapsedRatio,
      maxPeakRssRatio: budgets.maxPeakRssRatio,
      maxCandidateElapsedMs: budgets.maxCandidateElapsedMs,
      maxCandidatePeakRssKiB: budgets.maxCandidatePeakRssKiB,
      minimumRevisions: budgets.minimumRevisions,
      requiredModes: MODES,
    },
    samples,
  };
  const approval = {
    ...payload,
    integrity: {
      algorithm: "sha256",
      scope: "record-excluding-integrity",
      sha256: createHash("sha256").update(JSON.stringify(payload)).digest("hex"),
    },
  };
  const bytes = Buffer.from(`${JSON.stringify(approval, null, 2)}\n`);
  validateTypescript7ResourceApprovalEvidence(bytes);
  return bytes;
}

async function main(): Promise<void> {
  const [reviewedAt, outputPath, ...specs] = process.argv.slice(2);
  if (!reviewedAt || !outputPath || specs.length === 0) {
    throw new Error(
      "Usage: generate-typescript-7-resource-approval <YYYY-MM-DD> <output> <report,run-id,run-url,evidence-commit>...",
    );
  }
  const inputs = await Promise.all(specs.map(async (spec) => {
    const [reportPath, runId, workflowRunUrl, evidenceCommit, ...extra] = spec.split(",");
    if (!reportPath || !runId || !workflowRunUrl || !evidenceCommit || extra.length) {
      throw new Error("Each report specification must contain exactly four comma-separated fields.");
    }
    return {
      reportBytes: await readFile(resolve(reportPath)),
      provenance: {
        workflowRunId: Number(runId),
        workflowRunUrl,
        workflowConclusion: "success" as const,
        evidenceCommit,
      },
    };
  }));
  await writeFile(resolve(outputPath), generateTypescript7ResourceApprovalEvidence(reviewedAt, inputs));
}

if (import.meta.url === `file://${process.argv[1]}`) await main();