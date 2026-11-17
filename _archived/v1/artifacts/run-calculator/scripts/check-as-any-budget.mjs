import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "@workspace/typescript-api-v6";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(scriptDir, "..");
const sourceRoot = path.join(packageRoot, "src");
const baselinePath = path.join(scriptDir, "as-any-budget-baseline.json");

const EXCLUDED_DIRECTORY_NAMES = new Set([
  "__fixtures__",
  "__generated__",
  "__tests__",
  "build",
  "dist",
  "fixtures",
  "generated",
  "test",
  "tests",
]);
const TEST_FILE_PATTERN = /\.(?:test|spec)\.[cm]?[jt]sx?$/i;
const GENERATED_FILE_PATTERN = /\.(?:generated|gen)\.[cm]?[jt]sx?$/i;

function normalizePath(value) {
  return value.replaceAll("\\", "/");
}

function isMaintainedSource(relativePath) {
  const normalized = normalizePath(relativePath);
  const segments = normalized.split("/");
  const fileName = segments.at(-1) ?? "";
  return (
    /\.(?:ts|tsx)$/i.test(fileName) &&
    !segments.some((segment) =>
      EXCLUDED_DIRECTORY_NAMES.has(segment.toLowerCase()),
    ) &&
    !TEST_FILE_PATTERN.test(fileName) &&
    !GENERATED_FILE_PATTERN.test(fileName)
  );
}

export function collectMaintainedSourceFiles(root) {
  const files = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolutePath = path.join(directory, entry.name);
      const relativePath = normalizePath(path.relative(root, absolutePath));
      if (entry.isDirectory()) {
        if (!EXCLUDED_DIRECTORY_NAMES.has(entry.name.toLowerCase())) {
          visit(absolutePath);
        }
      } else if (entry.isFile() && isMaintainedSource(relativePath)) {
        files.push({ absolutePath, relativePath });
      }
    }
  };
  visit(root);
  return files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

export function scanAsAnyCasts(source, fileName = "source.ts") {
  const scriptKind = fileName.endsWith(".tsx")
    ? ts.ScriptKind.TSX
    : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKind,
  );
  if (sourceFile.parseDiagnostics.length > 0) {
    const diagnostic = sourceFile.parseDiagnostics[0];
    const location =
      diagnostic.start === undefined
        ? ""
        : ` at ${sourceFile.getLineAndCharacterOfPosition(diagnostic.start).line + 1}:${
            sourceFile.getLineAndCharacterOfPosition(diagnostic.start).character + 1
          }`;
    throw new Error(
      `Unable to parse maintained source "${fileName}"${location}: ${ts.flattenDiagnosticMessageText(
        diagnostic.messageText,
        "\n",
      )}`,
    );
  }

  const locations = [];
  const visit = (node) => {
    if (
      ts.isAsExpression(node) &&
      node.type.kind === ts.SyntaxKind.AnyKeyword
    ) {
      const position = sourceFile.getLineAndCharacterOfPosition(
        node.type.getStart(sourceFile),
      );
      locations.push({
        line: position.line + 1,
        column: position.character + 1,
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return locations;
}

function loadBaseline(filePath) {
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new Error(
      `Unable to read as-any baseline at ${filePath}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  if (
    parsed?.version !== 1 ||
    !Number.isSafeInteger(parsed.total) ||
    parsed.total < 0 ||
    !parsed.files ||
    typeof parsed.files !== "object" ||
    Array.isArray(parsed.files)
  ) {
    throw new Error(`Invalid as-any baseline format at ${filePath}.`);
  }
  const calculatedTotal = Object.values(parsed.files).reduce((total, count) => {
    if (!Number.isSafeInteger(count) || count < 0) {
      throw new Error(`Invalid per-file cast count in ${filePath}.`);
    }
    return total + count;
  }, 0);
  if (calculatedTotal !== parsed.total) {
    throw new Error(
      `Invalid as-any baseline total in ${filePath}: recorded ${parsed.total}, file counts sum to ${calculatedTotal}.`,
    );
  }
  return parsed;
}

export function createAsAnyBaseline(files) {
  const counts = {};
  for (const file of files) {
    const source = fs.readFileSync(file.absolutePath, "utf8");
    const locations = scanAsAnyCasts(source, file.relativePath);
    if (locations.length > 0) counts[file.relativePath] = locations.length;
  }
  return {
    version: 1,
    total: Object.values(counts).reduce((sum, count) => sum + count, 0),
    files: counts,
  };
}

export function checkAsAnyBudget({ files, baseline }) {
  const violations = [];
  for (const file of files) {
    const locations = scanAsAnyCasts(
      fs.readFileSync(file.absolutePath, "utf8"),
      file.relativePath,
    );
    const reviewedCount = baseline.files[file.relativePath] ?? 0;
    if (locations.length > reviewedCount) {
      violations.push({
        file: file.relativePath,
        reviewedCount,
        actualCount: locations.length,
        locations,
      });
    }
  }
  if (violations.length > 0) {
    const details = violations.flatMap((violation) =>
      violation.locations.map(
        ({ line, column }) =>
          `- ${violation.file}:${line}:${column}: \`as any\` found; file has ${violation.actualCount}, reviewed baseline is ${violation.reviewedCount}.`,
      ),
    );
    throw new Error(
      [
        `Calculator source contains new \`as any\` casts (reviewed baseline: ${baseline.total}).`,
        ...details,
        "Remove the new cast or review the intentional baseline change in scripts/as-any-budget-baseline.json.",
      ].join("\n"),
    );
  }
  return {
    reviewedBaseline: baseline.total,
    maintainedSourceFiles: files.length,
  };
}

function writeBaseline() {
  const files = collectMaintainedSourceFiles(sourceRoot);
  const baseline = createAsAnyBaseline(files);
  fs.writeFileSync(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`);
  console.log(
    `Wrote reviewed-candidate as-any baseline: ${baseline.total} casts across ${Object.keys(baseline.files).length} files.`,
  );
}

function runCheck() {
  const baseline = loadBaseline(baselinePath);
  const result = checkAsAnyBudget({
    files: collectMaintainedSourceFiles(sourceRoot),
    baseline,
  });
  console.log(
    `Calculator as-any budget OK: ${result.reviewedBaseline} reviewed legacy casts; ${result.maintainedSourceFiles} maintained source files scanned.`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.includes("--write-baseline")) writeBaseline();
    else runCheck();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
