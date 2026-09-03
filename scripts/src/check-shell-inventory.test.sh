#!/usr/bin/env bash

# Regression tests for the explicit check:shell inventory guard.

set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd "${SCRIPT_DIR}/../.." && pwd)
GUARD_SCRIPT="${SCRIPT_DIR}/check-shell-inventory.sh"
TEST_ROOT=$(mktemp -d)
trap 'rm -rf "$TEST_ROOT"' EXIT

assert_contains() {
  local haystack="$1"
  local needle="$2"
  if [[ "$haystack" != *"$needle"* ]]; then
    printf 'Expected output to contain: %s\nActual output:\n%s\n' \
      "$needle" "$haystack" >&2
    return 1
  fi
}

make_workspace() {
  local name="$1"
  local command="$2"
  local workspace="${TEST_ROOT}/${name}"

  mkdir -p "${workspace}/scripts/src"
  cp "$GUARD_SCRIPT" "${workspace}/scripts/src/check-shell-inventory.sh"
  cat > "${workspace}/scripts/package.json" <<EOF
{
  "scripts": {
    "check:shell": "${command}"
  }
}
EOF
  git -C "$workspace" init -q
  git -C "$workspace" config user.email test@example.invalid
  git -C "$workspace" config user.name "Shell inventory test"
  printf '%s\n' "$workspace"
}

run_guard() {
  local workspace="$1"
  set +e
  CHECK_OUTPUT=$(bash "${workspace}/scripts/src/check-shell-inventory.sh" 2>&1)
  CHECK_STATUS=$?
  set -e
}

test_accepts_matching_inventory() {
  local workspace
  workspace=$(make_workspace matching \
    'shellcheck ./src/check-shell-inventory.sh ./src/validate.sh')
  cat > "${workspace}/scripts/src/validate.sh" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF

  run_guard "$workspace"
  [[ "$CHECK_STATUS" -eq 0 ]] || {
    printf 'Expected matching inventory to pass. Output:\n%s\n' \
      "$CHECK_OUTPUT" >&2
    return 1
  }
  assert_contains "$CHECK_OUTPUT" "covers 2 maintained scripts"
  echo "PASS: accepts a matching shell inventory"
}

test_accepts_matching_top_level_inventory() {
  local workspace
  workspace=$(make_workspace matching_top_level \
    'shellcheck ./src/check-shell-inventory.sh ./run-large-spec-harness.sh')
  cat > "${workspace}/scripts/run-large-spec-harness.sh" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF

  run_guard "$workspace"
  [[ "$CHECK_STATUS" -eq 0 ]] || {
    printf 'Expected matching top-level inventory to pass. Output:\n%s\n' \
      "$CHECK_OUTPUT" >&2
    return 1
  }
  assert_contains "$CHECK_OUTPUT" "covers 2 maintained scripts"
  echo "PASS: accepts a matching top-level shell inventory"
}

test_detects_missing_maintained_script() {
  local workspace
  workspace=$(make_workspace missing \
    'shellcheck ./src/check-shell-inventory.sh')
  cat > "${workspace}/scripts/src/validate.sh" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF

  run_guard "$workspace"
  [[ "$CHECK_STATUS" -eq 1 ]] || {
    printf 'Expected a missing maintained script to fail.\n' >&2
    return 1
  }
  assert_contains "$CHECK_OUTPUT" "Missing from check:shell:"
  assert_contains "$CHECK_OUTPUT" "scripts/src/validate.sh"
  assert_contains "$CHECK_OUTPUT" "Add or remove the explicit"
  echo "PASS: detects a maintained script missing from the inventory"
}

test_detects_missing_top_level_script() {
  local workspace
  workspace=$(make_workspace missing_top_level \
    'shellcheck ./src/check-shell-inventory.sh')
  cat > "${workspace}/scripts/run-large-spec-harness.sh" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF

  run_guard "$workspace"
  [[ "$CHECK_STATUS" -eq 1 ]] || {
    printf 'Expected a missing top-level script to fail.\n' >&2
    return 1
  }
  assert_contains "$CHECK_OUTPUT" "Missing from check:shell:"
  assert_contains "$CHECK_OUTPUT" "scripts/run-large-spec-harness.sh"
  echo "PASS: detects a top-level script missing from the inventory"
}

test_detects_stale_inventory_entry() {
  local workspace
  workspace=$(make_workspace stale \
    'shellcheck ./src/check-shell-inventory.sh ./src/removed.sh')

  run_guard "$workspace"
  [[ "$CHECK_STATUS" -eq 1 ]] || {
    printf 'Expected a stale inventory entry to fail.\n' >&2
    return 1
  }
  assert_contains "$CHECK_OUTPUT" \
    "Listed in check:shell but not a maintained shell file:"
  assert_contains "$CHECK_OUTPUT" "scripts/src/removed.sh"
  echo "PASS: detects a stale inventory entry"
}

test_detects_stale_top_level_inventory_entry() {
  local workspace
  workspace=$(make_workspace stale_top_level \
    'shellcheck ./src/check-shell-inventory.sh ./removed.sh')

  run_guard "$workspace"
  [[ "$CHECK_STATUS" -eq 1 ]] || {
    printf 'Expected a stale top-level inventory entry to fail.\n' >&2
    return 1
  }
  assert_contains "$CHECK_OUTPUT" \
    "Listed in check:shell but not a maintained shell file:"
  assert_contains "$CHECK_OUTPUT" "scripts/removed.sh"
  echo "PASS: detects a stale top-level inventory entry"
}

test_allows_only_documented_exclusions() {
  local workspace
  workspace=$(make_workspace exclusions \
    'shellcheck ./src/check-shell-inventory.sh')
  mkdir -p "${workspace}/scripts/src/fixtures"
  touch \
    "${workspace}/scripts/src/fixtures/fixture.sh" \
    "${workspace}/scripts/src/example.fixture.sh" \
    "${workspace}/scripts/src/example.generated.sh"
  touch \
    "${workspace}/scripts/example.fixture.sh" \
    "${workspace}/scripts/example.generated.sh"

  run_guard "$workspace"
  [[ "$CHECK_STATUS" -eq 0 ]] || {
    printf 'Expected documented fixture/generated exclusions to pass.\n%s\n' \
      "$CHECK_OUTPUT" >&2
    return 1
  }
  assert_contains "$CHECK_OUTPUT" "covers 1 maintained scripts"
  echo "PASS: allows only documented fixture/generated exclusions"
}

test_release_validation_runs_package_inventory_guards() {
  local root_command
  root_command=$(
    node - "${REPO_ROOT}/package.json" <<'NODE'
const fs = require("node:fs");

const packagePath = process.argv[2];
const packageJson = JSON.parse(fs.readFileSync(packagePath, "utf8"));
process.stdout.write(packageJson.scripts?.["check:shell-inventory"] ?? "");
NODE
  )

  assert_contains "$root_command" "scripts/src/check-shell-inventory.sh"
  assert_contains "$root_command" \
    "lib/api-spec/check-generated.test.sh --shell-inventory-only"

  local release_check
  release_check=$(cat "${REPO_ROOT}/scripts/src/release-check.mts")
  assert_contains "$release_check" 'label: "shell lint inventory"'
  assert_contains "$release_check" 'args: ["run", "check:shell-inventory"]'
  assert_contains "$release_check" 'stage: "prerequisites"'
  echo "PASS: release validation runs both package inventory guards"
}

test_accepts_matching_inventory
test_accepts_matching_top_level_inventory
test_detects_missing_maintained_script
test_detects_missing_top_level_script
test_detects_stale_inventory_entry
test_detects_stale_top_level_inventory_entry
test_allows_only_documented_exclusions
test_release_validation_runs_package_inventory_guards