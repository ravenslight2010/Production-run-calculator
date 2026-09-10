import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";

const packageRoot = resolve(import.meta.dirname, "..");
const checkerPath = join(packageRoot, "src/check-operational-skill-evidence.mts");

const validDocuments: Record<string, string> = {
  "replit.md": [
    "Fix task-scoped errors immediately.",
    "Bring an unrelated error into the current task when it blocks required validation or creates a safety, security, data-integrity, or release risk.",
    "Record all observed results as `PASS`, `FAIL`, `BLOCKED`, `NOT REACHED`, or `MISSING`.",
    "otherwise de-duplicate it and capture a bounded Draft with evidence and a next action",
    "Never claim success by treating missing evidence as a pass.",
    "Current objective: <release outcome and assessed scope>",
    "Completed work: <closed repair domains and evidence, each with PASS/FAIL>",
    "Active blockers: <unresolved blocker, evidence, and owner for each>",
    "Next validation milestone: <next check or decision point; name its prerequisite>",
    "Owner: <person or team accountable for completion>",
    "For release work, list independent evidence work separately from checks that depend on it. Continue every independent check that is valid and safe; mark a dependent check `BLOCKED` or `NOT REACHED`, name the failed prerequisite, and keep it unresolved until its evidence exists.",
  ].join("\n"),
  ".agents/skills/production-go/SKILL.md": [
    "do not stop the investigation at the first unrelated failure because it must not hide independent evidence",
    "Record every result as `PASS`, `FAIL`, `BLOCKED`, `NOT REACHED`, or `MISSING`.",
    "create the smallest de-duplicated set of bounded repair tasks",
    "Treat `BLOCKED`, `NOT REACHED`, and `MISSING` as unresolved until the required evidence exists.",
    "Current objective: <release outcome and assessed scope>",
    "Completed work: <closed repair domains and evidence, each with PASS/FAIL>",
    "Active blockers: <unresolved blocker, evidence, and owner for each>",
    "Next validation milestone: <next check or decision point; name its prerequisite>",
    "Owner: <person or team accountable for completion>",
    "**Independent evidence:** safe gates that can continue despite another failure; run them and record their actual status.",
    "**Dependent checks:** gates waiting on a named prerequisite; record them as `BLOCKED` or `NOT REACHED` with that prerequisite instead of implying a pass.",
  ].join("\n"),
  ".agents/skills/release-checklist/SKILL.md": [
    "Run all applicable gates that remain valid and safe to run; do not stop at the first unrelated failure because independent gates should still produce evidence.",
    "Record each result explicitly as `PASS`, `FAIL`, `BLOCKED`, `NOT REACHED`, or `MISSING`.",
    "de-duplicate the blocker inventory against the task board and create bounded repair tasks",
    "A failed command or missing evidence is a **no-go**.",
    "Current objective: <release outcome and assessed scope>",
    "Completed work: <closed gates or repairs and their PASS/FAIL status>",
    "Active blockers: <unresolved blocker, evidence, and owner for each>",
    "Next validation milestone: <next check or decision point; name its prerequisite>",
    "Owner: <person or team accountable for completion>",
    "**Independent evidence:** valid and safe gates that can continue; run each one and record its actual result.",
    "**Dependent checks:** gates waiting on a named prerequisite; record `BLOCKED` or `NOT REACHED` with that prerequisite instead of treating the check as passed.",
  ].join("\n"),
  ".agents/skills/customer-import-audit/SKILL.md": [
    "## Safety and evidence rules",
    "## Before/after checklist",
    "## Standard audit report",
    "Manager-value preservation:",
    "Never edit production data from this skill.",
    "never paste credentials, workbook contents, or personal data into reports.",
    "Return to **data-heal-playbook** when evidence shows incorrect data is already persisted.",
    "Use **Import-bug-investigation** when there is a source-versus-landed mismatch.",
  ].join("\n"),
  ".agents/skills/data-heal-playbook/SKILL.md": [
    "## Required heal plan",
    "## Standard heal report",
    "Check manager-value preservation before execution",
    "never log secrets, whole user objects, or unnecessary customer/user data.",
    "Privacy:",
    "Return to **customer-import-audit** before/after landing report.",
    "Use **import-bug-investigation** first.",
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
  const root = await mkdtemp(join(tmpdir(), "operational-skill-evidence-"));
  for (const [relativePath, content] of Object.entries(validDocuments)) {
    const overridden = Object.prototype.hasOwnProperty.call(overrides, relativePath)
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
      delete env.SKILL_EVIDENCE_ROOT;
    } else {
      env.SKILL_EVIDENCE_ROOT = root;
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
    child.on("close", (exitCode) => resolveResult({ exitCode, stdout, stderr }));
  });
}

test("passes a complete set of policy documents", async () => {
  const root = await createFixture();
  try {
    const result = await runChecker(root);
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, "Operational policy and skill evidence check passed.\n");
    assert.equal(result.stderr, "");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("passes the repository policy documents without an evidence-root override", async () => {
  const result = await runChecker();
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "Operational policy and skill evidence check passed.\n");
  assert.equal(result.stderr, "");
});

test("reports only the relative document and remediation when a rule is missing", async () => {
  const secret = "FIXTURE_POLICY_SECRET_MUST_NOT_LEAK";
  const root = await createFixture({
    "replit.md": `${secret}\nfilesystem payload: PRIVATE_FILESYSTEM_PAYLOAD\n`,
  });
  try {
    const result = await runChecker(root);
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout, "");
    assert.equal(
      result.stderr,
      [
        "Operational skill evidence check failed:",
        "- replit.md: missing scoped failure closure; keep task-scoped failures in the task and bring unrelated failures in only when they block validation or create a material risk",
        "- replit.md: missing failure status vocabulary; record every validation result as PASS, FAIL, BLOCKED, NOT REACHED, or MISSING",
        "- replit.md: missing de-duplicated out-of-scope handling; de-duplicate unrelated failures and capture a bounded Draft with evidence and a next action",
        "- replit.md: missing fail-closed evidence; never treat missing evidence as a successful validation",
        "- replit.md: missing long-running progress format; include Current objective, Completed work, Active blockers, Next validation milestone, and Owner in long-running task updates",
        "- replit.md: missing release progress lanes; separate independent evidence from dependent checks and record dependent checks as BLOCKED or NOT REACHED with their prerequisite",
        "",
      ].join("\n"),
    );
    assert.doesNotMatch(result.stderr, new RegExp(secret));
    assert.doesNotMatch(result.stderr, /filesystem payload|\/tmp\/|\/home\//);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

const progressFields = [
  "Current objective: <release outcome and assessed scope>",
  "Completed work: <closed repair domains and evidence, each with PASS/FAIL>",
  "Active blockers: <unresolved blocker, evidence, and owner for each>",
  "Next validation milestone: <next check or decision point; name its prerequisite>",
  "Owner: <person or team accountable for completion>",
];

for (const field of progressFields) {
  test(`rejects a missing progress field: ${field.split(":")[0]}`, async () => {
    const secret = `PROGRESS_FIXTURE_SECRET_${field.split(":")[0].replaceAll(" ", "_")}`;
    const document = validDocuments[".agents/skills/production-go/SKILL.md"];
    const root = await createFixture({
      ".agents/skills/production-go/SKILL.md":
        `${document.replace(field, "")}\n${secret}\n`,
    });

    try {
      const result = await runChecker(root);
      assert.equal(result.exitCode, 1);
      assert.equal(result.stdout, "");
      assert.equal(
        result.stderr,
        [
          "Operational skill evidence check failed:",
          "- .agents/skills/production-go/SKILL.md: missing long-running progress format; include Current objective, Completed work, Active blockers, Next validation milestone, and Owner in long-running task updates",
          "",
        ].join("\n"),
      );
      assert.doesNotMatch(result.stderr, new RegExp(secret));
      assert.doesNotMatch(result.stderr, /\/tmp\/|\/home\/|operational-skill-evidence-/);
      assert.doesNotMatch(result.stderr, new RegExp(field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}

const releaseLaneRules = [
  {
    name: "independent evidence",
    document: ".agents/skills/production-go/SKILL.md",
    line: "**Independent evidence:** safe gates that can continue despite another failure; run them and record their actual status.",
  },
  {
    name: "dependent checks",
    document: ".agents/skills/production-go/SKILL.md",
    line: "**Dependent checks:** gates waiting on a named prerequisite; record them as `BLOCKED` or `NOT REACHED` with that prerequisite instead of implying a pass.",
  },
  {
    name: "independent release evidence",
    document: "replit.md",
    line: "For release work, list independent evidence work separately from checks that depend on it. Continue every independent check that is valid and safe; mark a dependent check `BLOCKED` or `NOT REACHED`, name the failed prerequisite, and keep it unresolved until its evidence exists.",
  },
];

for (const rule of releaseLaneRules) {
  test(`rejects a missing release lane rule: ${rule.name}`, async () => {
    const secret = `LANE_FIXTURE_SECRET_${rule.name.replaceAll(" ", "_").toUpperCase()}`;
    const document = validDocuments[rule.document];
    const root = await createFixture({
      [rule.document]: `${document.replace(rule.line, "")}\n${secret}\n`,
    });

    try {
      const result = await runChecker(root);
      assert.equal(result.exitCode, 1);
      assert.equal(result.stdout, "");
      assert.equal(
        result.stderr,
        [
          "Operational skill evidence check failed:",
          `- ${rule.document}: missing release progress lanes; separate independent evidence from dependent checks and record dependent checks as BLOCKED or NOT REACHED with their prerequisite`,
          "",
        ].join("\n"),
      );
      assert.doesNotMatch(result.stderr, new RegExp(secret));
      assert.doesNotMatch(result.stderr, /\/tmp\/|\/home\/|operational-skill-evidence-/);
      assert.doesNotMatch(result.stderr, new RegExp(rule.line.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}

const importAuditAndHealAnchors = [
  {
    name: "import audit safety section",
    document: ".agents/skills/customer-import-audit/SKILL.md",
    removable: "## Safety and evidence rules",
    label: "safety and evidence rules",
    remediation: "restore the safety and evidence rules section",
  },
  {
    name: "import audit checklist section",
    document: ".agents/skills/customer-import-audit/SKILL.md",
    removable: "## Before/after checklist",
    label: "before/after checklist",
    remediation: "restore the before/after checklist section",
  },
  {
    name: "import audit report section",
    document: ".agents/skills/customer-import-audit/SKILL.md",
    removable: "## Standard audit report",
    label: "standard audit report",
    remediation: "restore the standard audit report section",
  },
  {
    name: "import audit manager-value preservation field",
    document: ".agents/skills/customer-import-audit/SKILL.md",
    removable: "Manager-value preservation:",
    label: "manager-value preservation report field",
    remediation: "restore the manager-value preservation report field",
  },
  {
    name: "import audit production read-only rule",
    document: ".agents/skills/customer-import-audit/SKILL.md",
    removable: "Never edit production data from this skill",
    label: "production is read-only",
    remediation: "keep production data read-only in this skill",
  },
  {
    name: "import audit privacy rule",
    document: ".agents/skills/customer-import-audit/SKILL.md",
    removable: "never paste credentials, workbook contents, or personal data into reports.",
    label: "privacy restriction against sensitive report data",
    remediation:
      "keep credentials, workbook contents, and personal data out of reports",
  },
  {
    name: "import audit data-heal handoff",
    document: ".agents/skills/customer-import-audit/SKILL.md",
    removable:
      "Return to **data-heal-playbook** when evidence shows incorrect data is already persisted.",
    label: "data-heal complementary handoff",
    remediation: "restore the data-heal handoff",
  },
  {
    name: "import audit investigation handoff",
    document: ".agents/skills/customer-import-audit/SKILL.md",
    removable:
      "Use **Import-bug-investigation** when there is a source-versus-landed mismatch.",
    label: "import investigation complementary handoff",
    remediation: "restore the import investigation handoff",
  },
  {
    name: "data heal required plan section",
    document: ".agents/skills/data-heal-playbook/SKILL.md",
    removable: "## Required heal plan",
    label: "required heal plan",
    remediation: "restore the required heal plan section",
  },
  {
    name: "data heal report section",
    document: ".agents/skills/data-heal-playbook/SKILL.md",
    removable: "## Standard heal report",
    label: "standard heal report",
    remediation: "restore the standard heal report section",
  },
  {
    name: "data heal manager-value preservation rule",
    document: ".agents/skills/data-heal-playbook/SKILL.md",
    removable: "Check manager-value preservation before execution",
    label: "manager-value preservation guidance",
    remediation: "restore manager-value preservation guidance",
  },
  {
    name: "data heal privacy rule",
    document: ".agents/skills/data-heal-playbook/SKILL.md",
    removable: "never log secrets, whole user objects, or unnecessary customer/user data.",
    label: "privacy restriction against sensitive heal data",
    remediation:
      "keep secrets, whole user objects, and unnecessary customer data out of heal logs",
  },
  {
    name: "data heal privacy report field",
    document: ".agents/skills/data-heal-playbook/SKILL.md",
    removable: "Privacy:",
    label: "privacy report field",
    remediation: "restore the privacy report field",
  },
  {
    name: "data heal import audit handoff",
    document: ".agents/skills/data-heal-playbook/SKILL.md",
    removable:
      "Return to **customer-import-audit** before/after landing report.",
    label: "customer-import-audit complementary handoff",
    remediation: "restore the customer-import-audit handoff",
  },
  {
    name: "data heal investigation handoff",
    document: ".agents/skills/data-heal-playbook/SKILL.md",
    removable: "Use **import-bug-investigation** first.",
    label: "import investigation complementary handoff",
    remediation: "restore the import investigation handoff",
  },
] as const;

for (const anchor of importAuditAndHealAnchors) {
  test(`rejects a missing ${anchor.name} anchor without leaking fixture payload`, async () => {
    const fixturePayload = `ANCHOR_FIXTURE_PAYLOAD_${anchor.name
      .replaceAll(" ", "_")
      .toUpperCase()} /tmp/private-fixture`;
    const document = validDocuments[anchor.document];
    assert.match(
      document,
      new RegExp(anchor.removable.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    );
    const root = await createFixture({
      [anchor.document]: `${document.replace(anchor.removable, "")}\n${fixturePayload}\n`,
    });

    try {
      const result = await runChecker(root);
      assert.equal(result.exitCode, 1);
      assert.equal(result.stdout, "");
      assert.equal(
        result.stderr,
        [
          "Operational skill evidence check failed:",
          `- ${anchor.document}: missing ${anchor.label}; ${anchor.remediation}`,
          "",
        ].join("\n"),
      );
      assert.doesNotMatch(
        result.stderr,
        new RegExp(fixturePayload.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
      );
      assert.doesNotMatch(
        result.stderr,
        /\/tmp\/|\/home\/|operational-skill-evidence-/,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}

test("reports a missing document without exposing filesystem payloads", async () => {
  const root = await createFixture({ "replit.md": undefined });
  try {
    const result = await runChecker(root);
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout, "");
    assert.equal(
      result.stderr,
      [
        "Operational skill evidence check failed:",
        "- replit.md: could not read the required policy document",
        "",
      ].join("\n"),
    );
    assert.doesNotMatch(result.stderr, /\/tmp\/|\/home\/|operational-skill-evidence-/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("reports an unreadable document without exposing filesystem payloads", async () => {
  const fixturePayload = "UNREADABLE_FIXTURE_PAYLOAD_MUST_NOT_LEAK";
  const policyContent = "Never claim success by treating missing evidence as a pass.";
  const root = await createFixture({
    "replit.md": `${validDocuments["replit.md"]}\n${policyContent}\n${fixturePayload}\n`,
  });
  const unreadablePath = join(root, "replit.md");
  await chmod(unreadablePath, 0o000);

  try {
    const result = await runChecker(root);
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout, "");
    assert.equal(
      result.stderr,
      [
        "Operational skill evidence check failed:",
        "- replit.md: could not read the required policy document",
        "",
      ].join("\n"),
    );
    assert.match(
      result.stderr,
      /^Operational skill evidence check failed:\n- replit\.md: could not read the required policy document\n$/,
    );
    assert.doesNotMatch(result.stderr, new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.doesNotMatch(result.stderr, /\/tmp\/|\/home\/|operational-skill-evidence-/);
    assert.doesNotMatch(result.stderr, new RegExp(fixturePayload));
    assert.doesNotMatch(result.stderr, new RegExp(policyContent));
  } finally {
    await chmod(unreadablePath, 0o600);
    await rm(root, { recursive: true, force: true });
  }
});

test("keeps multiple missing-document failures free of filesystem details", async () => {
  const fixturePayload = "MULTI_DOCUMENT_FIXTURE_PAYLOAD_MUST_NOT_LEAK";
  const policyContent = "Never claim success by treating missing evidence as a pass.";
  const root = await createFixture({
    "replit.md": undefined,
    ".agents/skills/production-go/SKILL.md": undefined,
    ".agents/skills/release-checklist/SKILL.md":
      `${validDocuments[".agents/skills/release-checklist/SKILL.md"]}\n${policyContent}\n${fixturePayload}\n`,
  });
  try {
    const result = await runChecker(root);
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout, "");
    assert.equal(
      result.stderr,
      [
        "Operational skill evidence check failed:",
        "- replit.md: could not read the required policy document",
        "- .agents/skills/production-go/SKILL.md: could not read the required policy document",
        "",
      ].join("\n"),
    );

    const reportedLines = result.stderr.trimEnd().split("\n").slice(1);
    for (const line of reportedLines) {
      assert.match(
        line,
        /^- (?:replit\.md|\.agents\/skills\/production-go\/SKILL\.md): could not read the required policy document$/,
      );
    }
    assert.doesNotMatch(result.stderr, new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.doesNotMatch(result.stderr, /\/tmp\/|\/home\/|operational-skill-evidence-/);
    assert.doesNotMatch(result.stderr, new RegExp(fixturePayload));
    assert.doesNotMatch(result.stderr, new RegExp(policyContent));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});