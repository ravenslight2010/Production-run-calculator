import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

type Requirement = {
  label: string;
  pattern: RegExp;
  remediation: string;
};

const longRunningProgressPattern =
  /Current objective:[\s\S]*?Completed work:[\s\S]*?Active blockers:[\s\S]*?Next validation milestone:[\s\S]*?Owner:/;
const replitReleaseProgressLanesPattern =
  /For release work, list independent evidence work separately from checks that depend on it\.[\s\S]*?mark a dependent check `BLOCKED` or `NOT REACHED`, name the failed prerequisite/;
const skillReleaseProgressLanesPattern =
  /\*\*Independent evidence:\*\*[\s\S]*?\*\*Dependent checks:\*\*[\s\S]*?(?:prerequisite[\s\S]*?(?:BLOCKED|NOT REACHED)|(?:BLOCKED|NOT REACHED)[\s\S]*?prerequisite)/i;

const checks: Record<string, Requirement[]> = {
  "replit.md": [
    {
      label: "scoped failure closure",
      pattern:
        /Fix task-scoped errors immediately\.[\s\S]*?Bring an unrelated error into the current task when it blocks required validation or creates a safety, security, data-integrity, or release risk/,
      remediation:
        "keep task-scoped failures in the task and bring unrelated failures in only when they block validation or create a material risk",
    },
    {
      label: "failure status vocabulary",
      pattern:
        /Record all observed results as `PASS`, `FAIL`, `BLOCKED`, `NOT REACHED`, or `MISSING`/,
      remediation:
        "record every validation result as PASS, FAIL, BLOCKED, NOT REACHED, or MISSING",
    },
    {
      label: "de-duplicated out-of-scope handling",
      pattern:
        /otherwise de-duplicate it and capture a bounded Draft with evidence and a next action/,
      remediation:
        "de-duplicate unrelated failures and capture a bounded Draft with evidence and a next action",
    },
    {
      label: "fail-closed evidence",
      pattern:
        /Never claim success by[\s\S]*?treating missing evidence as a pass/,
      remediation: "never treat missing evidence as a successful validation",
    },
    {
      label: "long-running progress format",
      pattern: longRunningProgressPattern,
      remediation:
        "include Current objective, Completed work, Active blockers, Next validation milestone, and Owner in long-running task updates",
    },
    {
      label: "release progress lanes",
      pattern: replitReleaseProgressLanesPattern,
      remediation:
        "separate independent evidence from dependent checks and record dependent checks as BLOCKED or NOT REACHED with their prerequisite",
    },
  ],
  ".agents/skills/production-go/SKILL.md": [
    {
      label: "scoped failure closure",
      pattern:
        /do not stop the investigation at the\s+first unrelated failure[\s\S]*?it must not hide independent evidence/,
      remediation:
        "continue independent valid checks after an unrelated failure and do not hide independent evidence",
    },
    {
      label: "failure status vocabulary",
      pattern:
        /Record every result as `PASS`, `FAIL`, `BLOCKED`, `NOT REACHED`, or `MISSING`/,
      remediation:
        "record every validation result as PASS, FAIL, BLOCKED, NOT REACHED, or MISSING",
    },
    {
      label: "de-duplicated repair planning",
      pattern:
        /create the smallest de-duplicated set of\s+bounded repair tasks/,
      remediation:
        "create the smallest de-duplicated set of bounded repair tasks",
    },
    {
      label: "fail-closed evidence",
      pattern:
        /Treat `BLOCKED`, `NOT REACHED`, and `MISSING` as unresolved until the required\s+evidence exists/,
      remediation:
        "keep BLOCKED, NOT REACHED, and MISSING unresolved until required evidence exists or a documented exception applies",
    },
    {
      label: "long-running progress format",
      pattern: longRunningProgressPattern,
      remediation:
        "include Current objective, Completed work, Active blockers, Next validation milestone, and Owner in long-running task updates",
    },
    {
      label: "release progress lanes",
      pattern: skillReleaseProgressLanesPattern,
      remediation:
        "separate independent evidence from dependent checks and record dependent checks as BLOCKED or NOT REACHED with their prerequisite",
    },
  ],
  ".agents/skills/release-checklist/SKILL.md": [
    {
      label: "scoped failure closure",
      pattern:
        /Run all applicable gates that remain valid and safe to run; do not stop at the\s+first unrelated failure[\s\S]*?independent gates should still produce evidence/,
      remediation:
        "continue independent valid gates after an unrelated failure and preserve their evidence",
    },
    {
      label: "failure status vocabulary",
      pattern:
        /Record each result explicitly\s+as `PASS`, `FAIL`, `BLOCKED`, `NOT REACHED`, or `MISSING`/,
      remediation:
        "record every validation result as PASS, FAIL, BLOCKED, NOT REACHED, or MISSING",
    },
    {
      label: "de-duplicated repair planning",
      pattern:
        /de-duplicate the blocker inventory against\s+the task board and create bounded repair tasks/,
      remediation:
        "de-duplicate blockers against the task board before creating bounded repair tasks",
    },
    {
      label: "fail-closed evidence",
      pattern: /A failed command or missing evidence is a\s+\*\*no-go\*\*/,
      remediation:
        "treat failed commands and missing evidence as no-go conditions",
    },
    {
      label: "long-running progress format",
      pattern: longRunningProgressPattern,
      remediation:
        "include Current objective, Completed work, Active blockers, Next validation milestone, and Owner in long-running task updates",
    },
    {
      label: "release progress lanes",
      pattern: skillReleaseProgressLanesPattern,
      remediation:
        "separate independent evidence from dependent checks and record dependent checks as BLOCKED or NOT REACHED with their prerequisite",
    },
  ],
  ".agents/skills/customer-import-audit/SKILL.md": [
    {
      label: "safety and evidence rules",
      pattern: /^## Safety and evidence rules$/m,
      remediation: "restore the safety and evidence rules section",
    },
    {
      label: "before/after checklist",
      pattern: /^## Before\/after checklist/m,
      remediation: "restore the before/after checklist section",
    },
    {
      label: "standard audit report",
      pattern: /^## Standard audit report$/m,
      remediation: "restore the standard audit report section",
    },
    {
      label: "manager-value preservation report field",
      pattern: /Manager-value preservation:/,
      remediation: "restore the manager-value preservation report field",
    },
    {
      label: "production is read-only",
      pattern: /Never edit production\s+data from this skill/i,
      remediation: "keep production data read-only in this skill",
    },
    {
      label: "privacy restriction against sensitive report data",
      pattern: /never paste credentials[\s\S]*workbook[\s\S]*personal data/i,
      remediation:
        "keep credentials, workbook contents, and personal data out of reports",
    },
    {
      label: "data-heal complementary handoff",
      pattern:
        /data-heal-playbook[\s\S]*evidence shows incorrect data is already persisted/m,
      remediation: "restore the data-heal handoff",
    },
    {
      label: "import investigation complementary handoff",
      pattern: /Import-bug-investigation[\s\S]*source-versus-landed mismatch/m,
      remediation: "restore the import investigation handoff",
    },
  ],
  ".agents/skills/data-heal-playbook/SKILL.md": [
    {
      label: "required heal plan",
      pattern: /^## Required heal plan$/m,
      remediation: "restore the required heal plan section",
    },
    {
      label: "standard heal report",
      pattern: /^## Standard heal report$/m,
      remediation: "restore the standard heal report section",
    },
    {
      label: "manager-value preservation guidance",
      pattern: /Check manager-value preservation before execution/m,
      remediation: "restore manager-value preservation guidance",
    },
    {
      label: "privacy restriction against sensitive heal data",
      pattern:
        /never log secrets,[\s\S]*whole user objects,[\s\S]*unnecessary customer\/user data/i,
      remediation:
        "keep secrets, whole user objects, and unnecessary customer data out of heal logs",
    },
    {
      label: "privacy report field",
      pattern: /^Privacy:/m,
      remediation: "restore the privacy report field",
    },
    {
      label: "customer-import-audit complementary handoff",
      pattern:
        /Return to \*\*customer-import-audit\*\*[\s\S]*before\/after landing report/m,
      remediation: "restore the customer-import-audit handoff",
    },
    {
      label: "import investigation complementary handoff",
      pattern: /Use \*\*import-bug-investigation\*\* first/m,
      remediation: "restore the import investigation handoff",
    },
  ],
};

const root = resolve(
  process.env.SKILL_EVIDENCE_ROOT ?? resolve(import.meta.dirname, "../.."),
);
const failures: string[] = [];

for (const [relativePath, requirements] of Object.entries(checks)) {
  const path = resolve(root, relativePath);
  let content: string;

  try {
    content = await readFile(path, "utf8");
  } catch {
    failures.push(
      `${relativePath}: could not read the required policy document`,
    );
    continue;
  }

  for (const requirement of requirements) {
    if (!requirement.pattern.test(content)) {
      failures.push(
        `${relativePath}: missing ${requirement.label}; ${requirement.remediation}`,
      );
    }
  }
}

if (failures.length > 0) {
  console.error("Operational skill evidence check failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log("Operational policy and skill evidence check passed.");
}
