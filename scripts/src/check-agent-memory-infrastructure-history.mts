import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { promisify } from "node:util";
import { resolve } from "node:path";
import {
  findAgentMemoryInfrastructure,
  isScannedAgentMemoryPath,
  type AgentMemoryFinding,
} from "./check-agent-memory-infrastructure.mts";

const execFileAsync = promisify(execFile);
export const MAX_HISTORY_REVISIONS = 2000;
export const MAX_UNREACHABLE_COMMITS = 2000;

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

export type LocalRefHistoricalAgentMemoryFinding =
  HistoricalAgentMemoryFinding & {
    ref: string;
  };

export type LocalRefHistoricalAgentMemoryAudit = {
  snapshot: string;
  refsInventoried: number;
  localBranchRefs: number;
  tagRefs: number;
  remoteTrackingRefs: number;
  otherRefs: number;
  refInventorySha256: string;
  revisionsScanned: number;
  revisionLimit: number;
  olderRevisionsOmitted: boolean;
  findings: LocalRefHistoricalAgentMemoryFinding[];
};

export type UnreachableAgentMemoryAudit = {
  commitInventorySha256: string;
  commitsInventoried: number;
  commitsScanned: number;
  commitLimit: number;
  commitsOmitted: boolean;
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

export async function scanUnreachableAgentMemoryInfrastructure(
  repositoryRoot: string,
  commitLimit = MAX_UNREACHABLE_COMMITS,
): Promise<UnreachableAgentMemoryAudit> {
  if (
    !Number.isInteger(commitLimit) ||
    commitLimit < 1 ||
    commitLimit > MAX_UNREACHABLE_COMMITS
  ) {
    throw new RangeError(
      `commitLimit must be an integer between 1 and ${MAX_UNREACHABLE_COMMITS}`,
    );
  }

  const inventoryOutput = await git(repositoryRoot, [
    "fsck",
    "--no-reflogs",
    "--unreachable",
  ]);
  const commits = [
    ...new Set(
      inventoryOutput
        .split(/\r?\n/u)
        .flatMap((line) => {
          const match = /^unreachable commit ((?:[0-9a-f]{40}|[0-9a-f]{64}))$/u.exec(
            line,
          );
          return match?.[1] ? [match[1]] : [];
        }),
    ),
  ].sort();
  const commitInventorySha256 = createHash("sha256")
    .update(commits.join("\n"))
    .digest("hex");
  const selectedCommits = commits.slice(0, commitLimit);
  const findings: HistoricalAgentMemoryFinding[] = [];

  for (const commit of selectedCommits) {
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
    commitInventorySha256,
    commitsInventoried: commits.length,
    commitsScanned: selectedCommits.length,
    commitLimit,
    commitsOmitted: commits.length > commitLimit,
    findings,
  };
}

function parseRefInventory(output: string): string[] {
  return output.split(/\r?\n/u).filter(Boolean).sort();
}

export async function scanLocalRefsOutsideAgentMemorySnapshot(
  repositoryRoot: string,
  ref = "HEAD",
  revisionLimit = MAX_HISTORY_REVISIONS,
): Promise<LocalRefHistoricalAgentMemoryAudit> {
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

  const inventoryOutput = await git(repositoryRoot, [
    "for-each-ref",
    "--format=%(refname) %(objectname)",
  ]);
  const inventoryRows = parseRefInventory(inventoryOutput);
  const refs = inventoryRows.map((row) => row.split(" ", 1)[0] ?? "");
  const localBranchRefs = refs.filter((candidate) =>
    candidate.startsWith("refs/heads/"),
  ).length;
  const tagRefs = refs.filter((candidate) =>
    candidate.startsWith("refs/tags/"),
  ).length;
  const remoteTrackingRefs = refs.filter((candidate) =>
    candidate.startsWith("refs/remotes/"),
  ).length;
  const otherRefs = refs.length - localBranchRefs - tagRefs - remoteTrackingRefs;
  const refInventorySha256 = createHash("sha256")
    .update(inventoryRows.join("\n"))
    .digest("hex");

  if (refs.length === 0) {
    return {
      snapshot,
      refsInventoried: 0,
      localBranchRefs: 0,
      tagRefs: 0,
      remoteTrackingRefs: 0,
      otherRefs: 0,
      refInventorySha256,
      revisionsScanned: 0,
      revisionLimit,
      olderRevisionsOmitted: false,
      findings: [],
    };
  }

  const revisionOutput = await git(repositoryRoot, [
    "log",
    "--full-history",
    "--topo-order",
    `--max-count=${revisionLimit + 1}`,
    "--format=%H",
    ...refs,
    "--not",
    snapshot,
    "--",
    ".agents/memory",
  ]);
  const revisions = revisionOutput
    .split(/\r?\n/u)
    .filter((revision) => /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(revision));
  const olderRevisionsOmitted = revisions.length > revisionLimit;
  const selectedRevisions = revisions.slice(0, revisionLimit);
  const findings: LocalRefHistoricalAgentMemoryFinding[] = [];

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

    const findingForCommit: HistoricalAgentMemoryFinding[] = [];
    for (const file of changedPaths) {
      const content = await git(repositoryRoot, ["show", `${commit}:${file}`]);
      for (const finding of findAgentMemoryInfrastructure(file, content)) {
        findingForCommit.push({ ...finding, commit });
      }
    }
    if (findingForCommit.length === 0) continue;

    const containingRefs = parseRefInventory(
      await git(repositoryRoot, [
        "for-each-ref",
        `--contains=${commit}`,
        "--format=%(refname)",
      ]),
    );
    for (const candidateRef of containingRefs) {
      for (const finding of findingForCommit) {
        findings.push({ ...finding, ref: candidateRef });
      }
    }
  }

  return {
    snapshot,
    refsInventoried: refs.length,
    localBranchRefs,
    tagRefs,
    remoteTrackingRefs,
    otherRefs,
    refInventorySha256,
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

export function formatLocalRefHistoricalAgentMemoryFinding(
  finding: LocalRefHistoricalAgentMemoryFinding,
): string {
  return `${finding.ref} ${finding.commit} ${finding.file}:${finding.line}: ${finding.category}`;
}

export async function main(
  args = process.argv.slice(2),
  repositoryRoot = resolve(import.meta.dirname, "../.."),
): Promise<void> {
  let ref = "HEAD";
  let refsOutsideSnapshot = false;
  let unreachableCommits = false;
  const cliArgs = args[0] === "--" ? args.slice(1) : args;
  for (let index = 0; index < cliArgs.length; index += 1) {
    if (cliArgs[index] === "--ref" && cliArgs[index + 1]) {
      ref = cliArgs[index + 1];
      index += 1;
    } else if (
      cliArgs[index] === "--refs-outside-snapshot" &&
      cliArgs[index + 1]
    ) {
      ref = cliArgs[index + 1];
      refsOutsideSnapshot = true;
      index += 1;
    } else if (cliArgs[index] === "--unreachable-commits") {
      unreachableCommits = true;
    } else if (cliArgs[index] === "--help") {
      console.log(
        "Usage: check-agent-memory-infrastructure-history.mts [--ref <git-commit-or-ref> | --refs-outside-snapshot <git-commit-or-ref> | --unreachable-commits]",
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

  if (unreachableCommits) {
    const audit = await scanUnreachableAgentMemoryInfrastructure(repositoryRoot);
    console.log(
      `Unreachable agent-memory infrastructure audit: ${audit.commitsScanned} commit(s) scanned; inventory=${audit.commitsInventoried}; limit=${audit.commitLimit}; additional commits omitted=${audit.commitsOmitted ? "yes" : "no"}; inventory sha256=${audit.commitInventorySha256}.`,
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
      "Disposition: findings require owner review before any action. Git history and objects were not changed.",
    );
    return;
  }

  if (refsOutsideSnapshot) {
    const audit = await scanLocalRefsOutsideAgentMemorySnapshot(
      repositoryRoot,
      ref,
    );
    console.log(
      `Local-ref agent-memory infrastructure audit: ${audit.revisionsScanned} revision(s) scanned outside ${audit.snapshot}; limit=${audit.revisionLimit}; older revisions omitted=${audit.olderRevisionsOmitted ? "yes" : "no"}.`,
    );
    console.log(
      `Local refs inventoried: ${audit.refsInventoried} (heads=${audit.localBranchRefs}, tags=${audit.tagRefs}, remote-tracking=${audit.remoteTrackingRefs}, other=${audit.otherRefs}); inventory sha256=${audit.refInventorySha256}.`,
    );
    if (audit.findings.length === 0) {
      console.log("No historical matches found in the scanned range.");
      return;
    }
    console.log(
      `Findings (${audit.findings.length}); output includes metadata only:`,
    );
    for (const finding of audit.findings) {
      console.log(formatLocalRefHistoricalAgentMemoryFinding(finding));
    }
    console.log(
      "Disposition: review each reference with the responsible owner; take owner-approved remediation only when warranted. Git history was not changed.",
    );
    return;
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
    "Disposition: review each reference with the responsible owner; take owner-approved remediation only when warranted. Git history was not changed.",
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
