import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { test } from "node:test";
import {
  formatHistoricalAgentMemoryFinding,
  formatLocalRefHistoricalAgentMemoryFinding,
  main,
  scanHistoricalAgentMemoryInfrastructure,
  scanLocalRefsOutsideAgentMemorySnapshot,
} from "./check-agent-memory-infrastructure-history.mts";

const execFileAsync = promisify(execFile);

async function git(repositoryRoot: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, {
    cwd: repositoryRoot,
    encoding: "utf8",
  });
  return stdout.trim();
}

async function commitFile(
  repositoryRoot: string,
  relativePath: string,
  content: string,
  message: string,
): Promise<string> {
  const absolutePath = join(repositoryRoot, relativePath);
  await mkdir(join(absolutePath, ".."), { recursive: true });
  await writeFile(absolutePath, content);
  await git(repositoryRoot, ["add", "--", relativePath]);
  await git(repositoryRoot, ["commit", "-m", message]);
  return git(repositoryRoot, ["rev-parse", "HEAD"]);
}

test("history scan reports metadata only for every changed note version", async () => {
  const repositoryRoot = await mkdtemp(join(tmpdir(), "agent-memory-history-"));
  const privateHost = "synthetic-service.private.example.internal";
  const deploymentImage =
    "FROM synthetic-registry.invalid/team/api:secret-build.7";

  try {
    await git(repositoryRoot, ["init", "-q"]);
    await git(repositoryRoot, ["config", "user.name", "Synthetic Audit"]);
    await git(repositoryRoot, ["config", "user.email", "audit@example.invalid"]);
    const hostCommit = await commitFile(
      repositoryRoot,
      ".agents/memory/example.md",
      `Endpoint: ${privateHost}\n`,
      "Add synthetic host",
    );
    const imageCommit = await commitFile(
      repositoryRoot,
      ".agents/memory/example.md",
      `${deploymentImage}\n`,
      "Replace with synthetic image",
    );
    await commitFile(
      repositoryRoot,
      ".agents/memory/codex-fixes.md",
      `${privateHost}\n${deploymentImage}\n`,
      "Add excluded fix history",
    );
    await commitFile(
      repositoryRoot,
      ".agents/memory/not-markdown.txt",
      `${privateHost}\n`,
      "Add excluded text file",
    );

    const audit = await scanHistoricalAgentMemoryInfrastructure(
      repositoryRoot,
      "HEAD",
    );
    const diagnostics = audit.findings
      .map(formatHistoricalAgentMemoryFinding)
      .join("\n");

    assert.equal(audit.revisionsScanned, 4);
    assert.equal(audit.olderRevisionsOmitted, false);
    assert.deepEqual(
      audit.findings.map(({ commit, file, line, category }) => ({
        commit,
        file,
        line,
        category,
      })),
      [
        {
          commit: imageCommit,
          file: ".agents/memory/example.md",
          line: 1,
          category: "deployment image reference",
        },
        {
          commit: hostCommit,
          file: ".agents/memory/example.md",
          line: 1,
          category: "infrastructure host",
        },
      ],
    );
    assert.equal(diagnostics.includes(privateHost), false);
    assert.equal(diagnostics.includes(deploymentImage), false);
    assert.equal(
      JSON.stringify(audit).includes(privateHost),
      false,
    );
    assert.equal(
      JSON.stringify(audit).includes(deploymentImage),
      false,
    );

    const output: string[] = [];
    const originalLog = console.log;
    console.log = (...values: unknown[]) => {
      output.push(values.join(" "));
    };
    try {
      await main(["--", "--ref", "HEAD"], repositoryRoot);
    } finally {
      console.log = originalLog;
    }
    const cliOutput = output.join("\n");
    assert.equal(cliOutput.includes(hostCommit), true);
    assert.equal(cliOutput.includes(imageCommit), true);
    assert.equal(cliOutput.includes(privateHost), false);
    assert.equal(cliOutput.includes(deploymentImage), false);
  } finally {
    await rm(repositoryRoot, { recursive: true, force: true });
  }
});

test("history scan applies a reproducible revision cap and honors the snapshot", async () => {
  const repositoryRoot = await mkdtemp(join(tmpdir(), "agent-memory-history-cap-"));
  const olderHost = "older-fixture.internal";

  try {
    await git(repositoryRoot, ["init", "-q"]);
    await git(repositoryRoot, ["config", "user.name", "Synthetic Audit"]);
    await git(repositoryRoot, ["config", "user.email", "audit@example.invalid"]);
    const olderCommit = await commitFile(
      repositoryRoot,
      ".agents/memory/example.md",
      `${olderHost}\n`,
      "Add older synthetic host",
    );
    await commitFile(
      repositoryRoot,
      ".agents/memory/example.md",
      "No infrastructure reference.\n",
      "Remove synthetic host",
    );

    const audit = await scanHistoricalAgentMemoryInfrastructure(
      repositoryRoot,
      olderCommit,
      1,
    );
    const cappedAudit = await scanHistoricalAgentMemoryInfrastructure(
      repositoryRoot,
      "HEAD",
      1,
    );

    assert.equal(audit.snapshot, olderCommit);
    assert.equal(audit.revisionsScanned, 1);
    assert.equal(audit.olderRevisionsOmitted, false);
    assert.equal(audit.findings.length, 1);
    assert.equal(audit.findings[0]?.commit, olderCommit);
    assert.equal(cappedAudit.revisionsScanned, 1);
    assert.equal(cappedAudit.olderRevisionsOmitted, true);
    assert.equal(cappedAudit.findings.length, 0);
    assert.equal(
      JSON.stringify(audit).includes(olderHost),
      false,
    );
  } finally {
    await rm(repositoryRoot, { recursive: true, force: true });
  }
});

test("history scan rejects unsafe or unbounded revision limits", async () => {
  await assert.rejects(
    scanHistoricalAgentMemoryInfrastructure(process.cwd(), "HEAD", 0),
    /revisionLimit must be an integer/u,
  );
  await assert.rejects(
    scanHistoricalAgentMemoryInfrastructure(
      process.cwd(),
      "HEAD",
      2001,
    ),
    /revisionLimit must be an integer/u,
  );
});

test("local-ref scan finds and redacts a synthetic branch-only match", async () => {
  const repositoryRoot = await mkdtemp(
    join(tmpdir(), "agent-memory-history-refs-"),
  );
  const privateHost = "branch-only.synthetic.internal";

  try {
    await git(repositoryRoot, ["init", "-q"]);
    await git(repositoryRoot, ["config", "user.name", "Synthetic Audit"]);
    await git(repositoryRoot, ["config", "user.email", "audit@example.invalid"]);
    const snapshot = await commitFile(
      repositoryRoot,
      ".agents/memory/example.md",
      "No infrastructure reference.\n",
      "Create pinned snapshot",
    );
    await git(repositoryRoot, ["switch", "-c", "audit-only"]);
    const branchOnlyCommit = await commitFile(
      repositoryRoot,
      ".agents/memory/example.md",
      `Endpoint: ${privateHost}\n`,
      "Add branch-only synthetic host",
    );

    const audit = await scanLocalRefsOutsideAgentMemorySnapshot(
      repositoryRoot,
      snapshot,
    );
    const repeatedAudit = await scanLocalRefsOutsideAgentMemorySnapshot(
      repositoryRoot,
      snapshot,
    );
    const formatted = audit.findings
      .map(formatLocalRefHistoricalAgentMemoryFinding)
      .join("\n");

    assert.equal(audit.snapshot, snapshot);
    assert.equal(audit.refsInventoried, 2);
    assert.equal(
      audit.refInventorySha256,
      repeatedAudit.refInventorySha256,
    );
    assert.equal(audit.localBranchRefs, 2);
    assert.equal(audit.tagRefs, 0);
    assert.equal(audit.remoteTrackingRefs, 0);
    assert.match(audit.refInventorySha256, /^[0-9a-f]{64}$/u);
    assert.equal(audit.revisionsScanned, 1);
    assert.equal(audit.olderRevisionsOmitted, false);
    assert.deepEqual(
      audit.findings.map(({ ref, commit, file, line, category }) => ({
        ref,
        commit,
        file,
        line,
        category,
      })),
      [
        {
          ref: "refs/heads/audit-only",
          commit: branchOnlyCommit,
          file: ".agents/memory/example.md",
          line: 1,
          category: "infrastructure host",
        },
      ],
    );
    assert.equal(formatted.includes(privateHost), false);
    assert.equal(JSON.stringify(audit).includes(privateHost), false);
    assert.equal(formatted.includes("refs/heads/audit-only"), true);
    assert.equal(formatted.includes(branchOnlyCommit), true);

    const output: string[] = [];
    const originalLog = console.log;
    console.log = (...values: unknown[]) => {
      output.push(values.join(" "));
    };
    try {
      await main(
        ["--", "--refs-outside-snapshot", snapshot],
        repositoryRoot,
      );
    } finally {
      console.log = originalLog;
    }
    const cliOutput = output.join("\n");
    assert.equal(cliOutput.includes(privateHost), false);
    assert.equal(cliOutput.includes("refs/heads/audit-only"), true);
    assert.equal(cliOutput.includes(branchOnlyCommit), true);
    assert.equal(cliOutput.includes("Git history was not changed."), true);
  } finally {
    await rm(repositoryRoot, { recursive: true, force: true });
  }
});

test("local-ref scan inventories tags and remote refs and respects its cap", async () => {
  const repositoryRoot = await mkdtemp(
    join(tmpdir(), "agent-memory-history-ref-cap-"),
  );
  const firstPrivateHost = "first-branch-only.synthetic.internal";
  const secondPrivateHost = "second-branch-only.synthetic.internal";

  try {
    await git(repositoryRoot, ["init", "-q"]);
    await git(repositoryRoot, ["config", "user.name", "Synthetic Audit"]);
    await git(repositoryRoot, ["config", "user.email", "audit@example.invalid"]);
    const snapshot = await commitFile(
      repositoryRoot,
      ".agents/memory/example.md",
      "No infrastructure reference.\n",
      "Create pinned snapshot",
    );
    await git(repositoryRoot, ["switch", "-c", "audit-only"]);
    await commitFile(
      repositoryRoot,
      ".agents/memory/example.md",
      `Endpoint: ${firstPrivateHost}\n`,
      "Add first branch-only host",
    );
    const latestCommit = await commitFile(
      repositoryRoot,
      ".agents/memory/example.md",
      `Endpoint: ${secondPrivateHost}\n`,
      "Add second branch-only host",
    );
    await git(repositoryRoot, ["tag", "--annotate", "audit-tag", "-m", "test"]);
    await git(repositoryRoot, [
      "update-ref",
      "refs/remotes/origin/audit-only",
      latestCommit,
    ]);
    await git(repositoryRoot, [
      "update-ref",
      "refs/custom/audit-only",
      latestCommit,
    ]);

    const audit = await scanLocalRefsOutsideAgentMemorySnapshot(
      repositoryRoot,
      snapshot,
      1,
    );

    assert.equal(audit.refsInventoried, 5);
    assert.equal(audit.localBranchRefs, 2);
    assert.equal(audit.tagRefs, 1);
    assert.equal(audit.remoteTrackingRefs, 1);
    assert.equal(audit.otherRefs, 1);
    assert.equal(audit.revisionsScanned, 1);
    assert.equal(audit.olderRevisionsOmitted, true);
    assert.deepEqual(
      audit.findings.map(({ ref, commit, file, line, category }) => ({
        ref,
        commit,
        file,
        line,
        category,
      })),
      [
        {
          ref: "refs/custom/audit-only",
          commit: latestCommit,
          file: ".agents/memory/example.md",
          line: 1,
          category: "infrastructure host",
        },
        {
          ref: "refs/heads/audit-only",
          commit: latestCommit,
          file: ".agents/memory/example.md",
          line: 1,
          category: "infrastructure host",
        },
        {
          ref: "refs/remotes/origin/audit-only",
          commit: latestCommit,
          file: ".agents/memory/example.md",
          line: 1,
          category: "infrastructure host",
        },
        {
          ref: "refs/tags/audit-tag",
          commit: latestCommit,
          file: ".agents/memory/example.md",
          line: 1,
          category: "infrastructure host",
        },
      ],
    );
    const formatted = audit.findings
      .map(formatLocalRefHistoricalAgentMemoryFinding)
      .join("\n");
    assert.equal(formatted.includes(firstPrivateHost), false);
    assert.equal(formatted.includes(secondPrivateHost), false);
    assert.equal(JSON.stringify(audit).includes(firstPrivateHost), false);
    assert.equal(JSON.stringify(audit).includes(secondPrivateHost), false);
  } finally {
    await rm(repositoryRoot, { recursive: true, force: true });
  }
});
