#!/usr/bin/env bash

# Regression tests for the actionlint version synchronization guard.

set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
CHECK_SCRIPT="${SCRIPT_DIR}/check-workflows.sh"
TEST_ROOT=$(mktemp -d)
FAKE_ACTIONLINT="${TEST_ROOT}/fake-actionlint"
trap 'rm -rf "$TEST_ROOT"' EXIT

cat > "$FAKE_ACTIONLINT" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF
chmod +x "$FAKE_ACTIONLINT"

make_workspace() {
  local name="$1"
  local package_version="$2"
  local ci_version="$3"
  local workspace="${TEST_ROOT}/${name}"

  mkdir -p "${workspace}/scripts/src" "${workspace}/.github/workflows"
  cp "$CHECK_SCRIPT" "${workspace}/scripts/src/check-workflows.sh"
  cat > "${workspace}/scripts/package.json" <<EOF
{
  "devDependencies": {
    "github-actionlint": "${package_version}"
  }
}
EOF
  cat > "${workspace}/.github/workflows/workflow-lint.yml" <<EOF
name: Workflow lint

env:
  ACTIONLINT_VERSION: ${ci_version}
EOF
  printf '%s\n' "$workspace"
}

run_check() {
  local workspace="$1"
  set +e
  CHECK_OUTPUT=$(ACTIONLINT_BIN="$FAKE_ACTIONLINT" bash "${workspace}/scripts/src/check-workflows.sh" 2>&1)
  CHECK_STATUS=$?
  set -e
}

assert_contains() {
  local haystack="$1"
  local needle="$2"
  if [[ "$haystack" != *"$needle"* ]]; then
    printf 'Expected output to contain: %s\nActual output:\n%s\n' "$needle" "$haystack" >&2
    return 1
  fi
}

test_accepts_matching_versions() {
  local workspace
  workspace=$(make_workspace matching 1.7.12 1.7.12)
  run_check "$workspace"
  [[ "$CHECK_STATUS" -eq 0 ]] || {
    printf 'Expected matching versions to pass. Output:\n%s\n' "$CHECK_OUTPUT" >&2
    return 1
  }
  assert_contains "$CHECK_OUTPUT" "local wrapper (scripts/package.json): 1.7.12"
  assert_contains "$CHECK_OUTPUT" "CI workflow (.github/workflows/workflow-lint.yml): 1.7.12"
  echo "PASS: accepts matching actionlint versions"
}

test_rejects_mismatched_versions() {
  local workspace
  workspace=$(make_workspace mismatched 1.7.12 1.7.11)
  run_check "$workspace"
  [[ "$CHECK_STATUS" -eq 1 ]] || {
    printf 'Expected mismatched versions to fail. Output:\n%s\n' "$CHECK_OUTPUT" >&2
    return 1
  }
  assert_contains "$CHECK_OUTPUT" "local wrapper (scripts/package.json): 1.7.12"
  assert_contains "$CHECK_OUTPUT" "CI workflow (.github/workflows/workflow-lint.yml): 1.7.11"
  assert_contains "$CHECK_OUTPUT" "Update scripts/package.json and .github/workflows/workflow-lint.yml"
  assert_contains "$CHECK_OUTPUT" "pnpm install"
  echo "PASS: rejects mismatched actionlint versions with remediation"
}

test_accepts_matching_versions
test_rejects_mismatched_versions