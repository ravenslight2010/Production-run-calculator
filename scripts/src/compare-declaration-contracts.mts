import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import ts from "@workspace/typescript-api-v6";

type Category = "api-client-react" | "api-zod" | "db" | "other";

type Approval = {
  path: string;
  baselineSha256: string | null;
  candidateSha256: string | null;
  reason: string;
};

type FileResult = {
  path: string;
  category: Category;
  baselineSha256: string | null;
  candidateSha256: string | null;
  classification: "added" | "removed" | "formatting-only" | "approved-semantic" | "semantic";
  approvalReason?: string;
};

const usage =
  "Usage: compare-declaration-contracts <baseline-tree> <candidate-tree> <report-directory> [--approvals <json>]";
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function fail(message: string): never {
  throw new Error(message);
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function isInside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function canonicalize(target: string): string {
  let existing = path.resolve(target);
  const missing: string[] = [];
  while (!fs.existsSync(existing)) {
    const parent = path.dirname(existing);
    if (parent === existing) fail(`Cannot resolve path: ${target}`);
    missing.unshift(path.basename(existing));
    existing = parent;
  }
  return path.join(fs.realpathSync(existing), ...missing);
}

function assertDisposable(target: string, label: string): string {
  const resolved = canonicalize(target);
  const canonicalRepository = fs.realpathSync(repositoryRoot);
  if (isInside(canonicalRepository, resolved)) {
    fail(`${label} must be a disposable path outside the repository: ${resolved}`);
  }
  return resolved;
}

function assertSeparateRoots(roots: Array<[string, string]>): void {
  for (let index = 0; index < roots.length; index += 1) {
    for (let other = index + 1; other < roots.length; other += 1) {
      const [firstLabel, first] = roots[index];
      const [secondLabel, second] = roots[other];
      if (isInside(first, second) || isInside(second, first)) {
        fail(`${firstLabel} and ${secondLabel} must not overlap.`);
      }
    }
  }
}

function listDeclarations(root: string): Map<string, string> {
  if (!fs.statSync(root, { throwIfNoEntry: false })?.isDirectory()) {
    fail(`Declaration tree does not exist: ${root}`);
  }
  const files = new Map<string, string>();
  const visit = (directory: string) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(absolute);
      } else if (entry.isFile() && /\.d\.(?:ts|mts|cts)$/.test(entry.name)) {
        files.set(path.relative(root, absolute).split(path.sep).join("/"), fs.readFileSync(absolute, "utf8"));
      }
    }
  };
  visit(root);
  return files;
}

function normalizeFormatting(source: string): string {
  const normalized = source.replace(/\r\n?/g, "\n");
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, ts.LanguageVariant.Standard, normalized);
  let result = "";
  let offset = 0;
  for (let token = scanner.scan(); token !== ts.SyntaxKind.EndOfFileToken; token = scanner.scan()) {
    const start = scanner.getTokenPos();
    const end = scanner.getTextPos();
    result += normalized.slice(offset, start);
    if (token === ts.SyntaxKind.StringLiteral || token === ts.SyntaxKind.NoSubstitutionTemplateLiteral) {
      result += JSON.stringify(scanner.getTokenValue());
    } else {
      result += normalized.slice(start, end);
    }
    offset = end;
  }
  return `${result}${normalized.slice(offset)}`.trimEnd() + "\n";
}

function categoryFor(file: string): Category {
  if (file.startsWith("lib/api-client-react/")) return "api-client-react";
  if (file.startsWith("lib/api-zod/")) return "api-zod";
  if (file.startsWith("lib/db/")) return "db";
  return "other";
}

function loadApprovals(file: string | undefined): Map<string, Approval> {
  if (!file) return new Map();
  const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as { schemaVersion?: unknown; approvals?: unknown };
  if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.approvals)) {
    fail("Approval file must contain schemaVersion 1 and an approvals array.");
  }
  const approvals = new Map<string, Approval>();
  for (const value of parsed.approvals) {
    const approval = value as Partial<Approval>;
    if (
      typeof approval.path !== "string" ||
      (approval.baselineSha256 !== null && typeof approval.baselineSha256 !== "string") ||
      (approval.candidateSha256 !== null && typeof approval.candidateSha256 !== "string") ||
      (approval.baselineSha256 === null && approval.candidateSha256 === null) ||
      typeof approval.reason !== "string" ||
      approval.reason.trim() === ""
    ) {
      fail("Every semantic approval must pin a path, both SHA-256 values, and a non-empty reason.");
    }
    if (approvals.has(approval.path)) fail(`Duplicate semantic approval: ${approval.path}`);
    approvals.set(approval.path, approval as Approval);
  }
  return approvals;
}

function main(): void {
  const args = process.argv.slice(2);
  if (args.length !== 3 && !(args.length === 5 && args[3] === "--approvals")) fail(usage);

  const baselineRoot = assertDisposable(args[0], "Baseline tree");
  const candidateRoot = assertDisposable(args[1], "Candidate tree");
  const reportRoot = assertDisposable(args[2], "Report directory");
  assertSeparateRoots([
    ["Baseline tree", baselineRoot],
    ["Candidate tree", candidateRoot],
    ["Report directory", reportRoot],
  ]);
  const approvals = loadApprovals(args[4]);
  const consumedApprovals = new Set<string>();
  const baseline = listDeclarations(baselineRoot);
  const candidate = listDeclarations(candidateRoot);
  const paths = [...new Set([...baseline.keys(), ...candidate.keys()])].sort();
  const files: FileResult[] = [];

  for (const file of paths) {
    const before = baseline.get(file);
    const after = candidate.get(file);
    if (before === after) continue;
    const baselineSha256 = before === undefined ? null : sha256(before);
    const candidateSha256 = after === undefined ? null : sha256(after);
    const common = { path: file, category: categoryFor(file), baselineSha256, candidateSha256 };
    if (before !== undefined && after !== undefined && normalizeFormatting(before) === normalizeFormatting(after)) {
      files.push({ ...common, classification: "formatting-only" });
    } else {
      const approval = approvals.get(file);
      if (
        approval?.baselineSha256 === baselineSha256 &&
        approval.candidateSha256 === candidateSha256
      ) {
        consumedApprovals.add(file);
        files.push({ ...common, classification: "approved-semantic", approvalReason: approval.reason });
      } else if (before === undefined) {
        files.push({ ...common, classification: "added" });
      } else if (after === undefined) {
        files.push({ ...common, classification: "removed" });
      } else {
        files.push({ ...common, classification: "semantic" });
      }
    }
  }
  const unusedApprovals = [...approvals.keys()].filter((file) => !consumedApprovals.has(file));
  if (unusedApprovals.length > 0) {
    fail(`Unused or stale semantic approval(s): ${unusedApprovals.join(", ")}`);
  }

  const categories = (["api-client-react", "api-zod", "db", "other"] as const).map((category) => {
    const categoryFiles = files.filter((file) => file.category === category);
    const count = (classification: FileResult["classification"]) =>
      categoryFiles.filter((file) => file.classification === classification).length;
    return {
      category,
      changed: categoryFiles.length,
      formattingOnly: count("formatting-only"),
      approvedSemantic: count("approved-semantic"),
      unexplainedSemantic: count("semantic") + count("added") + count("removed"),
    };
  });
  const unexplained = files.filter((file) =>
    ["semantic", "added", "removed"].includes(file.classification),
  );
  const report = {
    schemaVersion: 1,
    baselineFileCount: baseline.size,
    candidateFileCount: candidate.size,
    status: unexplained.length === 0 ? "pass" : "fail",
    categories,
    files,
  };

  fs.rmSync(reportRoot, { recursive: true, force: true });
  fs.mkdirSync(reportRoot, { recursive: true });
  fs.writeFileSync(path.join(reportRoot, "declaration-contracts.json"), `${JSON.stringify(report, null, 2)}\n`);
  const lines = [
    "# Declaration contract comparison",
    "",
    `Status: **${report.status.toUpperCase()}**`,
    "",
    "| Category | Changed | Formatting only | Approved semantic | Unexplained semantic |",
    "| --- | ---: | ---: | ---: | ---: |",
    ...categories.map(
      (item) =>
        `| ${item.category} | ${item.changed} | ${item.formattingOnly} | ${item.approvedSemantic} | ${item.unexplainedSemantic} |`,
    ),
    "",
    ...files.map(
      (file) =>
        `- \`${file.path}\`: ${file.classification}${file.approvalReason ? ` — ${file.approvalReason}` : ""}`,
    ),
    "",
  ];
  fs.writeFileSync(path.join(reportRoot, "declaration-contracts.md"), lines.join("\n"));
  process.stdout.write(`${lines.slice(0, 9).join("\n")}\n`);
  if (unexplained.length > 0) {
    fail(`${unexplained.length} unexplained semantic declaration change(s) block compiler promotion.`);
  }
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}