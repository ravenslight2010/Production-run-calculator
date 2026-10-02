import { lstat, readFile, realpath } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { FULL_BROWSER_EXPECTED_CASES } from "./full-browser-case-contract.mts";
import {
  READINESS_EVIDENCE_PATH,
  releaseGateLabelsForMode,
  validateReleaseReport,
} from "./release-check.mts";

export type HandoffMode = "standard" | "full";
export type EvidenceStatus =
  | "PASS"
  | "FAIL"
  | "NO-GO"
  | "MISSING"
  | "STALE"
  | "INCOMPLETE"
  | "INCOMPLETE CHECKPOINT";

type GateResult = { label: string; status: string };

type ParsedDocument = {
  path: string;
  content?: string;
  generated?: string;
  revision?: string;
  mode?: string;
  decision?: string;
  environment?: string;
  sourceLibraryEnvironment?: string;
  sourceLibraryRevision?: string;
  deployedRevision?: string;
  readinessEvidence?: string;
  gates: GateResult[];
  status: EvidenceStatus;
  reason?: string;
};

type SupportingFile = {
  path: string;
  status: "PRESENT" | "MISSING";
  required: boolean;
};

export type ReleaseEvidenceHandoff = {
  mode: HandoffMode;
  revision: string;
  evidenceDirectory: string;
  testEvidenceStatus: EvidenceStatus;
  report: ParsedDocument;
  checkpoint: ParsedDocument;
  browserEvidence: ParsedDocument;
  webkitEvidence: ParsedDocument;
  productionBinding: "MATCHING METADATA" | "GAP";
  supportingFiles: SupportingFile[];
  retainedEvaluationPaths: string[];
  unresolvedGates: GateResult[];
  missingGates: string[];
  exitCode: 0 | 2;
  markdown: string;
};

const REPOSITORY_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const MAX_EVIDENCE_FILE_BYTES = 2 * 1024 * 1024;
const GATE_STATUSES =
  "PASS|FAIL|INFRASTRUCTURE TIMEOUT|INFRASTRUCTURE ERROR|BLOCKED|NOT REACHED";

function field(content: string, name: string): string | undefined {
  return content.match(
    new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:\\s*(.*?)\\s*$`, "m"),
  )?.[1];
}

function parseGateResults(content: string): GateResult[] {
  const section = content.split("## Gate results\n\n")[1]?.split("\n## ")[0];
  if (!section) return [];
  return [...section.matchAll(new RegExp(`^\\| (.+?) \\| (${GATE_STATUSES}) \\|`, "gm"))]
    .map((match) => ({ label: match[1], status: match[2] }));
}

function safeRelativePath(value: string): string | undefined {
  if (
    value.length === 0
    || value.startsWith("/")
    || value.includes("\\")
    || !/^[A-Za-z0-9._/-]+$/u.test(value)
    || value.split("/").some((part) => part === "." || part === "..")
  ) {
    return undefined;
  }
  return value;
}

function evidenceLink(path: string): string {
  return `[\`${path}\`](${path})`;
}

function displayMetadata(value: string | undefined): string {
  if (!value) return "not recorded";
  return /^[A-Za-z0-9 _./:-]{1,120}$/u.test(value) ? value : "unavailable";
}

function gitRevision(value: string | undefined): string | undefined {
  return value && /^[a-f0-9]{40}$/u.test(value) ? value : undefined;
}

function timestamp(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : undefined;
}

async function readEvidenceFile(
  evidenceRoot: string,
  path: string,
): Promise<string | undefined> {
  const safePath = safeRelativePath(path);
  if (!safePath) return undefined;
  const candidate = resolve(evidenceRoot, safePath);
  const expectedPrefix = `${evidenceRoot}${sep}`;
  if (!candidate.startsWith(expectedPrefix)) return undefined;
  try {
    const rootPath = await realpath(evidenceRoot);
    const filePath = await realpath(candidate);
    if (!filePath.startsWith(`${rootPath}${sep}`)) return undefined;
    const metadata = await lstat(filePath);
    if (!metadata.isFile() || metadata.size > MAX_EVIDENCE_FILE_BYTES) {
      return undefined;
    }
    return await readFile(filePath, "utf8");
  } catch {
    return undefined;
  }
}

async function supportingFile(
  evidenceRoot: string,
  path: string,
  required: boolean,
): Promise<SupportingFile> {
  const safePath = safeRelativePath(path);
  const content = safePath ? await readEvidenceFile(evidenceRoot, safePath) : undefined;
  return {
    path: safePath ?? "unsafe-path-omitted",
    status: content === undefined ? "MISSING" : "PRESENT",
    required,
  };
}

function parseDocument(
  path: string,
  content: string | undefined,
  requestedMode: HandoffMode,
  requestedRevision: string,
  kind: "report" | "checkpoint" | "browser" | "webkit",
): ParsedDocument {
  const rawMode = content ? field(content, "Mode") : undefined;
  const rawDecision = content ? field(content, "Decision") : undefined;
  const parsed: ParsedDocument = {
    path,
    content,
    generated: content ? timestamp(field(content, "Generated")) : undefined,
    revision: content ? gitRevision(field(content, "Revision")) : undefined,
    mode: rawMode === "standard" || rawMode === "full" ? rawMode : undefined,
    decision: rawDecision === "GO" || rawDecision === "NO-GO"
      ? rawDecision
      : undefined,
    environment: content ? field(content, "Environment") : undefined,
    sourceLibraryEnvironment: content
      ? displayMetadata(field(content, "Source-library evidence environment"))
      : undefined,
    sourceLibraryRevision: content
      ? gitRevision(field(content, "Source-library evidence revision"))
      : undefined,
    deployedRevision: content
      ? gitRevision(field(content, "Deployed revision"))
      : undefined,
    readinessEvidence: content ? field(content, "Readiness evidence") : undefined,
    gates: content ? parseGateResults(content) : [],
    status: "MISSING",
  };
  if (!content) {
    parsed.reason = "file is missing or unreadable";
    return parsed;
  }
  if (kind === "browser" || kind === "webkit") {
    return parsed;
  }
  if (kind === "checkpoint") {
    const revisionMatches = parsed.revision === requestedRevision;
    const modeMatches = parsed.mode === requestedMode;
    parsed.status = "INCOMPLETE CHECKPOINT";
    parsed.reason = !revisionMatches || !modeMatches
      ? "incomplete checkpoint is stale for the requested mode or revision; retained evidence NOT UPDATED"
      : content.includes("Retained evidence: NOT UPDATED")
        ? "incomplete checkpoint; retained evidence NOT UPDATED"
        : "a checkpoint is not retained release evidence";
    return parsed;
  }
  if (!parsed.revision || parsed.revision !== requestedRevision) {
    parsed.status = "STALE";
    parsed.reason = `record revision ${parsed.revision ?? "missing or invalid"} does not match requested revision`;
    return parsed;
  }
  if (parsed.mode !== requestedMode) {
    parsed.status = "STALE";
    parsed.reason = `record mode ${parsed.mode ?? "not recorded"} does not match requested mode`;
    return parsed;
  }
  try {
    validateReleaseReport(content, {
      currentRevision: requestedRevision,
      expectedMode: requestedMode,
      expectedLabels: releaseGateLabelsForMode(requestedMode),
    });
  } catch (error) {
    parsed.status = "INCOMPLETE";
    parsed.reason = "report validation failed; see the linked report for details";
    return parsed;
  }
  parsed.status = parsed.decision === "GO" ? "PASS" : "NO-GO";
  return parsed;
}

function gateStatus(
  content: string | undefined,
  kind: "browser" | "webkit",
  requestedRevision: string,
): { status: EvidenceStatus; reason?: string } {
  if (!content) return { status: "MISSING", reason: "file is missing or unreadable" };
  if (kind === "webkit") {
    let result: Record<string, unknown>;
    try {
      result = JSON.parse(content) as Record<string, unknown>;
    } catch {
      return { status: "INCOMPLETE", reason: "WebKit result is not valid JSON" };
    }
    if (result.revision !== requestedRevision) {
      return {
        status: "STALE",
        reason: `WebKit result revision ${gitRevision(String(result.revision ?? "")) ?? "missing or invalid"} does not match requested revision`,
      };
    }
    if (result.result !== "passed") {
      return {
        status: "FAIL",
        reason: `WebKit result is ${result.result === "failed" ? "failed" : "not passing"}`,
      };
    }
    return { status: "PASS" };
  }

  const reportRevision = field(content, "Revision");
  if (reportRevision !== requestedRevision) {
    return {
      status: "STALE",
      reason: `browser report revision ${gitRevision(reportRevision) ?? "missing or invalid"} does not match requested revision`,
    };
  }
  const expected = Number(field(content, "Expected cases"));
  const enumerated = Number(field(content, "Enumerated cases"));
  const completed = Number(field(content, "Completed cases"));
  const passed = Number(field(content, "Passed cases"));
  const skipped = Number(field(content, "Skipped cases"));
  const failed = Number(field(content, "Failed cases"));
  const notRun = Number(field(content, "Not-run cases"));
  const complete =
    field(content, "Result") === "PASS"
    && field(content, "Coverage") === "COMPLETE"
    && expected === FULL_BROWSER_EXPECTED_CASES
    && enumerated === expected
    && completed === expected
    && passed === expected
    && skipped === 0
    && failed === 0
    && notRun === 0;
  return complete
    ? {
        status: "PASS",
        reason: `${passed}/${expected} passed; ${skipped} skipped, ${failed} failed, ${notRun} not run`,
      }
    : {
        status: "FAIL",
        reason: `browser result/coverage must pass all ${FULL_BROWSER_EXPECTED_CASES} cases in the current contract`,
      };
}

function reportGateProblems(
  document: ParsedDocument,
  mode: HandoffMode,
): { unresolved: GateResult[]; missing: string[] } {
  const expected = releaseGateLabelsForMode(mode);
  const expectedLabels = new Set(expected);
  const recognized = document.gates.filter(({ label }) => expectedLabels.has(label));
  const labels = new Set(recognized.map(({ label }) => label));
  return {
    unresolved: recognized.filter(({ status }) => status !== "PASS"),
    missing: expected.filter((label) => !labels.has(label)),
  };
}

function summarizeLabels(labels: string[]): string {
  if (labels.length === 0) return "none detected";
  return `${labels.slice(0, 8).map((label) => `\`${label}\``).join(", ")}${
    labels.length > 8 ? `, and ${labels.length - 8} more` : ""
  }`;
}

function parseRetainedEvaluationPaths(content: string | undefined): string[] {
  if (!content) return [];
  const section = content.split("## Retained evaluations\n\n")[1]?.split("\n## ")[0];
  if (!section || /No retained evaluation manifests were discovered/u.test(section)) {
    return [];
  }
  return [...section.matchAll(/\[[^\]]+\]\(([^)]+)\)/gu)]
    .map((match) => safeRelativePath(match[1]))
    .filter((path): path is string => path !== undefined);
}

function checkpointIsNewer(
  checkpoint: ParsedDocument,
  report: ParsedDocument,
  requestedMode: HandoffMode,
  requestedRevision: string,
): boolean {
  if (
    checkpoint.status !== "INCOMPLETE CHECKPOINT"
    || checkpoint.mode !== requestedMode
    || checkpoint.revision !== requestedRevision
  ) {
    return false;
  }
  if (!report.generated || !checkpoint.generated) return true;
  const reportTime = Date.parse(report.generated);
  const checkpointTime = Date.parse(checkpoint.generated);
  return !Number.isFinite(reportTime) || !Number.isFinite(checkpointTime)
    ? true
    : checkpointTime >= reportTime;
}

function markdownForHandoff(
  handoff: Omit<ReleaseEvidenceHandoff, "markdown">,
): string {
  const lines = [
    "# Release Evidence Handoff",
    "",
    `Requested mode: **${handoff.mode}**`,
    `Requested revision: \`${handoff.revision}\``,
    `Evidence directory: \`${handoff.evidenceDirectory}\``,
    `Test evidence status: **${handoff.testEvidenceStatus}**`,
    "",
    "## Release records",
    "",
    `- Retained report: **${handoff.report.status}** — ${evidenceLink(handoff.report.path)}${handoff.report.reason ? ` (${handoff.report.reason})` : ""}`,
    `- Checkpoint: **${handoff.checkpoint.status}** — ${evidenceLink(handoff.checkpoint.path)}${handoff.checkpoint.reason ? ` (${handoff.checkpoint.reason})` : ""}`,
    `- WebKit smoke: **${handoff.webkitEvidence.status}** — ${evidenceLink(handoff.webkitEvidence.path)}${handoff.webkitEvidence.reason ? ` (${handoff.webkitEvidence.reason})` : ""}`,
    ...(handoff.mode === "full"
      ? [`- Full browser contract: **${handoff.browserEvidence.status}** — ${evidenceLink(handoff.browserEvidence.path)}${handoff.browserEvidence.reason ? ` (${handoff.browserEvidence.reason})` : ""}`]
      : []),
    "",
    `Report generated: ${handoff.report.generated ?? "not recorded"}`,
    `Checkpoint generated: ${handoff.checkpoint.generated ?? "not recorded"}`,
    `Retained report decision: ${handoff.report.decision ?? "not recorded"}`,
    `Report environment: ${displayMetadata(handoff.report.environment)}`,
    `Failed/blocked/not-reached gates: ${
      handoff.unresolvedGates.length > 0
        ? handoff.unresolvedGates
            .slice(0, 8)
            .map(({ label, status }) => `\`${label}\` (${status})`)
            .join("; ") +
          (handoff.unresolvedGates.length > 8
            ? `; and ${handoff.unresolvedGates.length - 8} more`
            : "")
        : "none reported"
    }`,
    `Missing gate results: ${summarizeLabels(handoff.missingGates)}`,
    "",
    "## Supporting evidence",
    "",
    ...handoff.supportingFiles.map(
      ({ path, status, required }) =>
        `- ${status}${required ? " (required)" : ""}: ${evidenceLink(path)}`,
    ),
    ...(handoff.retainedEvaluationPaths.length === 0
      ? ["- Retained evaluations: none listed in the report."]
      : handoff.retainedEvaluationPaths.slice(0, 8).map(
          (path) => `- Retained evaluation: ${evidenceLink(path)}`,
        ).concat(
          handoff.retainedEvaluationPaths.length > 8
            ? [`- ${handoff.retainedEvaluationPaths.length - 8} additional retained-evaluation links omitted from this bounded summary.`]
            : [],
        )),
    "",
    "## Production-bound proof",
    "",
    `Revision binding metadata: **${handoff.productionBinding}**`,
    `Source-library environment: ${displayMetadata(handoff.report.sourceLibraryEnvironment)}`,
    `Source-library evidence revision: \`${handoff.report.sourceLibraryRevision ?? "not recorded or invalid"}\``,
    `Deployed revision: \`${handoff.report.deployedRevision ?? "not recorded or invalid"}\``,
    `Readiness evidence: ${displayMetadata(handoff.report.readinessEvidence)}`,
    "**Production GO: NOT CLAIMED by this handoff.** Local or disposable-CI test results do not prove the deployed revision or production reconciliation.",
    "",
    "## Next action",
    "",
    handoff.testEvidenceStatus === "PASS"
      ? "- Release owner: run the official revision-bound evidence verifier and attach the matching CI artifact for this selected revision."
      : `- Release owner: resolve the listed gate results, then run ${handoff.mode} mode for the requested revision using [release operations](../docs/release-operations.md#release-commands). Resume only from a same-mode, same-revision checkpoint.`,
    ...(handoff.productionBinding === "GAP"
      ? ["- Deployment/reconciliation owner: provide the controlled deployed-revision handoff and matching release-environment source-library and readiness evidence. Follow [production reconciliation instructions](../docs/release-operations.md#bind-production-reconciliation-evidence-to-the-deployed-build)."]
      : []),
    "",
    "This read-only handoff does not replace `release:check -- --verify-evidence` or issue a release decision.",
    "",
  ];
  return `${lines.join("\n")}\n`;
}

export async function buildReleaseEvidenceHandoff(options: {
  mode: HandoffMode;
  revision: string;
  repositoryRoot?: string;
  evidenceDirectory?: string;
}): Promise<ReleaseEvidenceHandoff> {
  const { mode, revision } = options;
  if (mode !== "standard" && mode !== "full") {
    throw new Error("mode must be standard or full");
  }
  if (!/^[a-f0-9]{40}$/u.test(revision)) {
    throw new Error("revision must be a full 40-character lowercase Git SHA");
  }
  const repositoryRoot = resolve(options.repositoryRoot ?? REPOSITORY_ROOT);
  const evidencePath = options.evidenceDirectory
    ?? (mode === "full" ? "release-evidence-full" : "release-evidence");
  const evidenceRoot = resolve(repositoryRoot, evidencePath);
  const relativeEvidenceRoot = relative(repositoryRoot, evidenceRoot);
  if (
    relativeEvidenceRoot === ""
    || relativeEvidenceRoot.startsWith(`..${sep}`)
    || relativeEvidenceRoot === ".."
    || relativeEvidenceRoot.startsWith(sep)
  ) {
    throw new Error("evidence directory must be inside the repository");
  }
  if (!safeRelativePath(relativeEvidenceRoot.split(sep).join("/"))) {
    throw new Error("evidence directory must use a repository-relative safe path");
  }
  const rootMetadata = await lstat(repositoryRoot);
  if (!rootMetadata.isDirectory()) {
    throw new Error("repository root must be a directory");
  }
  const canonicalRepositoryRoot = await realpath(repositoryRoot);
  let canonicalEvidenceRoot: string | undefined;
  try {
    canonicalEvidenceRoot = await realpath(evidenceRoot);
  } catch {
    canonicalEvidenceRoot = undefined;
  }
  if (
    canonicalEvidenceRoot
    && !canonicalEvidenceRoot.startsWith(`${canonicalRepositoryRoot}${sep}`)
  ) {
    throw new Error("evidence directory resolves outside the repository");
  }

  const reportPath = "release-check-report.md";
  const checkpointPath = "release-check-checkpoint.md";
  const browserPath = "browser-full/FINAL-REPORT.md";
  const webkitPath = "browser-smoke/webkit-result.json";
  const [reportContent, checkpointContent, browserContent, webkitContent] =
    await Promise.all([
      readEvidenceFile(evidenceRoot, reportPath),
      readEvidenceFile(evidenceRoot, checkpointPath),
      mode === "full" ? readEvidenceFile(evidenceRoot, browserPath) : undefined,
      readEvidenceFile(evidenceRoot, webkitPath),
    ]);

  const report = parseDocument(reportPath, reportContent, mode, revision, "report");
  const checkpoint = parseDocument(
    checkpointPath,
    checkpointContent,
    mode,
    revision,
    "checkpoint",
  );
  const browserEvidence = parseDocument(
    browserPath,
    browserContent,
    mode,
    revision,
    "browser",
  );
  const webkitEvidence = parseDocument(
    webkitPath,
    webkitContent,
    mode,
    revision,
    "webkit",
  );
  browserEvidence.status = gateStatus(browserContent, "browser", revision).status;
  browserEvidence.reason = gateStatus(browserContent, "browser", revision).reason;
  webkitEvidence.status = gateStatus(webkitContent, "webkit", revision).status;
  webkitEvidence.reason = gateStatus(webkitContent, "webkit", revision).reason;

  const checkpointSupersedesReport = checkpointIsNewer(
    checkpoint,
    report,
    mode,
    revision,
  );
  const activeRecord =
    checkpointSupersedesReport
      ? checkpoint
      : report.revision === revision && report.mode === mode
        ? report
        : undefined;
  const { unresolved, missing } = activeRecord
    ? reportGateProblems(activeRecord, mode)
    : { unresolved: [], missing: releaseGateLabelsForMode(mode) };
  const requiredPaths = [
    "clean-start/clean-start-evidence.json",
    "clean-start/browser-result.json",
    "browser-smoke/webkit-result.json",
    "report-key-rotation-preflight.json",
    "source-library-reconciliation.json",
    "typescript-7-comparison.json",
  ];
  if (mode === "full") requiredPaths.push("browser-full/FINAL-REPORT.md");
  const optionalPaths = [
    "release-check.log",
    "clean-start/preview-home.png",
    "clean-start/startup-api.log",
    "clean-start/startup-web.log",
    "clean-start/startup-mockup.log",
    READINESS_EVIDENCE_PATH,
  ];
  const supportingFiles = await Promise.all([
    ...requiredPaths.map((path) => supportingFile(evidenceRoot, path, true)),
    ...optionalPaths.map((path) => supportingFile(evidenceRoot, path, false)),
  ]);
  const retainedEvaluationPaths = parseRetainedEvaluationPaths(reportContent);
  for (const path of retainedEvaluationPaths) {
    supportingFiles.push(await supportingFile(evidenceRoot, path, true));
  }

  const supportMissing = supportingFiles.some(
    ({ status, required }) => required && status === "MISSING",
  );
  let testEvidenceStatus: EvidenceStatus = report.status;
  if (checkpointSupersedesReport) {
    testEvidenceStatus = "INCOMPLETE CHECKPOINT";
  } else if (report.status === "PASS" && webkitEvidence.status !== "PASS") {
    testEvidenceStatus = webkitEvidence.status;
  } else if (
    report.status === "PASS"
    && mode === "full"
    && browserEvidence.status !== "PASS"
  ) {
    testEvidenceStatus = browserEvidence.status;
  } else if (report.status === "PASS" && (supportMissing || missing.length > 0)) {
    testEvidenceStatus = "INCOMPLETE";
  }

  const productionBinding =
    report.status === "PASS"
    && report.sourceLibraryEnvironment === "release"
    && report.sourceLibraryRevision === revision
    && report.deployedRevision === revision
    && report.readinessEvidence === READINESS_EVIDENCE_PATH
    && supportingFiles.some(
      ({ path, status }) =>
        path === READINESS_EVIDENCE_PATH
        && status === "PRESENT",
    )
      ? "MATCHING METADATA"
      : "GAP";

  const partial: Omit<ReleaseEvidenceHandoff, "markdown"> = {
    mode,
    revision,
    evidenceDirectory: relativeEvidenceRoot.split(sep).join("/"),
    testEvidenceStatus,
    report,
    checkpoint,
    browserEvidence,
    webkitEvidence,
    productionBinding,
    supportingFiles,
    retainedEvaluationPaths,
    unresolvedGates: unresolved,
    missingGates: missing,
    exitCode: testEvidenceStatus === "PASS" ? 0 : 2,
  };
  return { ...partial, markdown: markdownForHandoff(partial) };
}

function optionValue(args: string[], name: string): string | undefined {
  const inline = args.find((arg) => arg.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} requires a value`);
  }
  return value;
}

function printHelp(): void {
  console.log(
    [
      "Usage: release-evidence-handoff --mode <standard|full> --revision <40-char-sha> [--evidence-dir <repository-relative-dir>]",
      "Prints a bounded, read-only summary of retained report, checkpoint, browser evidence, and production-binding gaps.",
      "Exit status 0 means the selected test evidence is complete and passing; nonzero means it is missing, stale, incomplete, or not passing.",
      "This command never issues a production GO.",
    ].join("\n"),
  );
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    printHelp();
    return;
  }
  const mode = optionValue(args, "--mode");
  const revision = optionValue(args, "--revision");
  if (mode !== "standard" && mode !== "full") {
    throw new Error("--mode must be standard or full");
  }
  if (!revision) throw new Error("--revision is required");
  const handoff = await buildReleaseEvidenceHandoff({
    mode,
    revision,
    evidenceDirectory: optionValue(args, "--evidence-dir"),
  });
  console.log(handoff.markdown);
  process.exitCode = handoff.exitCode;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error: unknown) => {
    console.error(
      error instanceof Error ? error.message : "Release evidence handoff failed",
    );
    process.exitCode = 2;
  });
}