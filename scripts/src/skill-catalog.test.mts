import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import test from "node:test";

import {
  formatCatalogReport,
  main,
  scanSkillCatalog,
  type DuplicateAllowlistEntry,
  type SkillRoot,
} from "./skill-catalog.mts";

const roots: SkillRoot[] = [
  { id: "agents", relativePath: ".agents/skills", classification: "editable" },
  { id: "custom", relativePath: ".local/custom_skills", classification: "editable" },
  { id: "platform", relativePath: ".local/skills", classification: "managed" },
  { id: "secondary", relativePath: ".local/secondary_skills", classification: "managed" },
];

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "skill-catalog-"));
  for (const skillRoot of roots) await mkdir(join(root, skillRoot.relativePath), { recursive: true });
  return root;
}

async function addSkill(
  root: string,
  skillRoot: string,
  name: string,
  body = "# Instructions\n\nKeep it useful.\n",
  metadata = `name: ${name}\ndescription: A useful fixture skill.`,
) {
  const directory = join(root, skillRoot, name || "fixture");
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "SKILL.md"), `---\n${metadata}\n---\n${body}`);
}

test("accepts valid metadata and reports inventory fields", async () => {
  const root = await fixture();
  await addSkill(root, ".agents/skills", "valid-skill");
  const report = await scanSkillCatalog({ projectRoot: root, roots });
  const skill = report.skills.find((item) => item.name === "valid-skill");
  assert.equal(report.failures, 0);
  assert.equal(skill?.classification, "editable");
  assert.equal(skill?.descriptionPresent, true);
  assert.equal(skill?.status, "valid");
  assert.equal(skill?.lineCount, 7);
});

test("rejects malformed metadata, invalid names, and overlong editable bodies", async () => {
  const root = await fixture();
  await addSkill(root, ".agents/skills", "bad", "body\n", "description: missing the name");
  await addSkill(root, ".local/custom_skills", "bad-name", "body\n", "name: Not Valid\ndescription: present");
  await addSkill(root, ".agents/skills", "long-skill", `${"line\n".repeat(501)}`);
  const report = await scanSkillCatalog({ projectRoot: root, roots });
  const codes = report.skills.flatMap((skill) => skill.findings.map((item) => item.code));
  assert.ok(codes.includes("missing_name"));
  assert.ok(codes.includes("invalid_name"));
  assert.ok(codes.includes("line_limit_exceeded"));
  assert.ok(report.failures >= 3);
});

test("finds broken local markdown targets but ignores external links", async () => {
  const root = await fixture();
  await addSkill(
    root,
    ".agents/skills",
    "reference-skill",
    "[missing](references/missing.md)\n[external](https://example.com/missing)\n",
  );
  const report = await scanSkillCatalog({ projectRoot: root, roots });
  const skill = report.skills.find((item) => item.name === "reference-skill");
  assert.deepEqual(skill?.findings.map((item) => item.code), ["broken_local_reference"]);
});

test("allows an intentional duplicate only with an explicit routing record", async () => {
  const root = await fixture();
  await addSkill(root, ".agents/skills", "shared-skill");
  await addSkill(root, ".local/secondary_skills", "shared-skill");
  const withoutAllowlist = await scanSkillCatalog({ projectRoot: root, roots, duplicateAllowlist: [] });
  assert.equal(withoutAllowlist.failures, 1);
  assert.equal(withoutAllowlist.warnings, 1);
  assert.ok(withoutAllowlist.skills.every((skill) => skill.findings.some((item) => item.code === "duplicate_name")));

  const allowlist: DuplicateAllowlistEntry[] = [{
    name: "shared-skill",
    roots: ["agents", "secondary"],
    routeTo: "agents",
    reason: "Fixture intentionally tests routing.",
  }];
  const withAllowlist = await scanSkillCatalog({ projectRoot: root, roots, duplicateAllowlist: allowlist });
  assert.equal(withAllowlist.failures, 0);
  assert.equal(withAllowlist.allowedDuplicates.length, 1);
});

test("managed findings warn without blocking and output excludes metadata payloads", async () => {
  const root = await fixture();
  await addSkill(root, ".local/skills", "managed-bad", "body\n", "name: Managed Bad\ndescription: private fixture payload");
  const report = await scanSkillCatalog({ projectRoot: root, roots });
  assert.equal(report.failures, 0);
  assert.equal(report.warnings, 1);
  const output = formatCatalogReport(report);
  assert.match(output, /WARN .*\.local\/skills\/managed-bad/);
  assert.doesNotMatch(output, /private fixture payload/);
  assert.ok(output.length < 2000);
});

test("CLI accepts an isolated fixture project root without provider credentials", async () => {
  const root = await fixture();
  await addSkill(root, ".agents/skills", "cli-skill");
  assert.equal(await main(["--project-root", root, "--json"]), 0);
});

test("missing roots warn so platform-injected roots remain optional in CI", async () => {
  const root = await mkdtemp(join(tmpdir(), "skill-catalog-missing-"));
  const report = await scanSkillCatalog({ projectRoot: root, roots });
  assert.equal(report.failures, 0);
  assert.equal(report.warnings, 4);
  assert.match(formatCatalogReport(report), /warning\(s\)/);
});