import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";

const packageRoot = resolve(import.meta.dirname, "..");
const checkerPath = join(packageRoot, "src/check-task-policy.mts");
const contractPath = ".agents/skills/task-execution-rules/SKILL.md";
const writingPath = ".agents/skills/writing-plans/SKILL.md";
const pointer = `Read ${contractPath} before authoring or executing tasks and follow-ups.`;
const coverageInventory =
  "Before narrowing or splitting a broad objective, inventory material input types, formats/locales, layouts, platforms, lifecycle states, and failure paths; put relevant variants in its acceptance and test matrix.";
const variantOwnership =
  "Variants of the same user outcome belong in the owning task, not separate follow-ups. Different tests, false-positive risks, or implementation steps alone do not justify a split. Cover known/common cases within approved access; document genuine exclusions without claiming exhaustive coverage. A separate task still needs an independent user outcome, explicit user deferral, or distinct authorization/safety boundary—not merely a newly written out-of-scope clause.";

// Prose-contract checks, not proof of task-runner compliance or scheduling.
const commonPolicy = [
  "Use one durable task per objective.",
  coverageInventory,
  variantOwnership,
  "Every Draft, accepted task, and follow-up description must include `## Agent-owned execution` and `## Applicable safeguards and verification`. Name task-specific evidence/access paths, user-controlled decisions or permissions, and applicable specialist safety checks and validation matrix.",
  "Before starting, capture the task's scope, affected surfaces, owner, applicable specialist safety checks, and validation matrix.",
  "Triage every error found during work. Record each concrete error in the owning task's failure ledger and fix it there when safe and authorized, even if outside the original scope. Never silently ignore or defer it. If a safe fix requires a user decision/access grant or destructive action, preserve evidence, exact risk/blocker, accountable owner, and next action.",
  "Before creating another task, name its parent or owning task, search current Drafts and active work for overlap, state separate acceptance criteria, identify a genuinely independent outcome, an explicitly deferred user outcome, or a separate safety/approval need, and explain why it cannot safely remain in the owning task.",
  "High- and medium-priority independent outcomes may be proposed; low-priority ones need a concrete benefit and bounded scope. Optional work is not categorically excluded; physical-device-only work is excluded.",
  "Every eligible child plan must state its parent, evidence, explicit priority and rationale, separate acceptance criteria, why it cannot safely remain in the owning task, and the result of checking current work for overlap.",
  "Use dependencies only for genuine technical or user-outcome prerequisites. Unrelated active tasks do not block execution; acceptance time, task number, and creation time do not establish priority or dependencies.",
  "Platform settings determine whether a submitted task immediately becomes Active or remains a Draft. Priority is recorded in the plan, not enforced as native task metadata; the repository checker validates policy wording, not runtime task creation.",
  "This policy preserves current Draft and active tasks and does not merge, cancel, or re-scope them.",
  "If another active task already owns a repair on the same surface, prevent conflicting duplicate edits: keep the discovered error recorded and resolve it with that owner through existing work, without creating a recursive follow-up.",
  "Completion review must retain the owning task's failure ledger and resolve every safely actionable error and required FAIL, BLOCKED, NOT REACHED, and MISSING result.",
  "Do not create a follow-up for a discovered error, test failure, fixture repair, cleanup, validation step, or other sub-outcome.",
  "Every web-facing task includes a compatibility applicability matrix for desktop, phone, tablet portrait/landscape, Chromium/Chrome, and WebKit/Safari. Exceptions need a not applicable, blocked, or not run reason.",
  "Responsive browser emulation is not proof of physical Android Chrome or iOS Safari/PWA behavior. This web-only product creates no native-mobile requirement.",
  pointer,
].join("\n\n");

const planContract = [
  "## Agent-owned execution",
  coverageInventory,
  variantOwnership,
  "Name objective, owner, affected surfaces, task-specific evidence/access paths, and user-controlled inputs.",
  "Before asking the user, inspect the task record, relevant project evidence, configured workflows, and authorized Replit/deployment/service access.",
  "Ask only for a product decision, approval, or specific access permission the user controls.",
  "Record every concrete error in the owning task's failure ledger and fix it there when safe and authorized, even if it is outside the original scope. Never silently ignore or defer it. If a safe fix requires a user decision/access grant, destructive or irreversible action, or cannot responsibly be completed in this task, preserve its evidence, exact risk/blocker, accountable owner, and next action.",
  "## Applicable safeguards and verification",
  "Name applicable repository and specialist safety rules, concrete checks, and the task-specific validation matrix.",
].join("\n\n");

const startup = [
  "Replit documents [`replit.md`](https://docs.replit.com/features/project-setup/replit-dot-md) as project instructions and project skills in `.agents/skills/` as available during background task execution. Tasks use an isolated project copy and do not receive real-time updates. Published docs do not name `AGENTS.md` as an automatic task-agent entry point.",
  "Before substantive work in either the main workspace or an isolated task copy:",
  "Read the current task record, scope, and dependencies; read applicable project skills in `.agents/skills/`.",
  "Check only explicit, genuine task prerequisites and overlap; do not wait for unrelated active tasks.",
  "Before asking the user for evidence, first retrieve it through available authorized workspace, Replit, deployment, or connected-service access. Ask only for a decision, permission, or access grant the user controls.",
].join("\n");
const entryPointer =
  "For Replit main-workspace and isolated task agents, follow the [task-agent startup and evidence-access instructions](replit.md#task-agent-startup-and-evidence-access) before substantive work.";

const validDocuments: Record<string, string> = {
  "AGENTS.md": `${commonPolicy}\n${entryPointer}`,
  "replit.md": `${startup}\n${commonPolicy}`,
  [contractPath]: planContract,
  [writingPath]: `${pointer}\n${planContract}`,
};

type CheckResult = { exitCode: number | null; stdout: string; stderr: string };

async function createFixture(overrides: Record<string, string | undefined> = {}) {
  const root = await mkdtemp(join(tmpdir(), "task-policy-"));
  for (const [relativePath, content] of Object.entries({
    ...validDocuments,
    ...overrides,
  })) {
    if (content === undefined) continue;
    const path = join(root, relativePath);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content, "utf8");
  }
  return root;
}

function runChecker(root?: string): Promise<CheckResult> {
  return new Promise((resolveResult, reject) => {
    const env = { ...process.env };
    if (root === undefined) delete env.TASK_POLICY_ROOT;
    else env.TASK_POLICY_ROOT = root;
    const child = spawn(process.execPath, ["--import", "tsx", checkerPath], {
      cwd: packageRoot, env, stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
    child.on("error", reject);
    child.on("close", exitCode => resolveResult({ exitCode, stdout, stderr }));
  });
}

async function checkFixture(overrides: Record<string, string | undefined>, verify: (result: CheckResult) => void) {
  const root = await createFixture(overrides);
  try { verify(await runChecker(root)); }
  finally { await rm(root, { recursive: true, force: true }); }
}

test("passes the repository's active task guidance", async () => {
  const result = await runChecker();
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "Task policy check passed.\n");
  assert.equal(result.stderr, "");
});

test("accepts complete project-owned fixtures without platform skills or the retired procedure", async () => {
  await checkFixture({}, result => {
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "Task policy check passed.\n");
  });
});

for (const path of Object.keys(validDocuments)) {
  for (const [label, anchor] of [
    ["broad-objective coverage inventory", "inventory material input types"],
    ["broad-objective coverage inventory", "acceptance and test matrix"],
    ["same-outcome variant ownership", "Variants of the same user outcome"],
    ["same-outcome variant ownership", "Different tests, false-positive risks"],
    ["same-outcome variant ownership", "distinct authorization/safety boundary"],
  ]) {
    test(`${path} rejects missing ${label}: ${anchor}`, async () => {
      await checkFixture({
        [path]: validDocuments[path].replaceAll(anchor, "removed"),
      }, result => {
        assert.equal(result.exitCode, 1);
        assert.ok(result.stderr.includes(`${path}: missing ${label}`), result.stderr);
      });
    });
  }
  for (const variant of ["address format", "format variant", "edge case", "test case"]) {
    test(`${path} rejects a separate task for each ${variant}`, async () => {
      await checkFixture({
        [path]: `${validDocuments[path]}\nCreate a separate task for each ${variant}.`,
      }, result => {
        assert.equal(result.exitCode, 1);
        assert.ok(result.stderr.includes(`${path}: contradicts same-outcome variant ownership`), result.stderr);
      });
    });
  }
}

const globalOmissions = [
  ["discovered-error triage and repair", "outside the original scope"],
  ["discovered-error triage and repair", "fix it there when safe and authorized"],
  ["discovered-error triage and repair", "Never silently ignore"],
  ["discovered-error triage and repair", "exact risk/blocker"],
  ["genuine task dependencies only", "Unrelated active tasks do not block execution"],
  ["follow-up priority gate", "concrete benefit and bounded scope"],
  ["optional-work category gate", "Optional work is not categorically excluded"],
  ["physical-device-only exclusion", "physical-device-only work is excluded"],
  ["follow-up child-plan evidence requirement", "Every eligible child plan must state"],
  ["task-platform and checker limitation", "not runtime task creation"],
  ["one-task-per-objective rule", "one durable task per objective"],
  ["per-task execution and applicable safeguards contract", "Every Draft, accepted task, and follow-up description must include"],
  ["task-scope capture rule", "Before starting, capture"],
  ["failure-ledger closure rule", "failure ledger"],
  ["separate-task exception rule", "separate safety/approval need"],
  ["follow-up owner requirement", "parent or owning task"],
  ["follow-up de-duplication requirement", "search current Drafts and active work"],
  ["follow-up acceptance criteria requirement", "state separate acceptance criteria"],
  ["follow-up justification requirement", "explain why it cannot safely remain in the owning task"],
  ["current-task preservation rule", "does not merge, cancel, or re-scope them"],
  ["active-task overlap safety", "prevent conflicting duplicate edits"],
  ["completion ledger resolution rule", "Completion review must retain"],
  ["recursive sub-outcome prohibition", "Do not create a follow-up for a discovered error"],
  ["web compatibility applicability matrix", "compatibility applicability matrix"],
  ["compatibility matrix dimensions", "tablet portrait/landscape"],
  ["compatibility exception reasons", "not applicable"],
  ["physical-device evidence distinction", "Responsive browser emulation"],
  ["web-only native boundary", "native-mobile requirement"],
] as const;

for (const path of ["AGENTS.md", "replit.md"]) {
  for (const [label, anchor] of globalOmissions) {
    test(`${path} rejects missing ${label}: ${anchor}`, async () => {
      await checkFixture({
        [path]: validDocuments[path].replaceAll(anchor, "removed"),
      }, result => {
        assert.equal(result.exitCode, 1);
        assert.ok(result.stderr.includes(`${path}: missing ${label}`), result.stderr);
      });
    });
  }
  for (const [label, contradiction] of [
    ["genuine task dependencies only", "Future-task ordering: wait for earlier accepted tasks."],
    ["genuine task dependencies only", "Task number is primary."],
    ["genuine task dependencies only", "Acceptance order is primary."],
    ["genuine task dependencies only", "Complete the acceptance-order startup procedure."],
    ["follow-up priority gate", "Low-priority outcomes may be submitted without a concrete benefit."],
    ["optional-work category gate", "Optional work is categorically excluded."],
    ["physical-device-only exclusion", "Physical-device-only work is allowed."],
    ["task-platform and checker limitation", "Priority is enforced as native task metadata."],
    ["task-platform and checker limitation", "The repository checker enforces runtime task creation."],
    ["task-platform and checker limitation", "Repository policy determines whether a submitted task immediately becomes Active."],
  ]) {
    test(`${path} rejects contradiction: ${contradiction}`, async () => {
      await checkFixture({
        [path]: `${validDocuments[path]}\n${contradiction}`,
      }, result => {
        assert.equal(result.exitCode, 1);
        assert.ok(result.stderr.includes(`${path}: contradicts ${label}`), result.stderr);
      });
    });
  }
}

for (const path of [contractPath, writingPath]) {
  for (const [label, anchor] of [
    ["agent-owned execution heading", "## Agent-owned execution"],
    ["applicable safeguards heading", "## Applicable safeguards and verification"],
    ["evidence-first task-plan contract", "Before asking the user, inspect the task record"],
    ["discovered-error task-plan contract", "outside the original scope"],
    ["discovered-error task-plan contract", "fix it there when safe and authorized"],
    ["discovered-error task-plan contract", "exact risk/blocker"],
    ["task-plan verification matrix", "validation matrix"],
  ]) {
    test(`${path} rejects missing ${label}: ${anchor}`, async () => {
      await checkFixture({
        [path]: validDocuments[path].replaceAll(anchor, "removed"),
      }, result => {
        assert.equal(result.exitCode, 1);
        assert.ok(result.stderr.includes(`${path}: missing ${label}`), result.stderr);
      });
    });
  }
}

for (const [label, anchor] of [
  ["task startup rules and applicable skills", "Before substantive work in either"],
  ["task startup rules and applicable skills", "Check only explicit, genuine task prerequisites"],
  ["evidence-first access before asking the user", "Before asking the user for evidence"],
  ["supported instruction delivery and stale-session boundary", "do not receive real-time updates"],
]) {
  test(`replit.md rejects missing ${label}: ${anchor}`, async () => {
    await checkFixture({
      "replit.md": validDocuments["replit.md"].replaceAll(anchor, "removed"),
    }, result => {
      assert.equal(result.exitCode, 1);
      assert.ok(result.stderr.includes(`replit.md: missing ${label}`), result.stderr);
    });
  });
}

test("requires the AGENTS task-startup pointer", async () => {
  await checkFixture({
    "AGENTS.md": validDocuments["AGENTS.md"].replace(entryPointer, ""),
  }, result => {
    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /missing Replit task-agent startup pointer/);
  });
});

for (const path of ["AGENTS.md", "replit.md", writingPath]) {
  test(`${path} must route to the durable project-owned contract`, async () => {
    await checkFixture({
      [path]: validDocuments[path].replaceAll(pointer, ""),
    }, result => {
      assert.equal(result.exitCode, 1);
      assert.match(result.stderr, /missing project-owned task contract pointer/);
    });
  });
}

for (const path of Object.keys(validDocuments)) {
  test(`fails closed when ${path} is missing`, async () => {
    await checkFixture({ [path]: undefined }, result => {
      assert.equal(result.exitCode, 1);
      assert.ok(result.stderr.includes(`${path}: could not read`), result.stderr);
    });
  });
}

test("retired acceptance-order evidence is not current policy", async () => {
  await checkFixture({
    "docs/follow-up-dependency-submission.md": "Historical record only. Acceptance order is primary; wait for earlier accepted tasks.",
  }, result => {
    assert.equal(result.exitCode, 0, result.stderr);
  });
});
