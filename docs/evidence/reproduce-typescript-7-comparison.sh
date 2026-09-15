#!/usr/bin/env bash
set -euo pipefail

# Reproduce the TypeScript 6/7 CLI comparison without writing candidate output
# into the authoritative workspace.

REPO="$(git rev-parse --show-toplevel)"
REPO="$(realpath -e "$REPO")"
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

cleanup() {
  rm -rf "$WORK"
}
trap cleanup EXIT

rm -rf "$OUT"
mkdir -p "$OUT" "$COPY" "$TOOLS"

tar \
  --exclude='./node_modules' \
  --exclude='*/dist' \
  --exclude='*/build' \
  --exclude='*/test-results' \
  --exclude='*/playwright-report' \
  --exclude='*/screenshots' \
  --exclude='*/attached_assets' \
  -C "$REPO" -cf - \
  package.json \
  pnpm-lock.yaml \
  pnpm-workspace.yaml \
  tsconfig.json \
  tsconfig.base.json \
  lib \
  artifacts \
  scripts |
  tar -C "$COPY" -xf -

ln -s "$REPO/node_modules" "$COPY/node_modules"
npm install \
  --prefix "$TOOLS" \
  --ignore-scripts \
  --no-audit \
  --no-fund \
  typescript@7.0.2 \
  >"$OUT/candidate-install.log" 2>&1

TS6="$REPO/node_modules/.bin/tsc"
TS7="$TOOLS/node_modules/.bin/tsc"

"$TS6" --version >"$OUT/typescript-6.version"
"$TS7" --version >"$OUT/typescript-7.version"
node --version >"$OUT/node.version"
pnpm --version >"$OUT/pnpm.version"
git -C "$REPO" rev-parse HEAD >"$OUT/source-revision.txt"
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
  done < <(find lib -type f \
    \( -path '*/dist/*.d.ts' -o -path '*/dist/*.d.mts' -o -path '*/dist/*.d.cts' \) \
    -print0 | sort -z)
}

run_no_emit_matrix() {
  local label="$1"
  local compiler="$2"

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

"$TS7" --build --clean >"$OUT/typescript-7-clean.stdout" 2>"$OUT/typescript-7-clean.stderr"
run_timed typescript-7-shared-build \
  "$TS7" --build --force --pretty false --extendedDiagnostics
capture_declarations "$OUT/typescript-7-declarations"

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
  >"$OUT/declaration-contract-comparison.stdout" \
  2>"$OUT/declaration-contract-comparison.stderr"
contract_comparison_status=$?
set -e
printf '%s\n' "$contract_comparison_status" \
  >"$OUT/declaration-contract-comparison.exit-code"

for compiler in "$TS6" "$TS7"; do
  "$compiler" --build --force --pretty false \
    lib/inventory-math/tsconfig.json \
    lib/spec-import/tsconfig.json \
    lib/recipe-guide-import/tsconfig.json
done

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

for (const file of fs.readdirSync(output).filter((name) => name.endsWith(".elapsed-seconds"))) {
  elapsed[file.replace(".elapsed-seconds", "")] = Number(read(file));
}

const summary = {
  sourceRevision: read("source-revision.txt"),
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
    contractComparison: JSON.parse(
      fs.readFileSync(path.join(output, "declaration-contract-report", "declaration-contracts.json"), "utf8"),
    ),
  },
  elapsedSeconds: elapsed,
};

fs.writeFileSync(path.join(output, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
NODE

printf 'Comparison evidence written to %s\n' "$OUT"
exit "$contract_comparison_status"