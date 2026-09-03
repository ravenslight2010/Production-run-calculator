#!/usr/bin/env bash

# Keep the explicit check:shell inventory aligned with maintained shell files.
# Fixture-only and generated shell files are intentionally excluded when they
# live under scripts/src/fixtures/ or end in .fixture.sh or .generated.sh.

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
start with `shellcheck` followed by explicit scripts/src/*.sh paths.
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
    *)
      printf \
        'Shell lint inventory check found unsupported check:shell path: %s\n' \
        "$path" >&2
      cat >&2 <<'EOF'
Use explicit `./src/<name>.sh` paths in scripts/package.json#check:shell.
EOF
      exit 1
      ;;
  esac
done

is_excluded_shell_file() {
  local path="$1"
  [[ "$path" == scripts/src/fixtures/* ||
    "$path" == scripts/src/*.fixture.sh ||
    "$path" == scripts/src/*.generated.sh ]]
}

declare -a maintained_files=()
while IFS= read -r path; do
  if ! is_excluded_shell_file "$path"; then
    maintained_files+=("$path")
  fi
done < <(
  git -C "$REPO_ROOT" ls-files --cached --others --exclude-standard -- \
    ':(glob)scripts/src/**/*.sh'
)

sorted_expected=$(printf '%s\n' "${maintained_files[@]}" | sort -u)
sorted_inventory=$(printf '%s\n' "${inventory[@]}" | sort -u)

missing=$(comm -23 \
  <(printf '%s\n' "$sorted_expected") \
  <(printf '%s\n' "$sorted_inventory"))
unexpected=$(comm -13 \
  <(printf '%s\n' "$sorted_expected") \
  <(printf '%s\n' "$sorted_inventory"))

if [[ -n "$missing" || -n "$unexpected" ]]; then
  cat >&2 <<'EOF'
Shell lint inventory is out of date.

Every maintained shell file under scripts/src must appear in the
scripts/package.json check:shell command.
EOF
  if [[ -n "$missing" ]]; then
    printf '\nMissing from check:shell:\n%s\n' "$missing" >&2
  fi
  if [[ -n "$unexpected" ]]; then
    printf '\nListed in check:shell but not a maintained shell file:\n%s\n' \
      "$unexpected" >&2
  fi
  cat >&2 <<'EOF'

Add or remove the explicit `./src/<name>.sh` entry in scripts/package.json,
then run `pnpm --filter @workspace/scripts run check:shell`.
Fixture-only or generated files may be excluded only under
scripts/src/fixtures/ or with a .fixture.sh or .generated.sh suffix.
EOF
  exit 1
fi

printf 'Shell lint inventory covers %d maintained scripts.\n' \
  "$(printf '%s\n' "$sorted_expected" | grep -c .)"