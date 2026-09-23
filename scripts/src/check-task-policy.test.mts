import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";

const packageRoot = resolve(import.meta.dirname, "..");
const checkerPath = join(packageRoot, "src/check-task-policy.mts");

const validDocuments: Record<string, string> = {
  "AGENTS.md": [
    "Use one durable task per objective.",
    "Before starting, capture the task's scope, affected surfaces, owner, applicable specialist safety checks, and validation matrix.",
    "Keep discoveries for the same objective in the owning task's progress updates and failure ledger. Fix every in-scope finding before completion.",
    "A separate project task is allowed only for a genuinely independent outcome with separate acceptance criteria, an explicitly deferred user outcome, or an out-of-scope safety, security, data-integrity, or release blocker.",
    "Before creating another task, name the parent or owning task, search active and draft work for overlap, state independent acceptance criteria, name the approved exception, and document why the work cannot remain in the owning task.",
    "Applying this rule to current draft and active tasks must not merge, cancel, or re-scope them. New in-scope findings return to the matching existing owner.",
    "Completion review must retain the owning task's failure ledger and resolve every in-scope FAIL. Test failures, fixture repairs, cleanup, validation work, and other sub-outcomes must not become recursive tasks.",
    "For every web-facing task, record a compatibility applicability matrix covering desktop, phone, tablet portrait/landscape, Chromium/Chrome, and WebKit/Safari. Each check must have an explicit not applicable, blocked, or not run reason when it is not a pass.",
    "Responsive browser emulation is automated evidence only; it is not proof of physical Android Chrome or iOS Safari/PWA behavior. This is a web-only product and does not create a native-mobile requirement.",
  ].join("\n"),
  "replit.md": [
    "Generate one durable task per work objective.",
    "Before starting, capture the task's scope, affected surfaces, expected owner, applicable specialist safety checks, and validation matrix.",
    "Keep newly discovered in-scope failures in the owning task's failure ledger and close them before completion.",
    "A separate project task requires a genuinely independent outcome with separate acceptance criteria, an explicitly deferred user outcome, or an out-of-scope safety, security, data-integrity, or release blocker.",
    "Before creating another task, name the parent or owning task, search current draft and active tasks for overlap, state independent acceptance criteria, name the approved exception, and document why the work cannot remain in the owning task.",
    "This audit preserves current draft and active tasks and does not merge, cancel, or re-scope them. New in-scope findings return to the matching existing owner.",
    "Completion review must retain the owning task's failure ledger and resolve every in-scope FAIL. Test failures, fixture repairs, cleanup, validation work, and other sub-outcomes must not become recursive tasks.",
    "Every web-facing task must include a compatibility applicability matrix for desktop, phone, tablet portrait/landscape, Chromium/Chrome, and WebKit/Safari. Record an explicit not applicable, blocked, or not run reason for each check that is not a pass.",
    "Responsive browser emulation is automated evidence, not physical Android Chrome or iOS Safari/PWA evidence; this remains a web-only product with no native-mobile requirement.",
  ].join("\n"),
};

type CheckResult = {
  exitCode: number | null;
  stdout: string;
  stderr: string;
};

async function createFixture(
  overrides: Record<string, string | undefined> = {},
): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "task-policy-"));

  for (const [relativePath, content] of Object.entries(validDocuments)) {
    const overridden = Object.prototype.hasOwnProperty.call(
      overrides,
      relativePath,
    )
      ? overrides[relativePath]
      : content;
    if (overridden === undefined) continue;

    const path = join(root, relativePath);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, overridden, "utf8");
  }

  return root;
}

function runChecker(root?: string): Promise<CheckResult> {
  return new Promise((resolveResult, reject) => {
    const env = { ...process.env };
    if (root === undefined) {
      delete env.TASK_POLICY_ROOT;
    } else {
      env.TASK_POLICY_ROOT = root;
    }

    const child = spawn("pnpm", ["exec", "tsx", checkerPath], {
      cwd: packageRoot,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (exitCode) =>
      resolveResult({ exitCode, stdout, stderr }),
    );
  });
}

test("passes both repository task policy documents", async () => {
  const result = await runChecker();
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "Task policy check passed.\n");
  assert.equal(result.stderr, "");
});

test("accepts equivalent policy wording in both documents", async () => {
  const root = await createFixture();
  try {
    const result = await runChecker(root);
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, "Task policy check passed.\n");
    assert.equal(result.stderr, "");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("names the document and missing rule when the policies drift", async () => {
  const root = await createFixture({
    "replit.md": validDocuments["replit.md"].replace(
      "failure ledger",
      "task notes",
    ),
  });

  try {
    const result = await runChecker(root);
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout, "");
    assert.equal(
      result.stderr,
      [
        "Task policy check failed:",
        "- replit.md: missing failure-ledger closure rule; keep same-objective discoveries in the owning task's failure ledger and close them before completion",
        "",
      ].join("\n"),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("protects the compatibility matrix requirement from policy drift", async () => {
  const root = await createFixture({
    "replit.md": validDocuments["replit.md"].replace(
      "compatibility applicability matrix",
      "compatibility checklist",
    ),
  });

  try {
    const result = await runChecker(root);
    assert.equal(result.exitCode, 1);
    assert.match(
      result.stderr,
      /replit\.md: missing web compatibility applicability matrix; require a compatibility applicability matrix for every web-facing task/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

for (const driftCase of [
  {
    name: "follow-up justification",
    phrase: "why the work cannot remain in the owning task",
    replacement: "where the work was discovered",
    expected: "missing follow-up justification requirement",
  },
  {
    name: "current-task preservation",
    phrase: "does not merge, cancel, or re-scope them",
    replacement: "reviews them together",
    expected: "missing current-task preservation rule",
  },
  {
    name: "existing-owner routing",
    phrase: "New in-scope findings return to the matching existing owner.",
    replacement: "New findings are documented.",
    expected: "missing existing-owner routing rule",
  },
  {
    name: "follow-up de-duplication",
    phrase: "search current draft and active tasks for overlap",
    replacement: "review the proposed title",
    expected: "missing follow-up de-duplication requirement",
  },
  {
    name: "completion ledger resolution",
    phrase:
      "Completion review must retain the owning task's failure ledger and resolve every in-scope FAIL.",
    replacement: "Completion review summarizes the result.",
    expected: "missing completion ledger resolution rule",
  },
]) {
  test(`protects the ${driftCase.name} rule from policy drift`, async () => {
    const root = await createFixture({
      "replit.md": validDocuments["replit.md"].replace(
        driftCase.phrase,
        driftCase.replacement,
      ),
    });

    try {
      const result = await runChecker(root);
      assert.equal(result.exitCode, 1);
      assert.match(result.stderr, new RegExp(driftCase.expected));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}
