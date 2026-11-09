#!/usr/bin/env bash

# Keep the explicit check:shell inventory aligned with maintained shell files.
# The maintained boundary includes scripts/src/**/*.sh and top-level
# scripts/*.sh. Fixture-only and generated shell files are intentionally
# excluded when they live under scripts/src/ or end in .fixture.sh or
# .generated.sh.

set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd "${SCRIPT_DIR}/../.." && pwd)
PACKAGE_JSON="${REPO_ROOT}/scripts/package.json"

if [[ ! -f "$PACKAGE_JSON" ]]; then
  printf 'Shell lint inventory check could not find %s.\n' "$PACKAGE_JSON" >&2
  exit 1
fi

check_shell_command=$(
  node - "$PACKAGE_JSON" <<'NODE'
const fs = require("node:fs");

const packagePath = process.argv[2];
const packageJson = JSON.parse(fs.readFileSync(packagePath, "utf8"));
const command = packageJson.scripts?.["check:shell"];

if (typeof command !== "string" || command.trim() === "") {
  process.stderr.write(
    'scripts/package.json must define a non-empty "check:shell" script.\n',
  );
  process.exit(1);
}

process.stdout.write(command);
NODE
)

if [[ "$check_shell_command" != shellcheck\ * ]]; then
  cat >&2 <<'EOF'
Shell lint inventory check expected scripts/package.json#check:shell to
start with `shellcheck` followed by explicit ./src/*.sh or ./*.sh paths.
EOF
  exit 1
fi

declare -a inventory=()
read -r -a inventory_args <<< "${check_shell_command#shellcheck }"
for path in "${inventory_args[@]}"; do
  case "$path" in
    ./src/*.sh)
      inventory+=("scripts/src/${path#./src/}")
      ;;
    ./*.sh)
      inventory+=("scripts/${path#./}")
      ;;
    *)
      printf \
        'Shell lint inventory check found unsupported check:shell path: %s\n' \
        "$path" >&2
      cat >&2 <<'EOF'
Use explicit `./src/<name>.sh` or `./<name>.sh` paths in
scripts/package.json#check:shell.
EOF
      exit 1
      ;;
  esac
done

is_excluded_shell_file() {
  local path="$1"
  [[ "$path" == scripts/src/fixtures/* ||
    "$path" == *.fixture.sh ||
    "$path" == *.generated.sh ]]
}

declare -a maintained_files=()
shell_list_file=$(mktemp)
trap 'rm -f "$shell_list_file"' RETURN
git -C "$REPO_ROOT" ls-files --cached --others --exclude-standard -- \
  ':(glob)scripts/src/**/*.sh' \
  ':(glob)scripts/*.sh' >"$shell_list_file"
while IFS= read -r path; do
  # Git still lists an unstaged deletion in its index. The inventory should
  # describe files that exist in the current working tree.
  if [[ ! -f "${REPO_ROOT}/${path}" ]]; then
    continue
  fi
  if ! is_excluded_shell_file "$path"; then
    maintained_files+=("$path")
  fi
done <"$shell_list_file"

sorted_expected=$(printf '%s\n' "${maintained_files[@]}" | sort -u)
sorted_inventory=$(printf '%s\n' "${inventory[@]}" | sort -u)

expected_file=$(mktemp)
inventory_file=$(mktemp)
trap 'rm -f "$expected_file" "$inventory_file"' RETURN
printf '%s\n' "$sorted_expected" >"$expected_file"
printf '%s\n' "$sorted_inventory" >"$inventory_file"
missing=$(comm -23 "$expected_file" "$inventory_file")
unexpected=$(comm -13 "$expected_file" "$inventory_file")
