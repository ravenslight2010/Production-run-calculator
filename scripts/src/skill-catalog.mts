import { readdir, readFile } from "node:fs/promises";
import { basename, dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const SKILL_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const MAX_SKILL_NAME_LENGTH = 64;
export const MAX_DESCRIPTION_LENGTH = 1024;
export const MAX_EDITABLE_LINES = 500;

export type RootClassification = "editable" | "managed";

export type SkillRoot = {
  id: string;
  relativePath: string;
  classification: RootClassification;
};

export const DEFAULT_SKILL_ROOTS: SkillRoot[] = [
  { id: "agents", relativePath: ".agents/skills", classification: "editable" },
  {
    id: "custom",
    relativePath: ".local/custom_skills",
    classification: "editable",
  },
  { id: "platform", relativePath: ".local/skills", classification: "managed" },
  {
    id: "secondary",
    relativePath: ".local/secondary_skills",
    classification: "managed",
  },
];

export type DuplicateAllowlistEntry = {
  name: string;
  roots: string[];
  routeTo: string;
  reason: string;
};

export const DEFAULT_DUPLICATE_ALLOWLIST: DuplicateAllowlistEntry[] = [
  {
    name: "skill-creator",
    roots: ["agents", "secondary"],
    routeTo: "agents",
    reason: "The project-authored skill takes precedence over the managed copy.",
  },
];

export type FindingCode =
  | "frontmatter_missing"
  | "frontmatter_unclosed"
  | "frontmatter_invalid"
  | "frontmatter_duplicate_field"
  | "missing_name"
  | "invalid_name"
  | "name_directory_mismatch"
  | "name_too_long"
  | "missing_description"
  | "description_too_long"
  | "line_limit_exceeded"
  | "broken_local_reference"
  | "root_missing"
  | "duplicate_name";

export type SkillFinding = {
  code: FindingCode;
  line?: number;
};

export type SkillRecord = {
  path: string;
  rootId: string;
  rootPath: string;
  classification: RootClassification;
  name: string | null;
  descriptionPresent: boolean;
  lineCount: number;
  findings: SkillFinding[];
  status: "valid" | "invalid" | "warning";
};

export type CatalogRootReport = SkillRoot & {
  skillsFound: number;
  missing: boolean;
};

export type CatalogReport = {
  projectRoot: string;
  roots: CatalogRootReport[];
  skills: SkillRecord[];
  allowedDuplicates: DuplicateAllowlistEntry[];
  failures: number;
  warnings: number;
};

export type ScanOptions = {
  projectRoot?: string;
  roots?: SkillRoot[];
  duplicateAllowlist?: DuplicateAllowlistEntry[];
};

type Frontmatter = {
  name: string | null;
  description: string | null;
  findings: SkillFinding[];
};

function finding(code: FindingCode, line?: number): SkillFinding {
  return line === undefined ? { code } : { code, line };
}

function unquote(value: string): string {
  const trimmed = value.trim();
  if (
    trimmed.length >= 2 &&
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseFrontmatter(lines: string[]): Frontmatter {
  if (lines[0]?.trim() !== "---") {
    return {
      name: null,
      description: null,
      findings: [finding("frontmatter_missing", 1)],
    };
  }

  const closingLine = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
  if (closingLine === -1) {
    return {
      name: null,
      description: null,
      findings: [finding("frontmatter_unclosed", 1)],
    };
  }

  const findings: SkillFinding[] = [];
  const fields = new Map<string, string>();
  for (let index = 1; index < closingLine; index += 1) {
    const line = lines[index];
    if (!line.trim()) continue;
    const match = /^([A-Za-z][A-Za-z0-9_-]*):[ \t]*(.*)$/.exec(line);
    if (!match) {
      findings.push(finding("frontmatter_invalid", index + 1));
      continue;
    }
    const [, key, rawValue] = match;
    if (fields.has(key)) {
      findings.push(finding("frontmatter_duplicate_field", index + 1));
      continue;
    }
    if (rawValue === ">" || rawValue === "|") {
      const continuation: string[] = [];
      let nextIndex = index + 1;
      while (nextIndex < closingLine) {
        const continuationLine = lines[nextIndex];
        if (continuationLine.trim() && !/^[ \t]+/.test(continuationLine)) break;
        continuation.push(continuationLine.trim());
        nextIndex += 1;
      }
      fields.set(key, continuation.join(rawValue === ">" ? " " : "\n").trim());
      index = nextIndex - 1;
    } else {
      fields.set(key, unquote(rawValue));
    }
  }

  return {
    name: fields.get("name") ?? null,
    description: fields.get("description") ?? null,
    findings,
  };
}

function isExternalReference(target: string): boolean {
  return (
    target.startsWith("#") ||
    target.startsWith("/") ||
    target.startsWith("//") ||
    /^[a-z][a-z0-9+.-]*:/i.test(target)
  );
}

function isSafeLocalReference(target: string): boolean {
  return (
    target === "SKILL.md" ||
    target.startsWith("./") ||
    target.startsWith("../") ||
    target.startsWith("references/") ||
    target.startsWith("scripts/") ||
    target.startsWith("assets/")
  );
}

function localReferenceTargets(content: string): Array<{ target: string; line: number }> {
  const references: Array<{ target: string; line: number }> = [];
  const markdownLink = /\[[^\]]*]\(([^)\s]+)(?:\s+["'][^)]*["'])?\)/g;
  for (const match of content.matchAll(markdownLink)) {
    const target = match[1];
    if (!target || isExternalReference(target) || !isSafeLocalReference(target)) continue;
    const line = content.slice(0, match.index ?? 0).split(/\r?\n/).length;
    references.push({ target: target.split("#", 1)[0].split("?", 1)[0], line });
  }
  return references;
}

function isWithin(parent: string, child: string): boolean {
  const prefix = parent.endsWith("/") ? parent : `${parent}/`;
  return child === parent || child.startsWith(prefix);
}

async function readSkill(
  projectRoot: string,
  root: SkillRoot,
  skillPath: string,
): Promise<SkillRecord> {
  const relativePath = relative(projectRoot, skillPath).replaceAll("\\", "/");
  let content: string;
  try {
    content = await readFile(skillPath, "utf8");
  } catch {
    return {
      path: relativePath,
      rootId: root.id,
      rootPath: root.relativePath,
      classification: root.classification,
      name: null,
      descriptionPresent: false,
      lineCount: 0,
      findings: [finding("frontmatter_missing")],
      status: root.classification === "editable" ? "invalid" : "warning",
    };
  }

  const lines = content.split(/\r?\n/);
  if (lines.at(-1) === "") lines.pop();
  const metadata = parseFrontmatter(lines);
  const findings = [...metadata.findings];
  const name = metadata.name?.trim() || null;
  const description = metadata.description?.trim() || null;

  if (!name) findings.push(finding("missing_name"));
  else {
    if (name.length > MAX_SKILL_NAME_LENGTH) findings.push(finding("name_too_long"));
    if (!SKILL_NAME_PATTERN.test(name)) findings.push(finding("invalid_name"));
  }
  if (!description) findings.push(finding("missing_description"));
  else if (description.length > MAX_DESCRIPTION_LENGTH) findings.push(finding("description_too_long"));

  if (lines.length > MAX_EDITABLE_LINES) {
    findings.push(finding("line_limit_exceeded"));
  }

  const skillDirectory = dirname(skillPath);
  const directoryName = basename(skillDirectory);
  if (name && name !== directoryName) {
    findings.push(finding("name_directory_mismatch"));
  }
  for (const reference of localReferenceTargets(content)) {
    const targetPath = resolve(skillDirectory, reference.target);
    if (isWithin(skillDirectory, targetPath)) {
      try {
        await readFile(targetPath);
      } catch {
        findings.push(finding("broken_local_reference", reference.line));
      }
    }
  }

  const status =
    findings.length === 0
      ? "valid"
      : root.classification === "editable"
        ? "invalid"
        : "warning";
  return {
    path: relativePath,
    rootId: root.id,
    rootPath: root.relativePath,
    classification: root.classification,
    name,
    descriptionPresent: Boolean(description),
    lineCount: lines.length,
    findings,
    status,
  };
}

function allowlistMatches(
  entry: DuplicateAllowlistEntry,
  name: string,
  rootIds: string[],
): boolean {
  return (
    entry.name === name &&
    [...entry.roots].sort().join(",") === [...rootIds].sort().join(",") &&
    entry.roots.includes(entry.routeTo) &&
    Boolean(entry.reason.trim())
  );
}

export async function scanSkillCatalog(options: ScanOptions = {}): Promise<CatalogReport> {
  const projectRoot = resolve(options.projectRoot ?? resolve(import.meta.dirname, "../.."));
  const roots = options.roots ?? DEFAULT_SKILL_ROOTS;
  const duplicateAllowlist = options.duplicateAllowlist ?? DEFAULT_DUPLICATE_ALLOWLIST;
  const rootReports: CatalogRootReport[] = [];
  const skills: SkillRecord[] = [];

  for (const root of roots) {
    const rootPath = resolve(projectRoot, root.relativePath);
    let entries;
    try {
      entries = await readdir(rootPath, { withFileTypes: true });
    } catch {
      rootReports.push({ ...root, skillsFound: 0, missing: true });
      continue;
    }
    const skillDirectories = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => resolve(rootPath, entry.name))
      .sort();
    const records = await Promise.all(
      skillDirectories
        .filter((directory) => basename(directory) !== "")
        .map(async (directory) => {
          const skillPath = resolve(directory, "SKILL.md");
          try {
            await readFile(skillPath);
          } catch {
            return null;
          }
          return readSkill(projectRoot, root, skillPath);
        }),
    );
    skills.push(...records.filter((record): record is SkillRecord => record !== null));
    rootReports.push({
      ...root,
      skillsFound: records.filter(Boolean).length,
      missing: false,
    });
  }

  const allowedDuplicates: DuplicateAllowlistEntry[] = [];
  const names = new Map<string, SkillRecord[]>();
  for (const skill of skills) {
    if (!skill.name) continue;
    const group = names.get(skill.name) ?? [];
    group.push(skill);
    names.set(skill.name, group);
  }
  for (const [name, group] of names) {
    const rootIds = [...new Set(group.map((skill) => skill.rootId))];
    if (group.length < 2) continue;
    const allowlistEntry = duplicateAllowlist.find((entry) =>
      allowlistMatches(entry, name, rootIds),
    );
    if (allowlistEntry) {
      allowedDuplicates.push(allowlistEntry);
      continue;
    }
    for (const skill of group) skill.findings.push(finding("duplicate_name"));
  }

  for (const skill of skills) {
    skill.status =
      skill.findings.length === 0
        ? "valid"
        : skill.classification === "editable"
          ? "invalid"
          : "warning";
  }

  const failures =
    skills.filter((skill) => skill.classification === "editable" && skill.findings.length > 0).length;
  const warnings =
    rootReports.filter((root) => root.missing).length +
    skills.filter((skill) => skill.classification === "managed" && skill.findings.length > 0).length;

  return {
    projectRoot,
    roots: rootReports,
    skills,
    allowedDuplicates,
    failures,
    warnings,
  };
}

const FINDING_LABELS: Record<FindingCode, string> = {
  frontmatter_missing: "missing frontmatter",
  frontmatter_unclosed: "unclosed frontmatter",
  frontmatter_invalid: "invalid frontmatter",
  frontmatter_duplicate_field: "duplicate frontmatter field",
  missing_name: "missing name",
  invalid_name: "invalid name",
  name_directory_mismatch: "name must match its directory",
  name_too_long: "name too long",
  missing_description: "missing description",
  description_too_long: "description too long",
  line_limit_exceeded: `over ${MAX_EDITABLE_LINES}-line limit`,
  broken_local_reference: "broken local reference",
  root_missing: "root missing",
  duplicate_name: "duplicate name",
};

function formatSkillFindings(skill: SkillRecord): string {
  return skill.findings
    .map((item) => {
      if (item.code === "name_directory_mismatch") {
        return `name must match directory '${basename(dirname(skill.path))}'`;
      }
      return `${FINDING_LABELS[item.code]}${item.line ? ` (line ${item.line})` : ""}`;
    })
    .join(", ");
}

export function formatCatalogReport(report: CatalogReport): string {
  const lines = [
    "Skill catalog inventory",
    "=======================",
    ...report.roots.map(
      (root) =>
        `Root ${root.id}: ${root.classification} (${root.relativePath}) — ${
          root.missing ? "missing" : `${root.skillsFound} skill(s)`
        }`,
    ),
    "",
  ];
  for (const root of report.roots) {
    if (root.missing) {
      lines.push(`WARN ${root.relativePath}: root missing`);
    }
  }
  for (const skill of report.skills) {
    const status = skill.status === "valid" ? "PASS" : skill.status === "warning" ? "WARN" : "FAIL";
    const detail = skill.findings.length > 0 ? ` — ${formatSkillFindings(skill)}` : "";
    const displayName =
      skill.name && skill.name.length <= MAX_SKILL_NAME_LENGTH && SKILL_NAME_PATTERN.test(skill.name)
        ? skill.name
        : skill.name
          ? "<invalid>"
          : "<missing>";
    lines.push(
      `${status} ${skill.path} [${skill.classification}] name=${displayName} description=${
        skill.descriptionPresent ? "yes" : "no"
      } lines=${skill.lineCount}${detail}`,
    );
  }
  if (report.allowedDuplicates.length > 0) {
    lines.push("");
    for (const duplicate of report.allowedDuplicates) {
      lines.push(
        `ALLOW duplicate ${duplicate.name} [${duplicate.roots.join(
          ", ",
        )}] route=${duplicate.routeTo}: ${duplicate.reason}`,
      );
    }
  }
  lines.push(
    "",
    `Summary: ${report.skills.length} skill(s), ${report.failures} failure(s), ${report.warnings} warning(s).`,
  );
  return `${lines.join("\n")}\n`;
}

async function readAllowlist(path: string): Promise<DuplicateAllowlistEntry[]> {
  const value: unknown = JSON.parse(await readFile(path, "utf8"));
  const entries =
    value && typeof value === "object" && Array.isArray((value as { duplicateNames?: unknown }).duplicateNames)
      ? (value as { duplicateNames: unknown[] }).duplicateNames
      : null;
  if (!entries) {
    throw new Error("allowlist must contain a duplicateNames array");
  }
  if (
    !entries.every((entry) => {
      if (!entry || typeof entry !== "object") return false;
      const candidate = entry as Partial<DuplicateAllowlistEntry>;
      return (
        typeof candidate.name === "string" &&
        Array.isArray(candidate.roots) &&
        candidate.roots.every((root) => typeof root === "string") &&
        typeof candidate.routeTo === "string" &&
        typeof candidate.reason === "string"
      );
    })
  ) {
    throw new Error("allowlist contains an invalid duplicate entry");
  }
  return entries as DuplicateAllowlistEntry[];
}

const REPOSITORY_ROOT = resolve(import.meta.dirname, "../..");
const DEFAULT_ALLOWLIST_PATH = resolve(REPOSITORY_ROOT, "skill-catalog-allowlist.json");

export async function main(argv = process.argv.slice(2)): Promise<number> {
  let projectRoot: string | undefined;
  let allowlistPath: string | undefined;
  let json = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--project-root") projectRoot = argv[++index];
    else if (argument === "--allowlist") allowlistPath = argv[++index];
    else if (argument === "--json") json = true;
    else if (argument === "--help" || argument === "-h") {
      console.log(
        "Usage: check-skill-catalog [--project-root PATH] [--allowlist PATH] [--json]",
      );
      return 0;
    } else {
      console.error(`Unknown option: ${argument}`);
      return 2;
    }
  }

  const resolvedProjectRoot = resolve(projectRoot ?? REPOSITORY_ROOT);
  let duplicateAllowlist = DEFAULT_DUPLICATE_ALLOWLIST;
  const allowlistFile = allowlistPath
    ? resolve(resolvedProjectRoot, allowlistPath)
    : resolvedProjectRoot === REPOSITORY_ROOT
      ? DEFAULT_ALLOWLIST_PATH
      : resolve(resolvedProjectRoot, "skill-catalog-allowlist.json");
  try {
    duplicateAllowlist = await readAllowlist(allowlistFile);
  } catch (error) {
    if (!allowlistPath && (error as NodeJS.ErrnoException).code === "ENOENT") {
      duplicateAllowlist = [];
    } else {
      throw error;
    }
  }
  const report = await scanSkillCatalog({
    projectRoot: resolvedProjectRoot,
    duplicateAllowlist,
  });
  process.stdout.write(json ? `${JSON.stringify(report, null, 2)}\n` : formatCatalogReport(report));
  return report.failures > 0 ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLPath()) {
  main().then((code) => {
    process.exitCode = code;
  }).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Skill catalog check failed");
    process.exitCode = 2;
  });
}

function fileURLPath(): string {
  return fileURLToPath(import.meta.url);
}