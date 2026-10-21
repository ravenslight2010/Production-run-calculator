import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { test } from "node:test";
import {
  formatHistoricalAgentMemoryFinding,
  main,
  scanHistoricalAgentMemoryInfrastructure,
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
