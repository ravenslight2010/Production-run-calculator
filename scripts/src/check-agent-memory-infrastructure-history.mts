import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";
import {
  findAgentMemoryInfrastructure,
  isScannedAgentMemoryPath,
  type AgentMemoryFinding,
} from "./check-agent-memory-infrastructure.mts";

const execFileAsync = promisify(execFile);
export const MAX_HISTORY_REVISIONS = 2000;

export type HistoricalAgentMemoryFinding = AgentMemoryFinding & {
  commit: string;
};

export type HistoricalAgentMemoryAudit = {
  snapshot: string;
  revisionsScanned: number;
  revisionLimit: number;
  olderRevisionsOmitted: boolean;
  findings: HistoricalAgentMemoryFinding[];
};

async function git(
  repositoryRoot: string,
  args: string[],
  maxBuffer = 16 * 1024 * 1024,
): Promise<string> {
  const { stdout } = await execFileAsync("git", args, {
    cwd: repositoryRoot,
    encoding: "utf8",
    maxBuffer,
  });
  return stdout;
}

function parseChangedPaths(output: string): string[] {
  const tokens = output.split("\0").filter(Boolean);
  const paths = new Set<string>();

  for (let index = 0; index < tokens.length; ) {
    const status = tokens[index++];
    const path = tokens[index++];
    if (!path) break;
    if (status !== "D") paths.add(path);
  }

  return [...paths].filter(isScannedAgentMemoryPath);
}

export async function scanHistoricalAgentMemoryInfrastructure(
  repositoryRoot: string,
  ref = "HEAD",
  revisionLimit = MAX_HISTORY_REVISIONS,
): Promise<HistoricalAgentMemoryAudit> {
  if (
    !Number.isInteger(revisionLimit) ||
    revisionLimit < 1 ||
    revisionLimit > MAX_HISTORY_REVISIONS
  ) {
    throw new RangeError(
      `revisionLimit must be an integer between 1 and ${MAX_HISTORY_REVISIONS}`,
    );
  }

  const snapshot = (
    await git(repositoryRoot, [
      "rev-parse",
      "--verify",
      "--end-of-options",
      `${ref}^{commit}`,
    ])
  ).trim();
  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(snapshot)) {
    throw new Error("Git returned an invalid commit identifier.");
  }

  const revisionOutput = await git(repositoryRoot, [
    "log",
    "--full-history",
    `--max-count=${revisionLimit + 1}`,
    "--format=%H",
    snapshot,
    "--",
    ".agents/memory",
  ]);
  const revisions = revisionOutput
    .split(/\r?\n/u)
    .filter((revision) => /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(revision));
  const olderRevisionsOmitted = revisions.length > revisionLimit;
  const selectedRevisions = revisions.slice(0, revisionLimit);
  const findings: HistoricalAgentMemoryFinding[] = [];

  for (const commit of selectedRevisions) {
    const changedPaths = parseChangedPaths(
      await git(repositoryRoot, [
        "diff-tree",
        "--root",
        "-m",
        "--no-commit-id",
        "--name-status",
        "--no-renames",
        "-r",
        "-z",
        commit,
        "--",
        ".agents/memory",
      ]),
    );

    for (const file of changedPaths) {
      const content = await git(repositoryRoot, ["show", `${commit}:${file}`]);
      for (const finding of findAgentMemoryInfrastructure(file, content)) {
        findings.push({ ...finding, commit });
      }
    }
  }

  return {
    snapshot,
    revisionsScanned: selectedRevisions.length,
    revisionLimit,
    olderRevisionsOmitted,
    findings,
  };
}

export function formatHistoricalAgentMemoryFinding(
  finding: HistoricalAgentMemoryFinding,
): string {
  return `${finding.commit} ${finding.file}:${finding.line}: ${finding.category}`;
}

export async function main(
  args = process.argv.slice(2),
  repositoryRoot = resolve(import.meta.dirname, "../.."),
): Promise<void> {
  let ref = "HEAD";
  const cliArgs = args[0] === "--" ? args.slice(1) : args;
  for (let index = 0; index < cliArgs.length; index += 1) {
    if (cliArgs[index] === "--ref" && cliArgs[index + 1]) {
      ref = cliArgs[index + 1];
      index += 1;
    } else if (cliArgs[index] === "--help") {
      console.log(
        "Usage: check-agent-memory-infrastructure-history.mts [--ref <git-commit-or-ref>]",
      );
      return;
    } else {
      console.error(
        "Historical agent-memory audit failed: unsupported arguments.",
      );
      process.exitCode = 2;
      return;
    }
  }

  const audit = await scanHistoricalAgentMemoryInfrastructure(
    repositoryRoot,
    ref,
  );
  console.log(
    `Historical agent-memory infrastructure audit: ${audit.revisionsScanned} revision(s) scanned at ${audit.snapshot}; limit=${audit.revisionLimit}; older revisions omitted=${audit.olderRevisionsOmitted ? "yes" : "no"}.`,
  );

  if (audit.findings.length === 0) {
    console.log("No historical matches found in the scanned range.");
    return;
  }

  console.log(
    `Findings (${audit.findings.length}); output includes metadata only:`,
  );
  for (const finding of audit.findings) {
    console.log(formatHistoricalAgentMemoryFinding(finding));
  }
  console.log(
    "Disposition: review each reference with the infrastructure owner; rotate or retire affected resources only when that owner confirms exposure. Git history was not changed.",
  );
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  main().catch(() => {
    console.error(
      "Historical agent-memory infrastructure audit failed: could not scan Git history.",
    );
    process.exitCode = 1;
  });
}
