import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  createRetainedDeclarationContractReport,
  verifyRetainedDeclarationContractReport,
} from "./typescript-declaration-contract-evidence.mts";

export const TYPESCRIPT_7_CONTRACT_REPORT_FILE =
  "typescript-7-declaration-contracts.json";
export const TYPESCRIPT_7_CONTRACT_MANIFEST_FILE = "manifest.json";

type DeclarationSummary = {
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

type DeclarationComparison = {
  schemaVersion: number;
  baselineFileCount: number;
  candidateFileCount: number;
  status: string;
  categories: Array<{
    category: "api-client-react" | "api-zod" | "db" | "other";
    changed: number;
    formattingOnly: number;
    approvedSemantic: number;
    unexplainedSemantic: number;
  }>;
  files: Array<{
    path: string;
    category: "api-client-react" | "api-zod" | "db" | "other";
    baselineSha256: string | null;
    candidateSha256: string | null;
    classification:
      | "added"
      | "removed"
      | "formatting-only"
      | "approved-semantic"
      | "semantic";
    approvalReason?: string;
  }>;
};

type WorkflowIdentity = {
  runId: string;
  runAttempt: string;
  repository: string;
  eventName: string;
  sha: string;
};

type ComparisonOutcome = {
  status: "PASS" | "ADVISORY_DRIFT" | "PROMOTION_BLOCKED";
  commandsSucceeded: boolean;
  diagnosticsEqual: boolean;
  advisory: boolean;
  acceptanceGatesMet: boolean;
};

type ContractArtifactManifest = {
  schemaVersion: 1;
  workflow: WorkflowIdentity;
  sourceIdentity: DeclarationSummary["sourceIdentity"];
  comparison: ComparisonOutcome;
  summary: DeclarationSummary;
  report: {
    file: typeof TYPESCRIPT_7_CONTRACT_REPORT_FILE;
    sha256: string;
  };
};

function fail(message: string): never {
  throw new Error(message);
}

function sha256(bytes: Buffer | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function isWithin(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return (
    relative !== "" &&
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

function assertRunnerTempChild(directory: string, runnerTemp: string): string {
  const resolvedTemp = path.resolve(runnerTemp);
  const resolvedDirectory = path.resolve(directory);
  if (!isWithin(resolvedTemp, resolvedDirectory)) {
    fail("TypeScript declaration evidence must be written below RUNNER_TEMP.");
  }
  return resolvedDirectory;
}

export function resetTypescript7ContractArtifactDirectory(
  directory: string,
  runnerTemp: string,
): void {
  const resolved = assertRunnerTempChild(directory, runnerTemp);
  if (fs.existsSync(resolved) && fs.lstatSync(resolved).isSymbolicLink()) {
    fail("TypeScript declaration artifact directory must not be a symbolic link.");
  }
  fs.rmSync(resolved, { recursive: true, force: true });
}

function workflowIdentityFromEnvironment(): WorkflowIdentity {
  const workflow = {
    runId: process.env.GITHUB_RUN_ID ?? "",
    runAttempt: process.env.GITHUB_RUN_ATTEMPT ?? "",
    repository: process.env.GITHUB_REPOSITORY ?? "",
    eventName: process.env.GITHUB_EVENT_NAME ?? "",
    sha: process.env.GITHUB_SHA ?? "",
  };
  if (
    !/^\d+$/u.test(workflow.runId) ||
    !/^\d+$/u.test(workflow.runAttempt) ||
    !/^[^/\s]+\/[^/\s]+$/u.test(workflow.repository) ||
    workflow.eventName.length === 0 ||
    !/^[a-f0-9]{40}$/u.test(workflow.sha)
  ) {
    fail("GitHub run identity is incomplete or invalid.");
  }
  return workflow;
}

export async function writeTypescript7ContractArtifact(input: {
  directory: string;
  runnerTemp: string;
  summary: DeclarationSummary;
  declarationComparison: DeclarationComparison;
  comparison: ComparisonOutcome;
  workflow: WorkflowIdentity;
}): Promise<void> {
  const directory = assertRunnerTempChild(input.directory, input.runnerTemp);
  resetTypescript7ContractArtifactDirectory(directory, input.runnerTemp);
  if (
    !input.comparison.commandsSucceeded ||
    !input.comparison.diagnosticsEqual ||
    !["PASS", "ADVISORY_DRIFT"].includes(input.comparison.status)
  ) {
    fail("A failed or incomplete TypeScript comparison cannot produce a successful contract artifact.");
  }
  if (input.summary.sourceIdentity.revision !== input.workflow.sha) {
    fail("TypeScript contract evidence revision does not match the workflow checkout.");
  }

  const report = createRetainedDeclarationContractReport(
    input.summary,
    input.declarationComparison,
  );
  verifyRetainedDeclarationContractReport(input.summary, report);

  fs.mkdirSync(directory, { recursive: true });

  const reportBytes = Buffer.from(`${JSON.stringify(report, null, 2)}\n`);
  const manifest: ContractArtifactManifest = {
    schemaVersion: 1,
    workflow: input.workflow,
    sourceIdentity: input.summary.sourceIdentity,
    comparison: input.comparison,
    summary: input.summary,
    report: {
      file: TYPESCRIPT_7_CONTRACT_REPORT_FILE,
      sha256: sha256(reportBytes),
    },
  };
  fs.writeFileSync(
    path.join(directory, TYPESCRIPT_7_CONTRACT_REPORT_FILE),
    reportBytes,
    { flag: "wx" },
  );
  fs.writeFileSync(
    path.join(directory, TYPESCRIPT_7_CONTRACT_MANIFEST_FILE),
    `${JSON.stringify(manifest, null, 2)}\n`,
    { flag: "wx" },
  );
}

export function verifyTypescript7ContractArtifact(input: {
  directory: string;
  runnerTemp: string;
  workflow: WorkflowIdentity;
  sourceBundleSha256?: string;
}): boolean {
  const directory = assertRunnerTempChild(input.directory, input.runnerTemp);
  if (!fs.existsSync(directory)) return false;
  const directoryStat = fs.lstatSync(directory);
  if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) {
    fail("TypeScript declaration artifact path is not a regular directory.");
  }
  const entries = fs.readdirSync(directory, { withFileTypes: true });
  const names = entries.map((entry) => entry.name).sort();
  const expectedNames = [
    TYPESCRIPT_7_CONTRACT_MANIFEST_FILE,
    TYPESCRIPT_7_CONTRACT_REPORT_FILE,
  ].sort();
  if (
    JSON.stringify(names) !== JSON.stringify(expectedNames) ||
    entries.some((entry) => !entry.isFile() || entry.isSymbolicLink())
  ) {
    fail("TypeScript declaration artifact contains unexpected files or directories.");
  }

  const reportPath = path.join(directory, TYPESCRIPT_7_CONTRACT_REPORT_FILE);
  const manifestPath = path.join(directory, TYPESCRIPT_7_CONTRACT_MANIFEST_FILE);
  const reportBytes = fs.readFileSync(reportPath);
  if (reportBytes.length > 1_048_576 || fs.statSync(manifestPath).size > 65_536) {
    fail("TypeScript declaration artifact exceeds its compact evidence size limit.");
  }
  const manifest = JSON.parse(
    fs.readFileSync(manifestPath, "utf8"),
  ) as ContractArtifactManifest;
  if (
    manifest.schemaVersion !== 1 ||
    JSON.stringify(manifest.workflow) !== JSON.stringify(input.workflow) ||
    manifest.report?.file !== TYPESCRIPT_7_CONTRACT_REPORT_FILE ||
    manifest.report.sha256 !== sha256(reportBytes) ||
    manifest.sourceIdentity?.revision !== input.workflow.sha ||
    (input.sourceBundleSha256 !== undefined &&
      manifest.sourceIdentity?.bundleSha256 !== input.sourceBundleSha256) ||
    manifest.summary?.sourceIdentity?.revision !== input.workflow.sha ||
    manifest.summary?.sourceIdentity?.bundleSha256 !==
      manifest.sourceIdentity.bundleSha256 ||
    manifest.comparison?.commandsSucceeded !== true ||
    manifest.comparison?.diagnosticsEqual !== true ||
    !["PASS", "ADVISORY_DRIFT"].includes(manifest.comparison.status)
  ) {
    fail("TypeScript declaration artifact identity or comparison outcome is invalid.");
  }
  const report = JSON.parse(reportBytes.toString("utf8"));
  verifyRetainedDeclarationContractReport(manifest.summary, report);
  return true;
}

function verifyCurrentWorkflowSource(): string {
  const workflow = workflowIdentityFromEnvironment();
  const revision = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: path.resolve(import.meta.dirname, "../.."),
    encoding: "utf8",
  }).trim();
  if (revision !== workflow.sha) {
    fail("Checked-out Git revision does not match GITHUB_SHA.");
  }
  const repositoryRoot = path.resolve(import.meta.dirname, "../..");
  const reproductionScript = path.join(
    repositoryRoot,
    "docs/evidence/reproduce-typescript-7-comparison.sh",
  );
  const sourceBundleSha256 = execFileSync(
    "bash",
    [reproductionScript, "--source-bundle-sha256"],
    { cwd: repositoryRoot, encoding: "utf8" },
  ).trim();
  if (!/^[a-f0-9]{64}$/u.test(sourceBundleSha256)) {
    fail("TypeScript comparison source-bundle hash is invalid.");
  }
  return sourceBundleSha256;
}

async function main(): Promise<void> {
  const [command, directory] = process.argv.slice(2);
  if (command !== "verify" || !directory) {
    fail("Usage: typescript-7-contract-artifact verify ARTIFACT_DIRECTORY");
  }
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) fail("GITHUB_OUTPUT is required for artifact verification.");
  const workflow = workflowIdentityFromEnvironment();
  if (!fs.existsSync(directory)) {
    fs.appendFileSync(outputPath, "available=false\n");
    process.stdout.write("No successful TypeScript comparison artifact was produced.\n");
    return;
  }
  const sourceBundleSha256 = verifyCurrentWorkflowSource();
  const exists = verifyTypescript7ContractArtifact({
    directory,
    runnerTemp: process.env.RUNNER_TEMP ?? "",
    workflow,
    sourceBundleSha256,
  });
  if (exists) {
    fs.appendFileSync(outputPath, "available=true\n");
    process.stdout.write("Verified compact TypeScript declaration evidence for this run.\n");
  } else {
    fs.appendFileSync(outputPath, "available=false\n");
    process.stdout.write("No successful TypeScript comparison artifact was produced.\n");
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error: unknown) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
