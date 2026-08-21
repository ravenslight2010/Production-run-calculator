import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

type Requirement = {
  label: string;
  pattern: RegExp;
};

const checks: Record<string, Requirement[]> = {
  ".agents/skills/customer-import-audit/SKILL.md": [
    { label: "safety and evidence rules", pattern: /^## Safety and evidence rules$/m },
    { label: "before/after checklist", pattern: /^## Before\/after checklist/m },
    { label: "standard audit report", pattern: /^## Standard audit report$/m },
    { label: "manager-value preservation report field", pattern: /Manager-value preservation:/ },
    { label: "production is read-only", pattern: /Never edit production\s+data from this skill/i },
    { label: "privacy restriction against sensitive report data", pattern: /never paste credentials[\s\S]*workbook[\s\S]*personal data/i },
    { label: "data-heal complementary handoff", pattern: /data-heal-playbook[\s\S]*evidence shows incorrect data is already persisted/m },
    { label: "import investigation complementary handoff", pattern: /Import-bug-investigation[\s\S]*source-versus-landed mismatch/m },
  ],
  ".agents/skills/data-heal-playbook/SKILL.md": [
    { label: "required heal plan", pattern: /^## Required heal plan$/m },
    { label: "standard heal report", pattern: /^## Standard heal report$/m },
    { label: "manager-value preservation guidance", pattern: /Check manager-value preservation before execution/m },
    { label: "privacy restriction against sensitive heal data", pattern: /never log secrets,[\s\S]*whole user objects,[\s\S]*unnecessary customer\/user data/i },
    { label: "privacy report field", pattern: /^Privacy:/m },
    { label: "customer-import-audit complementary handoff", pattern: /Return to \*\*customer-import-audit\*\*[\s\S]*before\/after landing report/m },
    { label: "import investigation complementary handoff", pattern: /Use \*\*import-bug-investigation\*\* first/m },
  ],
};

const root = resolve(process.env.SKILL_EVIDENCE_ROOT ?? resolve(import.meta.dirname, "../.."));
const failures: string[] = [];

for (const [relativePath, requirements] of Object.entries(checks)) {
  const path = resolve(root, relativePath);
  let content: string;

  try {
    content = await readFile(path, "utf8");
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    failures.push(`${relativePath}: could not read file (${reason})`);
    continue;
  }

  for (const requirement of requirements) {
    if (!requirement.pattern.test(content)) {
      failures.push(`${relativePath}: missing ${requirement.label}`);
    }
  }
}

if (failures.length > 0) {
  console.error("Operational skill evidence check failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log("Operational skill evidence check passed for both audit and heal playbooks.");
}