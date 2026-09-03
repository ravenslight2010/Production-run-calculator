#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
package_json="$repo_root/lib/api-spec/package.json"
client_generated="$repo_root/lib/api-client-react/src/generated"
zod_generated="$repo_root/lib/api-zod/src/generated"
test_root="$(mktemp -d "${TMPDIR:-/tmp}/workspace-api-generated-test.XXXXXX")"
original_client_api="$test_root/api.ts"

cleanup() {
  if [[ -f "$original_client_api" ]]; then
    cp "$original_client_api" "$client_generated/api.ts"
  fi
  rm -rf "$test_root"
}
trap cleanup EXIT

assert_shell_inventory_is_current() {
  local check_shell_command
  check_shell_command=$(
    node - "$package_json" <<'NODE'
const fs = require("node:fs");

const packagePath = process.argv[2];
const packageJson = JSON.parse(fs.readFileSync(packagePath, "utf8"));
const command = packageJson.scripts?.["check:shell"];

if (typeof command !== "string" || command.trim() === "") {
  process.stderr.write(
    'lib/api-spec/package.json must define a non-empty "check:shell" script.\n',
  );
  process.exit(1);
}

process.stdout.write(command);
NODE
  )

  if [[ "$check_shell_command" != shellcheck\ * ]]; then
    printf \
      'API-spec shell lint inventory must start with shellcheck: %s\n' \
      "$check_shell_command" >&2
    return 1
  fi

  declare -a inventory=()
  read -r -a inventory_args <<< "${check_shell_command#shellcheck }"
  for path in "${inventory_args[@]}"; do
    case "$path" in
      ./*.sh)
        inventory+=("lib/api-spec/${path#./}")
        ;;
      *)
        printf \
          'API-spec shell lint inventory found unsupported path: %s\n' \
          "$path" >&2
        printf \
          'Use explicit ./<name>.sh paths in lib/api-spec/package.json#check:shell.\n' \
          >&2
        return 1
        ;;
    esac
  done

  declare -a maintained_files=()
  while IFS= read -r path; do
    maintained_files+=("$path")
  done < <(
    git -C "$repo_root" ls-files --cached --others --exclude-standard -- \
      ':(glob)lib/api-spec/*.sh'
  )

  local sorted_expected sorted_inventory missing unexpected
  sorted_expected=$(printf '%s\n' "${maintained_files[@]}" | sort -u)
  sorted_inventory=$(printf '%s\n' "${inventory[@]}" | sort -u)
  missing=$(comm -23 \
    <(printf '%s\n' "$sorted_expected") \
    <(printf '%s\n' "$sorted_inventory"))
  unexpected=$(comm -13 \
    <(printf '%s\n' "$sorted_expected") \
    <(printf '%s\n' "$sorted_inventory"))

  if [[ -n "$missing" || -n "$unexpected" ]]; then
    printf '%s\n' \
      'API-spec shell lint inventory is out of date.' >&2
    if [[ -n "$missing" ]]; then
      printf '\nMissing from check:shell:\n%s\n' "$missing" >&2
    fi
    if [[ -n "$unexpected" ]]; then
      printf '\nListed in check:shell but not a maintained shell file:\n%s\n' \
        "$unexpected" >&2
    fi
    printf '%s\n' \
      'Add or remove the explicit ./<name>.sh entry in lib/api-spec/package.json#check:shell.' \
      >&2
    return 1
  fi

  printf 'API-spec shell lint inventory covers %d maintained scripts.\n' \
    "$(printf '%s\n' "$sorted_expected" | grep -c .)"
}

assert_shell_inventory_is_current

mkdir -p "$test_root/before/client" "$test_root/before/zod" "$test_root/logs"
cp -R "$client_generated" "$test_root/before/client/"
cp -R "$zod_generated" "$test_root/before/zod/"
cp "$client_generated/api.ts" "$original_client_api"

run_check() {
  local name="$1"
  pnpm --filter @workspace/api-spec run check-generated \
    >"$test_root/logs/$name.log" 2>&1
}

first_status=0
second_status=0
run_check first &
first_pid=$!
run_check second &
second_pid=$!
wait "$first_pid" || first_status=$?
wait "$second_pid" || second_status=$?

if [[ "$first_status" -ne 0 || "$second_status" -ne 0 ]]; then
  echo "Concurrent generated-client checks failed." >&2
  cat "$test_root"/logs/*.log >&2
  exit 1
fi

diff -ru "$test_root/before/client/generated" "$client_generated" >/dev/null
diff -ru "$test_root/before/zod/generated" "$zod_generated" >/dev/null

# A real mismatch must still be reported after generation moved off the
# checked-in tree.
printf '\n// intentional generated-contract mismatch\n' >>"$client_generated/api.ts"
stale_output="$test_root/stale.log"
stale_status=0
pnpm --filter @workspace/api-spec run check-generated >"$stale_output" 2>&1 ||
  stale_status=$?
if [[ "$stale_status" -eq 0 ]]; then
  echo "A stale generated contract unexpectedly passed." >&2
  cat "$stale_output" >&2
  exit 1
fi
grep -Fq "Generated API client output is stale." "$stale_output"

echo "Generated-client isolation tests passed (concurrent checks and stale output)."