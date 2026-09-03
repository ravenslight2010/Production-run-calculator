#!/usr/bin/env bash

# Regression tests for workflow guard contracts.

set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
CHECK_SCRIPT="${SCRIPT_DIR}/check-workflows.sh"
CI_WORKFLOW="${SCRIPT_DIR}/../../.github/workflows/ci.yml"
RELEASE_WORKFLOW="${SCRIPT_DIR}/../../.github/workflows/release-check.yml"
STABLE_BRANCH_PROTECTION_WORKFLOW="${SCRIPT_DIR}/../../.github/workflows/stable-branch-protection.yml"
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
  cat > "${workspace}/.github/workflows/ci.yml" <<'EOF'
name: CI

on:
  workflow_dispatch:

jobs:
  fixture:
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - run: echo ok
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

workflow_step_block() {
  local step_name="$1"
  awk -v step_name="$step_name" '
    $0 == "      - name: " step_name {
      found = 1
      print
      next
    }
    found && $0 ~ /^      - name: / {
      exit
    }
    found {
      print
    }
  ' "$RELEASE_WORKFLOW"
}

stable_branch_protection_step_block() {
  local step_name="$1"
  awk -v step_name="$step_name" '
    $0 == "      - name: " step_name {
      found = 1
      print
      next
    }
    found && $0 ~ /^      - name: / {
      exit
    }
    found {
      print
    }
  ' "$STABLE_BRANCH_PROTECTION_WORKFLOW"
}

ci_typecheck_job_block() {
  awk '
    $0 == "  typecheck:" {
      found = 1
      print
      next
    }
    found && $0 ~ /^  [[:alnum:]_-]+:/ {
      exit
    }
    found {
      print
    }
  ' "$CI_WORKFLOW"
}

ci_schema_safe_rollback_job_block() {
  awk '
    $0 == "  schema-safe-rollback:" {
      found = 1
      print
      next
    }
    found && $0 ~ /^  [[:alnum:]_-]+:/ {
      exit
    }
    found {
      print
    }
  ' "$CI_WORKFLOW"
}

test_ci_runs_routine_scripts_tests() {
  local typecheck_block
  local routine_step_line
  local catalog_step_line

  typecheck_block=$(ci_typecheck_job_block)
  assert_contains "$typecheck_block" "      - name: Run routine scripts tests"
  assert_contains "$typecheck_block" \
    "        run: pnpm --filter @workspace/scripts run test"

  routine_step_line=$(grep -nF -- \
    "      - name: Run routine scripts tests" "$CI_WORKFLOW" | cut -d: -f1)
  catalog_step_line=$(grep -nF -- \
    "      - name: Test skill catalog contract" "$CI_WORKFLOW" | cut -d: -f1)
  if [[ -z "$routine_step_line" || -z "$catalog_step_line" ||
    "$routine_step_line" -le "$catalog_step_line" ]]; then
    printf \
      'Routine scripts tests must run after the skill catalog contract in %s.\n' \
      "$CI_WORKFLOW" >&2
    return 1
  fi
  echo "PASS: CI runs routine scripts tests after catalog contracts"
}

test_schema_safe_rollback_ci_contract() {
  local job_block
  local scripts_package
  local root_package

  job_block=$(ci_schema_safe_rollback_job_block)
  scripts_package=$(<"${SCRIPT_DIR}/../package.json")
  root_package=$(<"${SCRIPT_DIR}/../../package.json")
  assert_contains "$job_block" "    timeout-minutes: 20"
  assert_contains "$job_block" "          fetch-depth: 2"
  assert_contains "$job_block" "        run: pnpm run check:schema-safe-rollback"
  assert_contains "$job_block" "        if: always()"
  assert_contains "$job_block" "            cat rollback-rehearsal-report.md >> \"\$GITHUB_STEP_SUMMARY\""
  assert_contains "$job_block" "        uses: actions/upload-artifact@v4"
  assert_contains "$job_block" "          name: schema-safe-rollback-rehearsal"
  assert_contains "$job_block" "          path: rollback-rehearsal-report.md"
  assert_contains "$job_block" "          retention-days: 14"
  assert_contains "$scripts_package" \
    "\"check:schema-safe-rollback\": \"tsx ./src/rehearse-schema-safe-rollback.mts\""
  assert_contains "$root_package" \
    "\"check:schema-safe-rollback\": \"pnpm --filter @workspace/scripts run check:schema-safe-rollback\""
  echo "PASS: CI retains bounded schema-safe rollback rehearsal evidence"
}

test_stable_branch_protection_workflow_contract() {
  local workflow_content
  local check_block
  local upload_block
  local notification_block
  local check_log_placeholder="\$check_log"

  workflow_content=$(<"$STABLE_BRANCH_PROTECTION_WORKFLOW")
  assert_contains "$workflow_content" "  schedule:"
  assert_contains "$workflow_content" "    - cron: '17 6 * * 1'"
  assert_contains "$workflow_content" "  workflow_dispatch:"
  assert_contains "$workflow_content" "permissions:"
  assert_contains "$workflow_content" "  contents: read"
  assert_contains "$workflow_content" "  issues: write"
  assert_contains "$workflow_content" "    timeout-minutes: 5"

  check_block=$(stable_branch_protection_step_block "Check live main branch protection")
  assert_contains "$check_block" "GH_TOKEN: \${{ github.token }}"
  assert_contains "$check_block" "set +e"
  assert_contains "$check_block" "bash scripts/src/check-github-signed-commit-policy.sh"
  assert_contains "$check_block" "tee \"\$check_log\""
  assert_contains "$check_block" "check_status=\${PIPESTATUS[0]}"
  assert_contains "$check_block" "set -e"
  assert_contains "$check_block" "cat \"\$check_log\""
  assert_contains "$check_block" ">> \"\$GITHUB_STEP_SUMMARY\""
  assert_contains "$check_block" "exit \"\$check_status\""

  upload_block=$(stable_branch_protection_step_block "Retain protection check output")
  assert_contains "$upload_block" "if: always()"
  assert_contains "$upload_block" "uses: actions/upload-artifact@v4"
  assert_contains "$upload_block" "name: stable-branch-protection-check"
  assert_contains "$upload_block" \
    "path: \${{ runner.temp }}/stable-branch-protection-check.txt"
  assert_contains "$upload_block" "if-no-files-found: error"
  assert_contains "$upload_block" "retention-days: 14"

  notification_block=$(stable_branch_protection_step_block \
    "Notify maintainers of scheduled protection drift")
  assert_contains "$notification_block" \
    "if: failure() && github.event_name == 'schedule'"
  assert_contains "$notification_block" "uses: actions/github-script@v7"
  assert_contains "$notification_block" \
    "const title = '[Alert] Stable branch protection drift detected';"
  assert_contains "$notification_block" "github.paginate("
  assert_contains "$notification_block" "github.rest.issues.listForRepo"
  assert_contains "$notification_block" "state: 'open'"
  assert_contains "$notification_block" "!issue.pull_request && issue.title === title"
  assert_contains "$notification_block" "github.rest.issues.createComment"
  assert_contains "$notification_block" "issue_number: existing.number"
  assert_contains "$notification_block" "github.rest.issues.create"
  assert_contains "$notification_block" "Review the workflow run"
  if grep -Fq "cat \"${check_log_placeholder}\"" <<<"$notification_block"; then
    printf 'Notification must link to retained output, not copy repository details.\n' >&2
    return 1
  fi
  echo "PASS: preserves stable branch protection drift-monitoring contract"
}

test_stable_branch_protection_alert_fixture() {
  local fixture_repository="https://github.example/factory/stable-branch-protection-alert-fixture"
  local issue_url=""
  local comment_issue_url=""
  local issue_count=0
  local comment_count=0
  local scheduled_run_count=0
  local manual_run_count=0

  fixture_alert() {
    local event_name="$1"
    local conclusion="$2"
    local run_url="$3"

    if [[ "$event_name" == "schedule" ]]; then
      scheduled_run_count=$((scheduled_run_count + 1))
    elif [[ "$event_name" == "workflow_dispatch" ]]; then
      manual_run_count=$((manual_run_count + 1))
    fi

    if [[ "$conclusion" != "failure" || "$event_name" != "schedule" ]]; then
      return 0
    fi

    if (( issue_count == 0 )); then
      issue_count=1
      issue_url="${fixture_repository}/issues/1"
    else
      comment_count=$((comment_count + 1))
      comment_issue_url="$issue_url"
    fi

    [[ "$run_url" == "${fixture_repository}/actions/runs/"* ]]
  }

  fixture_alert \
    schedule \
    failure \
    "${fixture_repository}/actions/runs/1001"
  fixture_alert \
    schedule \
    failure \
    "${fixture_repository}/actions/runs/1002"

  [[ "$issue_count" -eq 1 ]] || {
    printf 'Expected the first scheduled failure to create one durable issue.\n' >&2
    return 1
  }
  [[ "$comment_count" -eq 1 ]] || {
    printf 'Expected the later scheduled failure to comment on that issue.\n' >&2
    return 1
  }
  [[ "$comment_issue_url" == "$issue_url" ]] || {
    printf 'Expected the repeat failure comment to use the durable issue URL.\n' >&2
    return 1
  }
  [[ "$issue_url" == "${fixture_repository}/issues/1" ]] || {
    printf 'Expected the fixture to retain its issue URL.\n' >&2
    return 1
  }

  local issue_count_before_manual="$issue_count"
  local comment_count_before_manual="$comment_count"
  fixture_alert \
    workflow_dispatch \
    failure \
    "${fixture_repository}/actions/runs/1003"

  [[ "$issue_count" -eq "$issue_count_before_manual" ]] || {
    printf 'Manual dispatch failure must not create an issue.\n' >&2
    return 1
  }
  [[ "$comment_count" -eq "$comment_count_before_manual" ]] || {
    printf 'Manual dispatch failure must not add a comment.\n' >&2
    return 1
  }
  [[ "$scheduled_run_count" -eq 2 && "$manual_run_count" -eq 1 ]] || {
    printf 'Expected two scheduled fixture runs and one manual fixture run.\n' >&2
    return 1
  }

  printf \
    'PASS: safe alert fixture issue=%s scheduled_runs=%s manual_runs=%s comments=%s protection_output=omitted\n' \
    "$issue_url" \
    "$scheduled_run_count" \
    "$manual_run_count" \
    "$comment_count"
}

assert_stopped_summary_workflow_contract() {
  local mode="$1"
  local upload_step="$2"
  local summary_step="$3"
  local artifact_step_id="$4"
  local checkpoint_dir="$5"
  local resume_command="$6"
  local regenerate_command="$7"
  local upload_line
  local summary_line
  local summary_block

  upload_line=$(grep -nF -- "      - name: ${upload_step}" "$RELEASE_WORKFLOW" | cut -d: -f1)
  summary_line=$(grep -nF -- "      - name: ${summary_step}" "$RELEASE_WORKFLOW" | cut -d: -f1)
  if [[ -z "$upload_line" || -z "$summary_line" ]]; then
    printf 'Expected %s upload and stopped-summary steps in %s.\n' \
      "$mode" "$RELEASE_WORKFLOW" >&2
    return 1
  fi
  if (( summary_line <= upload_line )); then
    printf '%s stopped-summary step must follow its evidence upload step.\n' "$mode" >&2
    return 1
  fi

  summary_block=$(workflow_step_block "$summary_step")
  assert_contains "$summary_block" "if: always()"
  assert_contains "$summary_block" "CHECKPOINT_DIR: ${checkpoint_dir}"
  assert_contains "$summary_block" \
    "CHECKPOINT_ARTIFACT_URL: \${{ steps.${artifact_step_id}.outputs.artifact-url }}"
  assert_contains "$summary_block" \
    "RELEASE_BASE_REPOSITORY: \${{ github.repository }}"
  assert_contains "$summary_block" \
    "RELEASE_HEAD_REPOSITORY: \${{ github.event.pull_request.head.repo.full_name || github.repository }}"
  assert_contains "$summary_block" "RELEASE_MODE: ${mode}"
  assert_contains "$summary_block" "RESUME_COMMAND: ${resume_command}"
  assert_contains "$summary_block" "REGENERATE_COMMAND: ${regenerate_command}"
  assert_contains "$summary_block" "bash scripts/src/release-stopped-summary.sh"
  echo "PASS: preserves ${mode} stopped-summary workflow contract"
}

test_release_workflow_preserves_stopped_summary_contract() {
  assert_stopped_summary_workflow_contract \
    standard \
    "Upload standard release evidence" \
    "Summarize stopped standard release check" \
    upload-standard-release-evidence \
    release-evidence \
    "pnpm run release:check -- --resume" \
    "pnpm run release:check"
  assert_stopped_summary_workflow_contract \
    full \
    "Upload full release evidence" \
    "Summarize stopped full release check" \
    upload-full-release-evidence \
    release-evidence-full \
    "pnpm run release:check:full -- --resume" \
    "pnpm run release:check:full"
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

test_accepts_quoted_ci_version_without_comment() {
  local workspace
  workspace=$(make_workspace_with_declarations quoted-no-comment \
    '"github-actionlint": "1.7.12"' \
    'ACTIONLINT_VERSION: "1.7.12"')
  run_check "$workspace"
  [[ "$CHECK_STATUS" -eq 0 ]] || {
    printf 'Expected a quoted CI version without a comment to pass. Output:\n%s\n' "$CHECK_OUTPUT" >&2
    return 1
  }
  assert_contains "$CHECK_OUTPUT" "local wrapper (scripts/package.json): 1.7.12"
  assert_contains "$CHECK_OUTPUT" "CI workflow (.github/workflows/workflow-lint.yml): 1.7.12"
  [[ -e "$FAKE_ACTIONLINT_MARKER" ]] || {
    printf 'Expected the accepted declaration to reach actionlint.\n' >&2
    return 1
  }
  echo "PASS: accepts quoted CI version without comment"
}

test_accepts_unquoted_ci_version_with_inline_comment() {
  local workspace
  workspace=$(make_workspace_with_declarations unquoted-inline-comment \
    '"github-actionlint": "1.7.12"' \
    'ACTIONLINT_VERSION: 1.7.12 # Keep CI aligned with the local wrapper')
  run_check "$workspace"
  [[ "$CHECK_STATUS" -eq 0 ]] || {
    printf 'Expected an unquoted CI version with an inline comment to pass. Output:\n%s\n' "$CHECK_OUTPUT" >&2
    return 1
  }
  assert_contains "$CHECK_OUTPUT" "local wrapper (scripts/package.json): 1.7.12"
  assert_contains "$CHECK_OUTPUT" "CI workflow (.github/workflows/workflow-lint.yml): 1.7.12"
  [[ -e "$FAKE_ACTIONLINT_MARKER" ]] || {
    printf 'Expected the accepted declaration to reach actionlint.\n' >&2
    return 1
  }
  echo "PASS: accepts unquoted CI version with inline comment"
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

test_ci_jobs_have_positive_timeouts() {
  local workspace
  workspace=$(make_workspace ci-timeouts 1.7.12 1.7.12)
  cp "$CI_WORKFLOW" "$workspace/.github/workflows/ci.yml"
  run_check "$workspace"
  [[ "$CHECK_STATUS" -eq 0 ]] || {
    printf 'Expected every current CI job timeout to pass. Output:\n%s\n' "$CHECK_OUTPUT" >&2
    return 1
  }
  assert_contains "$CHECK_OUTPUT" \
    "CI workflow jobs have positive timeout-minutes values."
  echo "PASS: checks positive timeouts for every CI job"
}

test_rejects_ci_job_without_timeout() {
  local workspace
  workspace=$(make_workspace ci-missing-timeout 1.7.12 1.7.12)
  cp "$CI_WORKFLOW" "$workspace/.github/workflows/ci.yml"
  cat >> "$workspace/.github/workflows/ci.yml" <<'EOF'
  future-check:
    name: Future check
    runs-on: ubuntu-latest
    steps:
      - run: echo ok
EOF
  run_check "$workspace"
  [[ "$CHECK_STATUS" -eq 1 ]] || {
    printf 'Expected a CI job without a timeout to fail. Output:\n%s\n' "$CHECK_OUTPUT" >&2
    return 1
  }
  assert_contains "$CHECK_OUTPUT" \
    "future-check: missing timeout-minutes"
  [[ ! -e "$FAKE_ACTIONLINT_MARKER" ]] || {
    printf 'Expected the missing CI timeout to fail before linting.\n' >&2
    return 1
  }
  echo "PASS: rejects a CI job without a timeout"
}

test_rejects_non_positive_ci_job_timeout() {
  local workspace
  workspace=$(make_workspace ci-zero-timeout 1.7.12 1.7.12)
  cp "$CI_WORKFLOW" "$workspace/.github/workflows/ci.yml"
  sed -i 's/^    timeout-minutes: 20$/    timeout-minutes: 0/' \
    "$workspace/.github/workflows/ci.yml"
  run_check "$workspace"
  [[ "$CHECK_STATUS" -eq 1 ]] || {
    printf 'Expected a non-positive CI timeout to fail. Output:\n%s\n' "$CHECK_OUTPUT" >&2
    return 1
  }
  assert_contains "$CHECK_OUTPUT" \
    "build: timeout-minutes must be a positive integer (found: 0)"
  [[ ! -e "$FAKE_ACTIONLINT_MARKER" ]] || {
    printf 'Expected the non-positive CI timeout to fail before linting.\n' >&2
    return 1
  }
  echo "PASS: rejects a non-positive CI timeout"
}

test_accepts_matching_versions
test_accepts_quoted_ci_version_with_inline_comment
test_accepts_quoted_ci_version_without_comment
test_accepts_unquoted_ci_version_with_inline_comment
test_rejects_mismatched_versions
test_rejects_missing_actionlint_declaration
test_rejects_missing_workflow_declaration_file
test_rejects_malformed_local_actionlint_declaration
test_rejects_malformed_ci_actionlint_declaration
test_rejects_invalid_local_actionlint_release
test_rejects_invalid_ci_actionlint_release
test_rejects_both_invalid_actionlint_releases
test_ci_jobs_have_positive_timeouts
test_rejects_ci_job_without_timeout
test_rejects_non_positive_ci_job_timeout
test_ci_runs_routine_scripts_tests
test_schema_safe_rollback_ci_contract
test_release_workflow_preserves_stopped_summary_contract
test_stable_branch_protection_workflow_contract
test_stable_branch_protection_alert_fixture
