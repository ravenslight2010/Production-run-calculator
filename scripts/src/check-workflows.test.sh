#!/usr/bin/env bash

# Regression tests for the actionlint version synchronization guard.

set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
CHECK_SCRIPT="${SCRIPT_DIR}/check-workflows.sh"
TEST_ROOT=$(mktemp -d)
FAKE_ACTIONLINT="${TEST_ROOT}/fake-actionlint"
FAKE_ACTIONLINT_MARKER="${TEST_ROOT}/actionlint-called"
trap 'rm -rf "$TEST_ROOT"' EXIT

cat > "$FAKE_ACTIONLINT" <<EOF
#!/usr/bin/env bash
touch "$FAKE_ACTIONLINT_MARKER"
exit 0
EOF
chmod +x "$FAKE_ACTIONLINT"

make_workspace_with_declarations() {
  local name="$1"
  local package_declaration="$2"
  local ci_declaration="$3"
  local workspace="${TEST_ROOT}/${name}"

  mkdir -p "${workspace}/scripts/src" "${workspace}/.github/workflows"
  cp "$CHECK_SCRIPT" "${workspace}/scripts/src/check-workflows.sh"
  cat > "${workspace}/scripts/package.json" <<EOF
{
  "devDependencies": {
    ${package_declaration}
  }
}
EOF
  cat > "${workspace}/.github/workflows/workflow-lint.yml" <<EOF
name: Workflow lint

env:
  ${ci_declaration}
EOF
  printf '%s\n' "$workspace"
}

make_workspace() {
  local name="$1"
  local package_version="$2"
  local ci_version="$3"
  make_workspace_with_declarations \
    "$name" \
    "\"github-actionlint\": \"${package_version}\"" \
    "ACTIONLINT_VERSION: ${ci_version}"
}

run_check() {
  local workspace="$1"
  rm -f "$FAKE_ACTIONLINT_MARKER"
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

test_accepts_quoted_ci_version_with_inline_comment() {
  local workspace
  workspace=$(make_workspace_with_declarations quoted-inline-comment \
    '"github-actionlint": "1.7.12"' \
    'ACTIONLINT_VERSION: "1.7.12" # Keep CI aligned with the local wrapper')
  run_check "$workspace"
  [[ "$CHECK_STATUS" -eq 0 ]] || {
    printf 'Expected a quoted CI version with an inline comment to pass. Output:\n%s\n' "$CHECK_OUTPUT" >&2
    return 1
  }
  assert_contains "$CHECK_OUTPUT" "local wrapper (scripts/package.json): 1.7.12"
  assert_contains "$CHECK_OUTPUT" "CI workflow (.github/workflows/workflow-lint.yml): 1.7.12"
  [[ -e "$FAKE_ACTIONLINT_MARKER" ]] || {
    printf 'Expected the accepted declaration to reach actionlint.\n' >&2
    return 1
  }
  echo "PASS: accepts quoted CI version with inline comment"
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

test_rejects_missing_actionlint_declaration() {
  local workspace
  workspace=$(make_workspace_with_declarations missing-package \
    '"github-actionlint": "1.7.12"' \
    "ACTIONLINT_VERSION: 1.7.12")
  rm "${workspace}/scripts/package.json"
  run_check "$workspace"
  [[ "$CHECK_STATUS" -eq 1 ]] || {
    printf 'Expected a missing package declaration file to fail. Output:\n%s\n' "$CHECK_OUTPUT" >&2
    return 1
  }
  assert_contains "$CHECK_OUTPUT" "local wrapper (scripts/package.json): <missing>"
  assert_contains "$CHECK_OUTPUT" "CI workflow (.github/workflows/workflow-lint.yml): 1.7.12"
  assert_contains "$CHECK_OUTPUT" "Missing local actionlint declaration: scripts/package.json."
  assert_contains "$CHECK_OUTPUT" "Set the github-actionlint devDependency and ACTIONLINT_VERSION"
  assert_contains "$CHECK_OUTPUT" "to the same release."
  [[ ! -e "$FAKE_ACTIONLINT_MARKER" ]] || {
    printf 'Expected the missing package declaration file to fail before actionlint ran.\n' >&2
    return 1
  }
  echo "PASS: reports missing package declaration before linting"
}

test_rejects_missing_workflow_declaration_file() {
  local workspace
  workspace=$(make_workspace_with_declarations missing-workflow \
    '"github-actionlint": "1.7.12"' \
    "ACTIONLINT_VERSION: 1.7.12")
  rm "${workspace}/.github/workflows/workflow-lint.yml"
  cat > "${workspace}/.github/workflows/other.yml" <<'EOF'
name: Other workflow

on:
  workflow_dispatch:

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - run: echo ok
EOF
  run_check "$workspace"
  [[ "$CHECK_STATUS" -eq 1 ]] || {
    printf 'Expected a missing workflow declaration file to fail. Output:\n%s\n' "$CHECK_OUTPUT" >&2
    return 1
  }
  assert_contains "$CHECK_OUTPUT" "local wrapper (scripts/package.json): 1.7.12"
  assert_contains "$CHECK_OUTPUT" "CI workflow (.github/workflows/workflow-lint.yml): <missing>"
  assert_contains "$CHECK_OUTPUT" "Missing CI actionlint declaration: .github/workflows/workflow-lint.yml."
  assert_contains "$CHECK_OUTPUT" "Set the github-actionlint devDependency and ACTIONLINT_VERSION"
  assert_contains "$CHECK_OUTPUT" "to the same release."
  [[ ! -e "$FAKE_ACTIONLINT_MARKER" ]] || {
    printf 'Expected the missing workflow declaration file to fail before actionlint ran.\n' >&2
    return 1
  }
  echo "PASS: reports missing workflow declaration before linting"
}

test_rejects_malformed_local_actionlint_declaration() {
  local workspace
  workspace=$(make_workspace_with_declarations \
    malformed-package \
    '"github-actionlint": 1.7.12' \
    'ACTIONLINT_VERSION: 1.7.12')
  run_check "$workspace"
  [[ "$CHECK_STATUS" -eq 1 ]] || {
    printf 'Expected a malformed local actionlint declaration to fail. Output:\n%s\n' "$CHECK_OUTPUT" >&2
    return 1
  }
  assert_contains "$CHECK_OUTPUT" "local wrapper (scripts/package.json): <malformed>"
  assert_contains "$CHECK_OUTPUT" "CI workflow (.github/workflows/workflow-lint.yml): 1.7.12"
  assert_contains "$CHECK_OUTPUT" "Malformed local actionlint declaration: scripts/package.json."
  assert_contains "$CHECK_OUTPUT" "not configured or malformed."
  [[ ! -e "$FAKE_ACTIONLINT_MARKER" ]] || {
    printf 'Expected the malformed local declaration to fail before actionlint ran.\n' >&2
    return 1
  }
  echo "PASS: reports malformed local declaration before linting"
}

test_rejects_malformed_ci_actionlint_declaration() {
  local workspace
  workspace=$(make_workspace_with_declarations \
    malformed-ci \
    '"github-actionlint": "1.7.12"' \
    'ACTIONLINT_VERSION: "1.7.12 trailing"')
  run_check "$workspace"
  [[ "$CHECK_STATUS" -eq 1 ]] || {
    printf 'Expected a malformed CI actionlint declaration to fail. Output:\n%s\n' "$CHECK_OUTPUT" >&2
    return 1
  }
  assert_contains "$CHECK_OUTPUT" "local wrapper (scripts/package.json): 1.7.12"
  assert_contains "$CHECK_OUTPUT" "CI workflow (.github/workflows/workflow-lint.yml): <malformed>"
  assert_contains "$CHECK_OUTPUT" "Malformed CI actionlint declaration: .github/workflows/workflow-lint.yml."
  assert_contains "$CHECK_OUTPUT" "not configured or malformed."
  [[ ! -e "$FAKE_ACTIONLINT_MARKER" ]] || {
    printf 'Expected the malformed CI declaration to fail before actionlint ran.\n' >&2
    return 1
  }
  echo "PASS: reports malformed CI declaration before linting"
}

test_rejects_invalid_local_actionlint_release() {
  local workspace
  workspace=$(make_workspace invalid-local latest 1.7.12)
  run_check "$workspace"
  [[ "$CHECK_STATUS" -eq 1 ]] || {
    printf 'Expected an invalid local actionlint release to fail. Output:\n%s\n' "$CHECK_OUTPUT" >&2
    return 1
  }
  assert_contains "$CHECK_OUTPUT" "local wrapper (scripts/package.json): latest"
  assert_contains "$CHECK_OUTPUT" "CI workflow (.github/workflows/workflow-lint.yml): 1.7.12"
  assert_contains "$CHECK_OUTPUT" \
    "Invalid local actionlint release in scripts/package.json: latest."
  assert_contains "$CHECK_OUTPUT" "Use a numeric major.minor.patch release such as 1.7.12."
  [[ ! -e "$FAKE_ACTIONLINT_MARKER" ]] || {
    printf 'Expected the invalid local release to fail before actionlint ran.\n' >&2
    return 1
  }
  echo "PASS: reports invalid local release before linting"
}

test_rejects_invalid_ci_actionlint_release() {
  local workspace
  workspace=$(make_workspace invalid-ci 1.7.12 v1.7.12)
  run_check "$workspace"
  [[ "$CHECK_STATUS" -eq 1 ]] || {
    printf 'Expected an invalid CI actionlint release to fail. Output:\n%s\n' "$CHECK_OUTPUT" >&2
    return 1
  }
  assert_contains "$CHECK_OUTPUT" "local wrapper (scripts/package.json): 1.7.12"
  assert_contains "$CHECK_OUTPUT" "CI workflow (.github/workflows/workflow-lint.yml): v1.7.12"
  assert_contains "$CHECK_OUTPUT" \
    "Invalid CI actionlint release in .github/workflows/workflow-lint.yml: v1.7.12."
  assert_contains "$CHECK_OUTPUT" "Use a numeric major.minor.patch release such as 1.7.12."
  [[ ! -e "$FAKE_ACTIONLINT_MARKER" ]] || {
    printf 'Expected the invalid CI release to fail before actionlint ran.\n' >&2
    return 1
  }
  echo "PASS: reports invalid CI release before linting"
}

test_rejects_both_invalid_actionlint_releases() {
  local workspace
  workspace=$(make_workspace invalid-both latest v1.7.12)
  run_check "$workspace"
  [[ "$CHECK_STATUS" -eq 1 ]] || {
    printf 'Expected both invalid actionlint releases to fail. Output:\n%s\n' "$CHECK_OUTPUT" >&2
    return 1
  }
  assert_contains "$CHECK_OUTPUT" "local wrapper (scripts/package.json): latest"
  assert_contains "$CHECK_OUTPUT" "CI workflow (.github/workflows/workflow-lint.yml): v1.7.12"
  assert_contains "$CHECK_OUTPUT" \
    "Invalid local actionlint release in scripts/package.json: latest."
  assert_contains "$CHECK_OUTPUT" \
    "Invalid CI actionlint release in .github/workflows/workflow-lint.yml: v1.7.12."
  assert_contains "$CHECK_OUTPUT" "Use a numeric major.minor.patch release such as 1.7.12."
  [[ ! -e "$FAKE_ACTIONLINT_MARKER" ]] || {
    printf 'Expected both invalid releases to fail before actionlint ran.\n' >&2
    return 1
  }
  echo "PASS: reports both invalid releases before linting"
}

test_accepts_matching_versions
test_accepts_quoted_ci_version_with_inline_comment
test_rejects_mismatched_versions
test_rejects_missing_actionlint_declaration
test_rejects_missing_workflow_declaration_file
test_rejects_malformed_local_actionlint_declaration
test_rejects_malformed_ci_actionlint_declaration
test_rejects_invalid_local_actionlint_release
test_rejects_invalid_ci_actionlint_release
test_rejects_both_invalid_actionlint_releases
