import { createHash } from "node:crypto";
import fs from "node:fs";

const categories = ["api-client-react", "api-zod", "db", "other"] as const;
const classifications = [
  "added",
  "removed",
  "formatting-only",
  "approved-semantic",
  "semantic",
] as const;

type Category = (typeof categories)[number];
type Classification = (typeof classifications)[number];
type FileResult = {
  path: string;
  category: Category;
  baselineSha256: string | null;
  candidateSha256: string | null;
  classification: Classification;
  approvalReason?: string;
};
type CategoryResult = {
  category: Category;
  changed: number;
  formattingOnly: number;
  approvedSemantic: number;
  unexplainedSemantic: number;
};
type Summary = {
  capturedAt: string;
  sourceIdentity: { revision: string; bundleSha256: string };
  declarations: {
    textuallyChangedFileCount: number;
    contractComparison: {
      status: string;
      changedFiles: number;
      formattingOnlyChanges: number;
      approvedSemanticChanges: number;
      unexplainedSemanticChanges: number;
    };
  };
};
type Comparison = {
  schemaVersion: number;
  baselineFileCount: number;
  candidateFileCount: number;
  status: string;
  categories: CategoryResult[];
  files: FileResult[];
};
type RetainedReport = {
  schemaVersion: 1;
  capturedAt: string;
  sourceIdentity: Summary["sourceIdentity"];
  declarationContract: {
    baselineFileCount: number;
    candidateFileCount: number;
    status: "pass";
    classificationTotals: {
      changedFiles: number;
      formattingOnly: number;
      approvedSemantic: number;
      unexplainedSemantic: number;
    };
    categories: CategoryResult[];
    files: FileResult[];
  };
  integrity: {
    algorithm: "sha256";
    canonicalization: "sorted-json-keys-v1";
    digest: string;
  };
};

function fail(message: string): never {
  throw new Error(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
}

function digest(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(value)))
    .digest("hex");
}

function withoutIntegrity(report: RetainedReport): Omit<RetainedReport, "integrity"> {
  const { integrity: _integrity, ...unsigned } = report;
  return unsigned;
}

function classificationTotals(files: FileResult[]) {
  return {
    changedFiles: files.length,
    formattingOnly: files.filter((file) => file.classification === "formatting-only").length,
    approvedSemantic: files.filter((file) => file.classification === "approved-semantic").length,
    unexplainedSemantic: files.filter((file) =>
      ["added", "removed", "semantic"].includes(file.classification),
    ).length,
  };
}

function assertComparisonMatchesSummary(comparison: Comparison, summary: Summary): void {
  if (comparison.schemaVersion !== 1 || comparison.status !== "pass") {
    fail("Only a passing schema-version-1 declaration comparison can be retained.");
  }
  if (!Array.isArray(comparison.categories) || !Array.isArray(comparison.files)) {
    fail("Declaration comparison is missing its categories or per-file results.");
  }
  const totals = classificationTotals(comparison.files);
  const summaryTotals = summary.declarations?.contractComparison;
  if (
    !summaryTotals ||
    summaryTotals.status !== "pass" ||
    summaryTotals.changedFiles !== totals.changedFiles ||
    summaryTotals.formattingOnlyChanges !== totals.formattingOnly ||
    summaryTotals.approvedSemanticChanges !== totals.approvedSemantic ||
    summaryTotals.unexplainedSemanticChanges !== totals.unexplainedSemantic ||
    summary.declarations.textuallyChangedFileCount !== totals.changedFiles ||
    totals.unexplainedSemantic !== 0
  ) {
    fail("Declaration report classification totals do not match the fresh summary.");
  }
  if (comparison.categories.length !== categories.length) {
    fail("Declaration report category totals are incomplete.");
  }
  for (const category of categories) {
    const matchingFiles = comparison.files.filter((file) => file.category === category);
    const actual = comparison.categories.find((item) => item.category === category);
    const expected = {
      category,
      changed: matchingFiles.length,
      formattingOnly: matchingFiles.filter((file) => file.classification === "formatting-only").length,
      approvedSemantic: matchingFiles.filter((file) => file.classification === "approved-semantic").length,
      unexplainedSemantic: matchingFiles.filter((file) =>
        ["added", "removed", "semantic"].includes(file.classification),
      ).length,
    };
    if (!actual || JSON.stringify(actual) !== JSON.stringify(expected)) {
      fail(`Declaration report totals are inconsistent for category ${category}.`);
    }
  }
  const paths = new Set<string>();
  for (const file of comparison.files) {
    if (
      typeof file.path !== "string" ||
      file.path.length === 0 ||
      paths.has(file.path) ||
      !categories.includes(file.category) ||
      !classifications.includes(file.classification)
    ) {
      fail("Declaration report contains an invalid or duplicate file entry.");
    }
    paths.add(file.path);
    for (const fileHash of [file.baselineSha256, file.candidateSha256]) {
      if (fileHash !== null && !/^[a-f0-9]{64}$/.test(fileHash)) {
        fail(`Declaration report contains an invalid SHA-256 for ${file.path}.`);
      }
    }
    if (
      file.classification === "approved-semantic" &&
      (typeof file.approvalReason !== "string" || file.approvalReason.trim() === "")
    ) {
      fail(`Approved semantic change is missing its approval reason: ${file.path}`);
    }
    if (file.classification !== "approved-semantic" && file.approvalReason !== undefined) {
      fail(`Unexpected approval reason on non-approved file: ${file.path}`);
    }
  }
  if (
    !/^[a-f0-9]{40}$/.test(summary.sourceIdentity?.revision ?? "") ||
    !/^[a-f0-9]{64}$/.test(summary.sourceIdentity?.bundleSha256 ?? "") ||
    !Number.isFinite(Date.parse(summary.capturedAt))
  ) {
    fail("Fresh summary is missing a valid revision, source-bundle hash, or capture time.");
  }
}

export function createRetainedDeclarationContractReport(
  summary: Summary,
  comparison: Comparison,
): RetainedReport {
  assertComparisonMatchesSummary(comparison, summary);
  const reportWithoutIntegrity = {
    schemaVersion: 1 as const,
    capturedAt: summary.capturedAt,
    sourceIdentity: summary.sourceIdentity,
    declarationContract: {
      baselineFileCount: comparison.baselineFileCount,
      candidateFileCount: comparison.candidateFileCount,
      status: "pass" as const,
      classificationTotals: classificationTotals(comparison.files),
      categories: comparison.categories,
      files: comparison.files,
    },
  };
  return {
    ...reportWithoutIntegrity,
    integrity: {
      algorithm: "sha256",
      canonicalization: "sorted-json-keys-v1",
      digest: digest(reportWithoutIntegrity),
    },
  };
}

export function verifyRetainedDeclarationContractReport(
  summary: Summary,
  report: RetainedReport,
): void {
  if (
    report.schemaVersion !== 1 ||
    report.integrity?.algorithm !== "sha256" ||
    report.integrity?.canonicalization !== "sorted-json-keys-v1" ||
    report.integrity.digest !== digest(withoutIntegrity(report))
  ) {
    fail("Retained declaration report integrity check failed.");
  }
  if (
    report.capturedAt !== summary.capturedAt ||
    report.sourceIdentity?.revision !== summary.sourceIdentity?.revision ||
    report.sourceIdentity?.bundleSha256 !== summary.sourceIdentity?.bundleSha256
  ) {
    fail("Retained declaration report identity does not match the fresh summary.");
  }
  const comparison: Comparison = {
    schemaVersion: 1,
    baselineFileCount: report.declarationContract.baselineFileCount,
    candidateFileCount: report.declarationContract.candidateFileCount,
    status: report.declarationContract.status,
    categories: report.declarationContract.categories,
    files: report.declarationContract.files,
  };
  assertComparisonMatchesSummary(comparison, summary);
  if (
    JSON.stringify(report.declarationContract.classificationTotals) !==
    JSON.stringify(classificationTotals(comparison.files))
  ) {
    fail("Retained declaration report classification totals are inconsistent.");
  }
}

function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(file, "utf8")) as T;
}

function main(): void {
  const [mode, summaryPath, inputPath, outputPath] = process.argv.slice(2);
  if (mode === "create" && summaryPath && inputPath && outputPath) {
    const report = createRetainedDeclarationContractReport(
      readJson<Summary>(summaryPath),
      readJson<Comparison>(inputPath),
    );
    fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
    return;
  }
  if (mode === "verify" && summaryPath && inputPath && !outputPath) {
    verifyRetainedDeclarationContractReport(
      readJson<Summary>(summaryPath),
      readJson<RetainedReport>(inputPath),
    );
    process.stdout.write(`Retained declaration report verified: ${inputPath}\n`);
    return;
  }
  fail(
    "Usage: typescript-declaration-contract-evidence <create SUMMARY COMPARISON OUTPUT | verify SUMMARY REPORT>",
  );
}

if (process.argv[1]?.endsWith("typescript-declaration-contract-evidence.mts")) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
