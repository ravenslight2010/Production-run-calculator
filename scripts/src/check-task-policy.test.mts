import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";

const packageRoot = resolve(import.meta.dirname, "..");
const checkerPath = join(packageRoot, "src/check-task-policy.mts");

// These are prose-contract cases, not task eligibility or platform scheduling tests.
const acceptancePolicyRules = [
  {
    label: "universal future acceptance coverage",
    phrase: "Clicking Accept establishes precedence for all future manually planned tasks, generated follow-ups of every category, standalone suggestions, main-workspace work, and isolated task agents.",
    contradictions: [
      "Acceptance-order policy applies only to generated children.",
      "Each generated child depends on every unfinished accepted task present when it is created, and later generated siblings wait behind earlier generated siblings.",
    ],
  },
  {
    label: "acceptance-first numeric verified ties",
    phrase: "Acceptance order is primary; lower task number breaks only a verified acceptance-order tie, such as batch acceptance. Compare numeric task refs numerically, not lexicographically. Creation time and task number never override known acceptance order.",
    contradictions: [
      "Creation time determines precedence.",
      "Task number is primary.",
      "Order tasks by task number first.",
      "For unknown acceptance order fall back to task number.",
    ],
  },
  {
    label: "startup complete evidence and persisted prerequisites",
    phrase: "Before substantive execution, read a complete inventory and reliable acceptance-order evidence, verify every unfinished task accepted earlier is a persisted prerequisite, and wait for those prerequisites to finish.",
    contradictions: [],
  },
  {
    label: "explicit advisory blockers",
    phrase: "Missing evidence, missing dependency links, or unfinished prerequisites produce an explicit blocked/advisory outcome, not a claim of compliant execution.",
    contradictions: [],
  },
  {
    label: "unfinished states and drafts",
    phrase: "Unapproved drafts do not block work; accepted work awaiting merge remains unfinished; merged or archived work does not block.",
    contradictions: [
      "Unapproved drafts do block work.",
      "Accepted work awaiting merge is finished.",
    ],
  },
  {
    label: "later acceptance and genuine prerequisites",
    phrase: "Later acceptances are not retroactively added as ordering dependencies. Preserve genuine prerequisite dependencies rather than erasing them.",
    contradictions: [
      "Later acceptances are retroactively added as ordering dependencies.",
      "Erase genuine prerequisite dependencies.",
    ],
  },
  {
    label: "unknown acceptance provenance",
    phrase: "Creation/update timestamps are not acceptance evidence; unknown acceptance order stays unknown.",
    contradictions: [
      "Derive acceptedAt from createdAt.",
      "Infer acceptance timestamp from updatedAt.",
      "Creation/update timestamps are acceptance evidence.",
    ],
  },
  {
    label: "advisory versus scheduler boundary",
    phrase: "An advisory agent check cannot intercept acceptance or pause platform execution. Documentation or a passing checker does not enforce scheduling.",
    contradictions: [
      "Documentation enforces scheduling.",
      "A passing checker guarantees acceptance order.",
      "An advisory agent check pauses platform execution.",
    ],
  },
];
const acceptancePolicy = acceptancePolicyRules.map(rule => rule.phrase);
const procedureRules = [
  {
    label: "complete state inventory procedure",
    phrase: "Read PENDING, IN_PROGRESS, IMPLEMENTED, MERGING, QUEUED including MAIN_*; require truncated: false and returned count equal to totalCount. If any shard is incomplete, stop.",
  },
  {
    label: "acceptance provenance procedure",
    phrase: "Require owner-attested sequential/batch acceptance receipts. Missing acceptance evidence produces BLOCKED — acceptance order unknown.",
  },
  {
    label: "manual recording and race boundary",
    phrase: "There is a read/create race. Record dependsOn through manual creation; updateProjectTask replaces the full list, preserving genuine existing prerequisites.",
  },
  {
    label: "bounded receipt procedure",
    phrase: "Record a bounded outcome with refs, states, verified sequence/ties, dependencies, capture time, source, and next action. Capture time is not acceptance time; do not fabricate times.",
  },
  {
    label: "future-only current record exclusion",
    phrase: "The user handles existing tasks. Do not change any current task record, dependency, scope, acceptance, assignment, or automation setting.",
  },
  {
    label: "sequential acceptance limitations",
    phrase: "User-coordinated sequential acceptance limits overlap but does not create edges. If settings automatically accept/start work, this alternative is unavailable.",
  },
];

const validDocuments: Record<string, string> = {
  "AGENTS.md": [
    "Use one durable task per objective.",
    "Before starting, capture the task's scope, affected surfaces, owner, applicable specialist safety checks, and validation matrix.",
    "Keep discoveries for the same objective in the owning task's progress updates and failure ledger. Fix every in-scope finding before completion.",
    "A separate project task is allowed only for a genuinely independent outcome with separate acceptance criteria, an explicitly deferred user outcome, or an out-of-scope safety, security, data-integrity, or release blocker.",
    "Before creating another task, name the parent or owning task, search active and draft work for overlap, state independent acceptance criteria, name the approved exception, and document why the work cannot remain in the owning task.",
    "Finish every in-scope finding in its owning task; do not create child tasks for symptoms, test failures, fixture repairs, or other sub-outcomes. High- and medium-priority independent outcomes may be submitted as child tasks. Low-priority outcomes may be submitted only when the plan states a concrete benefit and bounded scope. Optional work is not categorically excluded; physical-device-only work is excluded.",
    "Every eligible child plan must state its parent, evidence, explicit priority and rationale, separate acceptance criteria, why it cannot remain in the owning task, and the result of checking current work for overlap.",
    ...acceptancePolicy,
    "Platform settings determine whether a submitted task immediately becomes Active or remains a Draft. Priority is recorded in the plan, not enforced as native task metadata; the repository checker validates policy wording, not runtime task creation.",
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
    "Finish in-scope work in the owning task; child tasks are for distinct outcomes with independent acceptance criteria, not symptoms, test failures, fixture repairs, or other sub-outcomes. High- and medium-priority independent outcomes may be submitted as child tasks. Low-priority outcomes may be submitted only when the plan states a concrete benefit and bounded scope. Optional work is not categorically excluded; physical-device-only work is excluded.",
    "Every eligible child plan must state its parent, evidence, explicit priority and rationale, separate acceptance criteria, why it cannot remain in the owning task, and the result of checking current work for overlap.",
    ...acceptancePolicy,
    "Platform settings determine whether a submitted task immediately becomes Active or remains a Draft. Priority is recorded in the plan, not enforced as native task metadata; the repository checker validates policy wording, not runtime task creation.",
    "This audit preserves current draft and active tasks and does not merge, cancel, or re-scope them. New in-scope findings return to the matching existing owner.",
    "Completion review must retain the owning task's failure ledger and resolve every in-scope FAIL. Test failures, fixture repairs, cleanup, validation work, and other sub-outcomes must not become recursive tasks.",
    "Every web-facing task must include a compatibility applicability matrix for desktop, phone, tablet portrait/landscape, Chromium/Chrome, and WebKit/Safari. Record an explicit not applicable, blocked, or not run reason for each check that is not a pass.",
    "Responsive browser emulation is automated evidence, not physical Android Chrome or iOS Safari/PWA evidence; this remains a web-only product with no native-mobile requirement.",
  ].join("\n"),
  "docs/follow-up-dependency-submission.md": [
    ...acceptancePolicy,
    ...procedureRules.map(rule => rule.phrase),
  ].join("\n"),
};

const newPolicyRules = [
  {
    label: "follow-up priority gate",
    omissions: [
      "High- and medium-priority independent outcomes may be submitted as child tasks.",
      "Low-priority outcomes may be submitted only when the plan states a concrete benefit and bounded scope.",
    ],
    contradictions: [
      "Low-priority outcomes may be submitted without a concrete benefit and bounded scope.",
    ],
  },
  {
    label: "optional-work category gate",
    omissions: ["Optional work is not categorically excluded"],
    contradictions: [
      "Optional work is categorically excluded.",
    ],
  },
  {
    label: "physical-device-only exclusion",
    omissions: ["physical-device-only work is excluded."],
    contradictions: ["Physical-device-only work is allowed."],
  },
  {
    label: "follow-up child-plan evidence requirement",
    omissions: [
      "Every eligible child plan must state its parent, evidence, explicit priority and rationale, separate acceptance criteria, why it cannot remain in the owning task, and the result of checking current work for overlap.",
    ],
    contradictions: [],
  },
  {
    label: "task-platform and checker limitation",
    omissions: [
      "Platform settings determine whether a submitted task immediately becomes Active or remains a Draft. Priority is recorded in the plan, not enforced as native task metadata; the repository checker validates policy wording, not runtime task creation.",
    ],
    contradictions: [
      "Priority is enforced as native task metadata.",
      "The repository checker enforces runtime task creation.",
      "Repository policy determines whether a submitted task immediately becomes Active or remains a Draft.",
    ],
  },
];

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

    const child = spawn(process.execPath, ["--import", "tsx", checkerPath], {
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

for (const relativePath of Object.keys(validDocuments)) {
  const rules = acceptancePolicyRules.map(rule => ({
    label: rule.label, omissions: [rule.phrase], contradictions: rule.contradictions,
  }));
  if (relativePath.startsWith("docs/")) {
    rules.push(...procedureRules.map(rule => ({
      label: rule.label, omissions: [rule.phrase], contradictions: [],
    })));
  } else {
    rules.push(...newPolicyRules);
  }
  for (const rule of rules) {
    for (const omission of rule.omissions) {
      test(`${relativePath} fails when ${rule.label} is omitted`, async () => {
        const root = await createFixture({
          [relativePath]: validDocuments[relativePath].replace(omission, ""),
        });

        try {
          const result = await runChecker(root);
          assert.equal(result.exitCode, 1);
          assert.match(result.stderr, new RegExp(`${relativePath}: missing ${rule.label}`));
        } finally {
          await rm(root, { recursive: true, force: true });
        }
      });
    }

    for (const contradiction of rule.contradictions) {
      test(`${relativePath} fails when ${rule.label} is contradicted`, async () => {
        const root = await createFixture({
          [relativePath]: `${validDocuments[relativePath]}\n${contradiction}\n`,
        });

        try {
          const result = await runChecker(root);
          assert.equal(result.exitCode, 1);
          assert.match(
            result.stderr,
            new RegExp(`${relativePath}: contradicts ${rule.label}`),
          );
        } finally {
          await rm(root, { recursive: true, force: true });
        }
      });
    }
  }
}

test("prose examples preserve acceptance-first order, numeric ties, and genuine edges without claiming scheduler proof", async () => {
  const examples = [
    "Example: #100 accepted before #9 has precedence, even if #9 was created first.",
    "Example: in a verified batch acceptance tie, #9 precedes #10 numerically.",
    "Example: an unapproved draft has no acceptance position; awaiting merge stays unfinished.",
    "Example: accepting #101 later does not retroactively block #100.",
    "Example: an incomplete inventory or missing acceptance receipt blocks advisory startup.",
    "Example: preserve a genuine migration prerequisite even when it is not an ordering edge.",
  ].join("\n");
  const root = await createFixture(Object.fromEntries(
    Object.entries(validDocuments).map(([path, content]) => [path, `${content}\n${examples}`]),
  ));
  try {
    const result = await runChecker(root);
    assert.equal(result.exitCode, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a missing submission procedure document fails closed", async () => {
  const root = await createFixture({ "docs/follow-up-dependency-submission.md": undefined });
  try {
    const result = await runChecker(root);
    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /docs\/follow-up-dependency-submission.md: could not read/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
