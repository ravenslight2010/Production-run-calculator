#!/usr/bin/env bash
set -euo pipefail

# Reproduce the TypeScript 6/7 CLI comparison without writing candidate output
# into the authoritative workspace.

REPO="$(git rev-parse --show-toplevel)"
REPO="$(realpath -e "$REPO")"
RETAINED_CONTRACT_REPORT="$REPO/docs/evidence/typescript-7-declaration-contracts-current.json"

comparison_source_tar() {
  local source_root="$1"
  tar \
    --sort=name \
    --mtime='@0' \
    --owner=0 \
    --group=0 \
    --numeric-owner \
    --exclude='./node_modules' \
    --exclude='*/dist' \
    --exclude='*/build' \
    --exclude='*/test-results' \
    --exclude='*/playwright-report' \
    --exclude='*/screenshots' \
    --exclude='*/attached_assets' \
    -C "$source_root" -cf - \
    package.json \
    pnpm-lock.yaml \
    pnpm-workspace.yaml \
    tsconfig.json \
    tsconfig.base.json \
    lib \
    artifacts \
    scripts \
    docs/evidence/reproduce-typescript-7-comparison.sh \
    docs/evidence/typescript-7-declaration-approvals.json
}

comparison_source_sha256() {
  comparison_source_tar "$1" | sha256sum | awk '{print $1}'
}

check_documented_declaration_counts() {
  local summary_path="$1"
  node - \
    "$summary_path" \
    "$REPO/docs/typescript-7-migration-research.md" <<'NODE'
const fs = require("node:fs");

const summaryPath = process.argv[2];
const documentPath = process.argv[3];
const summary = JSON.parse(fs.readFileSync(summaryPath, "utf8"));
const document = fs.readFileSync(documentPath, "utf8");
const categoryCount = (paths, segment) =>
  paths.filter((file) => file.includes(`lib/${segment}/`)).length;
const declarations =
  Array.isArray(summary.declarations?.baseline) &&
  Array.isArray(summary.declarations?.candidate) &&
  Array.isArray(summary.declarations?.changedPaths)
    ? {
        baselineFileCount: summary.declarations.baseline.length,
        candidateFileCount: summary.declarations.candidate.length,
        textuallyChangedFileCount: summary.declarations.changedPaths.length,
        changedFilesByPackage: {
          "api-client-react": categoryCount(
            summary.declarations.changedPaths,
            "api-client-react",
          ),
          "api-zod": categoryCount(summary.declarations.changedPaths, "api-zod"),
          db: categoryCount(summary.declarations.changedPaths, "db"),
          other:
            summary.declarations.changedPaths.length -
            categoryCount(summary.declarations.changedPaths, "api-client-react") -
            categoryCount(summary.declarations.changedPaths, "api-zod") -
            categoryCount(summary.declarations.changedPaths, "db"),
        },
      }
    : summary.declarations;

if (!declarations || !declarations.changedFilesByPackage) {
  throw new Error(`Declaration totals are missing from ${summaryPath}`);
}

const expected = {
  baselineFileCount: declarations.baselineFileCount,
  candidateFileCount: declarations.candidateFileCount,
  textuallyChangedFileCount: declarations.textuallyChangedFileCount,
  apiClientReact: declarations.changedFilesByPackage["api-client-react"],
  apiZod: declarations.changedFilesByPackage["api-zod"],
  db: declarations.changedFilesByPackage.db,
  other: declarations.changedFilesByPackage.other,
};
for (const [name, value] of Object.entries(expected)) {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`Invalid declaration total ${name}=${JSON.stringify(value)} in ${summaryPath}`);
  }
}

const categoryTotal =
  expected.apiClientReact + expected.apiZod + expected.db + expected.other;
if (categoryTotal !== expected.textuallyChangedFileCount) {
  throw new Error(
    `Declaration categories total ${categoryTotal}, but textuallyChangedFileCount is ` +
      `${expected.textuallyChangedFileCount} in ${summaryPath}`,
  );
}

const requiredLines = [
  `| Declaration file count | ${expected.baselineFileCount} | ${expected.candidateFileCount} |`,
  `| Declaration files with textual differences | baseline | ${expected.textuallyChangedFileCount} |`,
  `- ${expected.apiClientReact} \`api-client-react\` generated declarations,`,
  `- ${expected.apiZod} \`api-zod\` generated declarations, and`,
  `- ${expected.db} database schema declarations.`,
];
if (expected.other !== 0) {
  requiredLines.push(`- ${expected.other} other declarations.`);
}

const missing = requiredLines.filter((line) => !document.includes(line));
if (missing.length > 0) {
  throw new Error(
    `TypeScript migration evidence in ${documentPath} does not match ${summaryPath}.\n` +
      `Expected documentation lines:\n${missing.map((line) => `  ${line}`).join("\n")}`,
  );
}

console.log(`TypeScript migration declaration counts match ${summaryPath}`);
NODE
}

check_current_summary() {
  local summary_path="$1"
  local contract_report_path="${2:-$RETAINED_CONTRACT_REPORT}"
  local output_dir
  output_dir="$(dirname "$summary_path")"
  "$REPO/scripts/node_modules/.bin/tsx" \
    "$REPO/scripts/src/typescript-declaration-contract-evidence.mts" \
    verify "$summary_path" "$contract_report_path"
  node - \
    "$summary_path" \
    "$output_dir" \
    "$contract_report_path" \
    "$(git -C "$REPO" rev-parse HEAD)" \
    "$(comparison_source_sha256 "$REPO")" <<'NODE'
const fs = require("node:fs");
const path = require("node:path");

const summaryPath = process.argv[2];
const output = process.argv[3];
const reportPath = process.argv[4];
const currentRevision = process.argv[5];
const currentSourceSha256 = process.argv[6];
const summary = JSON.parse(fs.readFileSync(summaryPath, "utf8"));
const readJson = (name) =>
  JSON.parse(fs.readFileSync(path.join(output, name), "utf8"));
const readText = (name) => fs.readFileSync(path.join(output, name), "utf8").trim();
const countFiles = (directory) => {
  let count = 0;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) count += countFiles(entryPath);
    else if (entry.isFile()) count += 1;
  }
  return count;
};
const changedPaths = fs
  .readFileSync(path.join(output, "declarations.diff"), "utf8")
  .split(/\r?\n/)
  .filter((line) => line.startsWith("diff -ruN "))
  .map((line) => line.split(" ")[2]);
const categoryCount = (segment) =>
  changedPaths.filter((file) => file.includes(`/lib/${segment}/`)).length;
const retained = fs.existsSync(reportPath)
  ? JSON.parse(fs.readFileSync(reportPath, "utf8"))
  : null;
const contractReport = retained?.declarationContract ?? null;
const unexplainedSemanticChanges = contractReport
  ? contractReport.classificationTotals.unexplainedSemantic
  : null;
const approvedSemanticChanges = contractReport
  ? contractReport.classificationTotals.approvedSemantic
  : null;
const formattingOnlyChanges = contractReport
  ? contractReport.classificationTotals.formattingOnly
  : null;

const errors = [];
if (summary.schemaVersion !== 1) errors.push("unsupported summary schema");
if (
  typeof summary.capturedAt !== "string" ||
  Number.isNaN(Date.parse(summary.capturedAt))
) {
  errors.push("missing or invalid capture timestamp");
}
if (summary.sourceIdentity?.revision !== currentRevision) {
  errors.push(
    `source revision ${JSON.stringify(summary.sourceIdentity?.revision)} does not match current ${currentRevision}`,
  );
}
if (summary.sourceIdentity?.bundleSha256 !== currentSourceSha256) {
  errors.push("source bundle hash does not match the current comparison inputs");
}
if (
  summary.compilers?.baseline !== "Version 6.0.3" ||
  summary.compilers?.candidate !== "Version 7.0.2"
) {
  errors.push("compiler versions do not match the required TypeScript 6/7 pair");
}

const declarations = summary.declarations;
const expected = {
  baselineFileCount: countFiles(path.join(output, "typescript-6-declarations")),
  candidateFileCount: countFiles(path.join(output, "typescript-7-declarations")),
  textuallyChangedFileCount: changedPaths.length,
  "api-client-react": categoryCount("api-client-react"),
  "api-zod": categoryCount("api-zod"),
  db: categoryCount("db"),
  other:
    changedPaths.length -
    categoryCount("api-client-react") -
    categoryCount("api-zod") -
    categoryCount("db"),
};
for (const [name, value] of Object.entries(expected)) {
  const actual =
    name === "api-client-react" || name === "api-zod" || name === "db" || name === "other"
      ? declarations?.changedFilesByPackage?.[name]
      : declarations?.[name];
  if (actual !== value) {
    errors.push(`declaration ${name}=${JSON.stringify(actual)}; expected ${value}`);
  }
}
if (
  Object.values(expected).slice(3).reduce((total, count) => total + count, 0) !==
  expected.textuallyChangedFileCount
) {
  errors.push("per-package declaration counts do not sum to the changed-file total");
}

if (
  !contractReport ||
  declarations?.contractComparison?.status !== contractReport.status ||
  declarations.contractComparison?.approvedSemanticChanges !== approvedSemanticChanges ||
  declarations.contractComparison?.formattingOnlyChanges !== formattingOnlyChanges ||
  declarations.contractComparison?.changedFiles !== contractReport.classificationTotals.changedFiles ||
  declarations.contractComparison?.unexplainedSemanticChanges !==
    unexplainedSemanticChanges ||
  contractReport.status !== "pass" ||
  unexplainedSemanticChanges !== 0 ||
  Number(readText("declaration-contract-comparison.exit-code")) !== 0
) {
  errors.push(
    `declaration contract is not a clean pass (status=${JSON.stringify(contractReport?.status)}, ` +
      `unexplainedSemanticChanges=${JSON.stringify(unexplainedSemanticChanges)})`,
  );
}

if (errors.length > 0) {
  throw new Error(
    `Current TypeScript comparison summary ${summaryPath} failed validation:\n` +
      errors.map((error) => `  - ${error}`).join("\n"),
  );
}
console.log(
  `Current TypeScript comparison summary validated against ${currentRevision} ` +
    `(${currentSourceSha256})`,
);
NODE
}

if [[ "${1:-}" == "--source-bundle-sha256" ]]; then
  comparison_source_sha256 "$REPO"
  exit 0
fi

if [[ "${1:-}" == "--check-retained-summary" ]]; then
  SUMMARY_PATH="${2:-$REPO/docs/evidence/typescript-7-comparison-2026-09-15.json}"
  check_documented_declaration_counts "$(realpath -e "$SUMMARY_PATH")"
  exit 0
fi
if [[ "${1:-}" == "--check-current-summary" ]]; then
  if [[ -z "${2:-}" ]]; then
    printf 'Usage: %s --check-current-summary SUMMARY_PATH [CONTRACT_REPORT_PATH]\n' "$0" >&2
    exit 2
  fi
  if [[ -n "${3:-}" ]]; then
    check_current_summary "$(realpath -e "$2")" "$(realpath -e "$3")"
  else
    check_current_summary "$(realpath -e "$2")"
  fi
  exit 0
fi

OUT="${1:-/tmp/typescript-7-comparison-evidence}"
TEMP_ROOT="$(realpath -e "${TMPDIR:-/tmp}")"
OUT="$(realpath -m "$OUT")"
case "$OUT/" in
  "$REPO/"*)
    printf 'Evidence output must not be inside the repository: %s\n' "$OUT" >&2
    exit 2
    ;;
esac
case "$OUT/" in
  "$TEMP_ROOT/"?*/) ;;
  *)
    printf 'Evidence output must be a child of disposable temp root %s: %s\n' \
      "$TEMP_ROOT" "$OUT" >&2
    exit 2
    ;;
esac
WORK="$(mktemp -d /tmp/typescript-7-comparison.XXXXXX)"
COPY="$WORK/repository"
TOOLS="$WORK/tools"
CONTRACT_REPORT="$OUT/declaration-contract-report"
CONTRACT_APPROVALS="$REPO/docs/evidence/typescript-7-declaration-approvals.json"

cleanup() {
  rm -rf "$WORK"
}
trap cleanup EXIT

rm -rf "$OUT"
mkdir -p "$OUT" "$COPY" "$TOOLS"

comparison_source_tar "$REPO" | tar -C "$COPY" -xf -

ln -s "$REPO/node_modules" "$COPY/node_modules"
comparison_source_sha256 "$COPY" >"$OUT/source-bundle-sha256.txt"
npm install \
  --prefix "$TOOLS" \
  --ignore-scripts \
  --no-audit \
  --no-fund \
  typescript@7.0.2 \
  >"$OUT/candidate-install.log" 2>&1

TS6="$(realpath -e "$REPO/node_modules/typescript/bin/tsc")"
TS7="$(realpath -e "$TOOLS/node_modules/typescript/bin/tsc")"

"$TS6" --version >"$OUT/typescript-6.version"
"$TS7" --version >"$OUT/typescript-7.version"
if [[ "$TS6" == "$TS7" ]]; then
  printf 'TypeScript baseline and candidate resolve to the same compiler: %s\n' "$TS6" >&2
  exit 2
fi
if [[ "$(<"$OUT/typescript-6.version")" != "Version 6.0.3" ]]; then
  printf 'Expected TypeScript baseline Version 6.0.3, got %s from %s\n' \
    "$(<"$OUT/typescript-6.version")" "$TS6" >&2
  exit 2
fi
if [[ "$(<"$OUT/typescript-7.version")" != "Version 7.0.2" ]]; then
  printf 'Expected TypeScript candidate Version 7.0.2, got %s from %s\n' \
    "$(<"$OUT/typescript-7.version")" "$TS7" >&2
  exit 2
fi
node --version >"$OUT/node.version"
pnpm --version >"$OUT/pnpm.version"
git -C "$REPO" rev-parse HEAD >"$OUT/source-revision.txt"
date -u +%Y-%m-%dT%H:%M:%SZ >"$OUT/captured-at.txt"
uname -sm >"$OUT/platform.txt"
getconf _NPROCESSORS_ONLN >"$OUT/reported-processors.txt"
awk -F: '/model name/{gsub(/^ +/, "", $2); print $2; exit}' /proc/cpuinfo >"$OUT/cpu.txt"
awk '/MemTotal/{print $2}' /proc/meminfo >"$OUT/reported-memory-kib.txt"

run_timed() {
  local name="$1"
  shift
  local started
  local finished
  started="$(date +%s%N)"
  set +e
  "$@" \
    >"$OUT/$name.stdout" \
    2>"$OUT/$name.stderr"
  local status=$?
  set -e
  finished="$(date +%s%N)"
  python3 -c "print(($finished - $started) / 1000000000)" \
    >"$OUT/$name.elapsed-seconds"
  printf '%s\n' "$status" >"$OUT/$name.exit-code"
  return "$status"
}

capture_declarations() {
  local destination="$1"
  mkdir -p "$destination"
  while IFS= read -r -d '' file; do
    mkdir -p "$destination/$(dirname "$file")"
    cp "$file" "$destination/$file"
  done < <(find lib -type f -path '*/dist/*' \
    \( -name '*.d.ts' -o -name '*.d.mts' -o -name '*.d.cts' \) \
    -print0 | sort -z)
}

link_declaration_dependencies() {
  local destination="$1"
  local source
  local relative
  while IFS= read -r -d '' source; do
    relative="${source#"$REPO"/}"
    mkdir -p "$destination/$(dirname "$relative")"
    ln -s "$source" "$destination/$relative"
  done < <(find -L "$REPO/lib" "$REPO/artifacts" \
    -mindepth 2 -maxdepth 2 -name node_modules -type d -print0)
}

run_no_emit_matrix() {
  local label="$1"
  local compiler="$2"

  "$compiler" --build --force --pretty false \
    lib/inventory-math/tsconfig.json \
    lib/spec-import/tsconfig.json \
    lib/recipe-guide-import/tsconfig.json
  run_timed "$label-scripts" \
    "$compiler" -p scripts/tsconfig.json --noEmit --pretty false
  run_timed "$label-api-server" \
    "$compiler" -p artifacts/api-server/tsconfig.json --noEmit --pretty false
  run_timed "$label-run-calculator" \
    "$compiler" -p artifacts/run-calculator/tsconfig.json --noEmit --pretty false
  run_timed "$label-mockup-sandbox" \
    "$compiler" -p artifacts/mockup-sandbox/tsconfig.json --noEmit --pretty false
  run_timed "$label-ai-evaluation" \
    "$compiler" -p lib/ai-evaluation/tsconfig.json --noEmit --pretty false
  run_timed "$label-corpus-harness" \
    "$compiler" -p lib/corpus-harness/tsconfig.json --noEmit --pretty false
}

cd "$COPY"

"$TS6" --build --clean >"$OUT/typescript-6-clean.stdout" 2>"$OUT/typescript-6-clean.stderr"
run_timed typescript-6-shared-build \
  "$TS6" --build --force --pretty false --extendedDiagnostics
capture_declarations "$OUT/typescript-6-declarations"
link_declaration_dependencies "$OUT/typescript-6-declarations"

"$TS7" --build --clean >"$OUT/typescript-7-clean.stdout" 2>"$OUT/typescript-7-clean.stderr"
run_timed typescript-7-shared-build \
  "$TS7" --build --force --pretty false --extendedDiagnostics
capture_declarations "$OUT/typescript-7-declarations"
link_declaration_dependencies "$OUT/typescript-7-declarations"

(
  cd "$OUT/typescript-6-declarations"
  find . -type f -print0 | sort -z | xargs -0 sha256sum
) >"$OUT/typescript-6-declarations.sha256"
(
  cd "$OUT/typescript-7-declarations"
  find . -type f -print0 | sort -z | xargs -0 sha256sum
) >"$OUT/typescript-7-declarations.sha256"

set +e
diff -ruN \
  "$OUT/typescript-6-declarations" \
  "$OUT/typescript-7-declarations" \
  >"$OUT/declarations.diff"
printf '%s\n' "$?" >"$OUT/declarations.diff-exit-code"
set -e

set +e
"$REPO/scripts/node_modules/.bin/tsx" "$REPO/scripts/src/compare-declaration-contracts.mts" \
  "$OUT/typescript-6-declarations" \
  "$OUT/typescript-7-declarations" \
  "$CONTRACT_REPORT" \
  --approvals "$CONTRACT_APPROVALS" \
  --compatibility-compiler typescript-6 "$TS6" \
  --compatibility-compiler typescript-7 "$TS7" \
  >"$OUT/declaration-contract-comparison.stdout" \
  2>"$OUT/declaration-contract-comparison.stderr"
contract_comparison_status=$?
set -e
if [[ "$contract_comparison_status" -eq 0 ]]; then
  node - "$CONTRACT_REPORT/declaration-contracts.json" "$CONTRACT_APPROVALS" <<'NODE'
const fs = require("node:fs");

const report = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const approvals = JSON.parse(fs.readFileSync(process.argv[3], "utf8")).approvals;
const approved = report.files.filter((file) => file.classification === "approved-semantic");
const unexplained = report.categories.reduce(
  (total, category) => total + category.unexplainedSemantic,
  0,
);
if (
  report.status !== "pass" ||
  unexplained !== 0 ||
  approved.length !== approvals.length ||
  approvals.some((approval) => !approved.some((file) =>
    file.path === approval.path &&
    file.baselineSha256 === approval.baselineSha256 &&
    file.candidateSha256 === approval.candidateSha256 &&
    file.approvalReason === approval.reason
  ))
) {
  throw new Error("Checked-in declaration approvals were not fully consumed.");
}
NODE
  contract_comparison_status=$?
fi
printf '%s\n' "$contract_comparison_status" \
  >"$OUT/declaration-contract-comparison.exit-code"

run_no_emit_matrix typescript-6 "$TS6"
run_no_emit_matrix typescript-7 "$TS7"

run_timed typescript-6-generated-api-build \
  "$TS6" --build --force --pretty false \
  lib/api-client-react/tsconfig.json \
  lib/api-zod/tsconfig.json
run_timed typescript-7-generated-api-build \
  "$TS7" --build --force --pretty false \
  lib/api-client-react/tsconfig.json \
  lib/api-zod/tsconfig.json

find "$OUT/typescript-6-declarations" -type f | wc -l >"$OUT/typescript-6-declaration-count.txt"
find "$OUT/typescript-7-declarations" -type f | wc -l >"$OUT/typescript-7-declaration-count.txt"
grep -c '^diff -ruN ' "$OUT/declarations.diff" >"$OUT/changed-declaration-count.txt" || true
grep -c '^+' "$OUT/declarations.diff" >"$OUT/diff-added-lines-including-headers.txt" || true
grep -c '^-' "$OUT/declarations.diff" >"$OUT/diff-removed-lines-including-headers.txt" || true
wc -l <"$OUT/declarations.diff" >"$OUT/diff-line-count.txt"

OUT="$OUT" node <<'NODE'
const fs = require("node:fs");
const path = require("node:path");

const output = process.env.OUT;
const read = (name) => fs.readFileSync(path.join(output, name), "utf8").trim();
const diffLines = fs.readFileSync(path.join(output, "declarations.diff"), "utf8").split("\n");
const changedPaths = diffLines
  .filter((line) => line.startsWith("diff -ruN "))
  .map((line) => line.split(" ")[2]);
const categoryCount = (segment) =>
  changedPaths.filter((file) => file.includes(`/lib/${segment}/`)).length;
const elapsed = {};
const contractPath = path.join(
  output,
  "declaration-contract-report",
  "declaration-contracts.json",
);
const contractReport = fs.existsSync(contractPath)
  ? JSON.parse(fs.readFileSync(contractPath, "utf8"))
  : null;
const unexplainedSemanticChanges = contractReport
  ? contractReport.categories.reduce(
      (total, category) => total + category.unexplainedSemantic,
      0,
    )
  : null;
const approvedSemanticChanges = contractReport
  ? contractReport.files.filter(
      (file) => file.classification === "approved-semantic",
    ).length
  : null;

for (const file of fs.readdirSync(output).filter((name) => name.endsWith(".elapsed-seconds"))) {
  elapsed[file.replace(".elapsed-seconds", "")] = Number(read(file));
}

const summary = {
  schemaVersion: 1,
  capturedAt: read("captured-at.txt"),
  comparisonCommand: "bash docs/evidence/reproduce-typescript-7-comparison.sh",
  sourceIdentity: {
    revision: read("source-revision.txt"),
    bundleSha256: read("source-bundle-sha256.txt"),
  },
  environment: {
    node: read("node.version"),
    pnpm: read("pnpm.version"),
    platform: read("platform.txt"),
  },
  compilers: {
    baseline: read("typescript-6.version"),
    candidate: read("typescript-7.version"),
  },
  declarations: {
    baselineFileCount: Number(read("typescript-6-declaration-count.txt")),
    candidateFileCount: Number(read("typescript-7-declaration-count.txt")),
    textuallyChangedFileCount: Number(read("changed-declaration-count.txt")),
    fullDiffLineCount: Number(read("diff-line-count.txt")),
    changedFilesByPackage: {
      "api-client-react": categoryCount("api-client-react"),
      "api-zod": categoryCount("api-zod"),
      db: categoryCount("db"),
      other:
        changedPaths.length -
        categoryCount("api-client-react") -
        categoryCount("api-zod") -
        categoryCount("db"),
    },
    contractComparison: {
      status: contractReport?.status ?? "not-generated",
      changedFiles: contractReport?.files.length ?? null,
      formattingOnlyChanges: contractReport?.categories.reduce(
        (total, category) => total + category.formattingOnly,
        0,
      ) ?? null,
      approvedSemanticChanges,
      unexplainedSemanticChanges,
    },
  },
  elapsedSeconds: elapsed,
};

fs.writeFileSync(path.join(output, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
NODE

"$REPO/scripts/node_modules/.bin/tsx" \
  "$REPO/scripts/src/typescript-declaration-contract-evidence.mts" \
  create "$OUT/summary.json" \
  "$CONTRACT_REPORT/declaration-contracts.json" \
  "$OUT/typescript-7-declaration-contracts-current.json"

check_current_summary "$OUT/summary.json" "$OUT/typescript-7-declaration-contracts-current.json"

retained_report_tmp="$(mktemp "${RETAINED_CONTRACT_REPORT}.XXXXXX")"
cp "$OUT/typescript-7-declaration-contracts-current.json" "$retained_report_tmp"
mv -f "$retained_report_tmp" "$RETAINED_CONTRACT_REPORT"
check_current_summary "$OUT/summary.json" "$RETAINED_CONTRACT_REPORT"

printf 'Comparison evidence written to %s\n' "$OUT"
printf 'Latest successful declaration contract report retained at %s\n' "$RETAINED_CONTRACT_REPORT"
exit "$contract_comparison_status"
