#!/usr/bin/env bash

# Offline regression tests for the read-only GitHub branch-protection checker.
# The fake GitHub CLI reads local fixtures and never contacts GitHub.

set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
CHECK_SCRIPT="${SCRIPT_DIR}/check-github-signed-commit-policy.sh"
TEST_ROOT=$(mktemp -d)
FAKE_BIN="${TEST_ROOT}/bin"
PROTECTION_FIXTURE="${TEST_ROOT}/protection.json"
SIGNATURE_FIXTURE="${TEST_ROOT}/signatures.json"
RULESETS_FIXTURE="${TEST_ROOT}/rulesets.json"
REPOSITORY_FIXTURE="${TEST_ROOT}/repository"
trap 'rm -rf "$TEST_ROOT"' EXIT

mkdir -p "$FAKE_BIN"
cat > "${FAKE_BIN}/gh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

endpoint="${@: -1}"
if [[ "${FAKE_GH_FAIL:-0}" == "1" ]]; then
  echo "authentication failed for https://user:super-secret@example.invalid/repo.git" >&2
  exit 1
fi
if [[ "$endpoint" == */rulesets* && "${FAKE_GH_RULESETS_FAIL:-0}" == "1" ]]; then
  echo "ruleset access denied for https://user:super-secret@example.invalid/repo.git" >&2
  exit 1
fi

filter=''
previous=''
for argument in "$@"; do
  if [[ "$previous" == "--jq" ]]; then
    filter="$argument"
    break
  fi
  previous="$argument"
done

fixture="${FAKE_GH_SIGNATURES}"
if [[ "$endpoint" == */branches/main/protection ]]; then
  fixture="${FAKE_GH_PROTECTION}"
elif [[ "$endpoint" == */rulesets* ]]; then
  fixture="${FAKE_GH_RULESETS}"
fi

if [[ -n "$filter" ]]; then
  jq -r "$filter" "$fixture"
else
  cat "$fixture"
fi
EOF
chmod +x "${FAKE_BIN}/gh"

write_valid_fixtures() {
  mkdir -p "${REPOSITORY_FIXTURE}/.github/workflows"
  cp "${SCRIPT_DIR}/../../.github/repository-policy.md" \
    "${REPOSITORY_FIXTURE}/.github/repository-policy.md"
  cp "${SCRIPT_DIR}/../../.github/workflows/ci.yml" \
    "${REPOSITORY_FIXTURE}/.github/workflows/ci.yml"
  cat > "$PROTECTION_FIXTURE" <<'EOF'
{
  "required_status_checks": {
    "strict": true,
    "checks": [
      {"context": "Typecheck", "app_id": 15368},
      {"context": "Unit tests (web + libs)", "app_id": 15368},
      {"context": "API tests (Postgres)", "app_id": 15368},
        {"context": "Security audit (prod deps)", "app_id": 15368},
      {"context": "Docker image", "app_id": 15368},
        {"context": "Build (web + API)", "app_id": 15368}
    ]
  },
  "enforce_admins": {"enabled": false},
  "required_pull_request_reviews": {
    "required_approving_review_count": 1,
    "dismiss_stale_reviews": true
  },
  "required_conversation_resolution": {"enabled": false},
  "allow_force_pushes": {"enabled": false},
  "allow_deletions": {"enabled": false}
}
EOF
  printf '{"enabled":true}\n' > "$SIGNATURE_FIXTURE"
  printf '[]\n' > "$RULESETS_FIXTURE"
}

run_check() {
  set +e
  CHECK_OUTPUT=$(
    PATH="${FAKE_BIN}:$PATH" \
      CHECK_REPOSITORY_ROOT="$REPOSITORY_FIXTURE" \
      FAKE_GH_PROTECTION="$PROTECTION_FIXTURE" \
      FAKE_GH_SIGNATURES="$SIGNATURE_FIXTURE" \
      FAKE_GH_RULESETS="$RULESETS_FIXTURE" \
      bash "$CHECK_SCRIPT" --repo owner/repository 2>&1
  )
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

assert_not_contains() {
  local haystack="$1"
  local needle="$2"
  if [[ "$haystack" == *"$needle"* ]]; then
    printf 'Expected output not to contain: %s\nActual output:\n%s\n' "$needle" "$haystack" >&2
    return 1
  fi
}

test_accepts_complete_policy() {
  write_valid_fixtures
  run_check
  [[ "$CHECK_STATUS" -eq 0 ]] || {
    printf 'Expected the complete policy to pass. Output:\n%s\n' "$CHECK_OUTPUT" >&2
    return 1
  }
  assert_contains "$CHECK_OUTPUT" \
    "requires signed commits, pull-request review, and six required checks"
  echo "PASS: accepts the complete main-branch policy"
}

test_rejects_field_mismatch() {
  local field="$1"
  local mutation="$2"
  local expected="$3"
  local actual="$4"

  write_valid_fixtures
  jq "$mutation" "$PROTECTION_FIXTURE" > "${PROTECTION_FIXTURE}.tmp"
  mv "${PROTECTION_FIXTURE}.tmp" "$PROTECTION_FIXTURE"
  run_check
  [[ "$CHECK_STATUS" -eq 1 ]] || {
    printf 'Expected %s mismatch to fail. Output:\n%s\n' "$field" "$CHECK_OUTPUT" >&2
    return 1
  }
  assert_contains "$CHECK_OUTPUT" \
    "main protection field ${field}: expected ${expected}, got ${actual}"
  echo "PASS: rejects ${field} mismatch"
}

test_rejects_signed_commit_mismatch() {
  write_valid_fixtures
  printf '{"enabled":false}\n' > "$SIGNATURE_FIXTURE"
  run_check
  [[ "$CHECK_STATUS" -eq 1 ]] || {
    printf 'Expected signed-commit mismatch to fail. Output:\n%s\n' "$CHECK_OUTPUT" >&2
    return 1
  }
  assert_contains "$CHECK_OUTPUT" \
    "GitHub does not report required signed commits for owner/repository:main"
  echo "PASS: rejects signed-commit mismatch"
}

test_rejects_check_count_mismatch() {
  write_valid_fixtures
  jq '.required_status_checks.checks |= .[0:5]' "$PROTECTION_FIXTURE" > "${PROTECTION_FIXTURE}.tmp"
  mv "${PROTECTION_FIXTURE}.tmp" "$PROTECTION_FIXTURE"
  run_check
  [[ "$CHECK_STATUS" -eq 1 ]] || {
    printf 'Expected required-check count mismatch to fail. Output:\n%s\n' "$CHECK_OUTPUT" >&2
    return 1
  }
  assert_contains "$CHECK_OUTPUT" \
    "main protection field required_status_checks.checks: expected exactly 6 GitHub Actions checks, got 5"
  echo "PASS: rejects a missing required check"
}

test_rejects_check_identity_mismatch() {
  write_valid_fixtures
  jq '(.required_status_checks.checks[] | select(.context == "Typecheck")).app_id = 99999' \
    "$PROTECTION_FIXTURE" > "${PROTECTION_FIXTURE}.tmp"
  mv "${PROTECTION_FIXTURE}.tmp" "$PROTECTION_FIXTURE"
  run_check
  [[ "$CHECK_STATUS" -eq 1 ]] || {
    printf 'Expected required-check app identity mismatch to fail. Output:\n%s\n' "$CHECK_OUTPUT" >&2
    return 1
  }
  assert_contains "$CHECK_OUTPUT" \
    "main protection field required_status_checks.checks[4]: expected 'Typecheck"
  assert_contains "$CHECK_OUTPUT" $'\t15368'
  assert_contains "$CHECK_OUTPUT" $'\t99999'
  echo "PASS: rejects a non-GitHub-Actions check identity"
}

test_rejects_renamed_ci_job_without_policy_update() {
  write_valid_fixtures
  sed -i 's/^    name: Typecheck$/    name: Typecheck renamed/' \
    "${REPOSITORY_FIXTURE}/.github/workflows/ci.yml"
  run_check
  [[ "$CHECK_STATUS" -eq 1 ]] || {
    printf 'Expected a CI job rename without a policy update to fail. Output:\n%s\n' \
      "$CHECK_OUTPUT" >&2
    return 1
  }
  assert_contains "$CHECK_OUTPUT" \
    "required check 'Typecheck' from ${REPOSITORY_FIXTURE}/.github/repository-policy.md has no matching named job in ${REPOSITORY_FIXTURE}/.github/workflows/ci.yml"
  assert_contains "$CHECK_OUTPUT" \
    "if the job was renamed, update the policy contract in the same change"
  echo "PASS: rejects a renamed required CI job without a policy update"
}

test_accepts_explicit_ci_job_rename_policy_update() {
  write_valid_fixtures
  sed -i 's/^    name: Typecheck$/    name: Typecheck renamed/' \
    "${REPOSITORY_FIXTURE}/.github/workflows/ci.yml"
  sed -i "s/^- \`Typecheck\`$/- \`Typecheck renamed\`/" \
    "${REPOSITORY_FIXTURE}/.github/repository-policy.md"
  jq '(.required_status_checks.checks[] | select(.context == "Typecheck")).context = "Typecheck renamed"' \
    "$PROTECTION_FIXTURE" > "${PROTECTION_FIXTURE}.tmp"
  mv "${PROTECTION_FIXTURE}.tmp" "$PROTECTION_FIXTURE"
  run_check
  [[ "$CHECK_STATUS" -eq 0 ]] || {
    printf 'Expected an explicitly updated CI job rename to pass. Output:\n%s\n' \
      "$CHECK_OUTPUT" >&2
    return 1
  }
  echo "PASS: accepts a CI job rename with an explicit policy update"
}

test_accepts_comments_and_quoted_ci_job_names() {
  write_valid_fixtures
  sed -i 's/^jobs:$/jobs: # CI required-check jobs/' \
    "${REPOSITORY_FIXTURE}/.github/workflows/ci.yml"
  sed -i 's/^  typecheck:$/  "typecheck": # YAML-quoted job ID/' \
    "${REPOSITORY_FIXTURE}/.github/workflows/ci.yml"
  sed -i 's/^    name: Typecheck$/    name: "Typecheck" # quoted display name/' \
    "${REPOSITORY_FIXTURE}/.github/workflows/ci.yml"
  sed -i "s/^    name: Release concurrency fixture tests$/    name: 'Release # concurrency' # quoted display name/" \
    "${REPOSITORY_FIXTURE}/.github/workflows/ci.yml"
  run_check
  [[ "$CHECK_STATUS" -eq 0 ]] || {
    printf 'Expected comments and quoted CI job names to pass. Output:\n%s\n' \
      "$CHECK_OUTPUT" >&2
    return 1
  }
  echo "PASS: accepts comments and quoted CI job names"
}

test_rejects_unsupported_ci_job_name_layout() {
  write_valid_fixtures
  sed -i '/^    name: Typecheck$/c\
    name: >-\
      Typecheck' "${REPOSITORY_FIXTURE}/.github/workflows/ci.yml"
  run_check
  [[ "$CHECK_STATUS" -eq 1 ]] || {
    printf 'Expected an unsupported CI job name layout to fail. Output:\n%s\n' \
      "$CHECK_OUTPUT" >&2
    return 1
  }
  assert_contains "$CHECK_OUTPUT" \
    "unsupported CI workflow layout in ${REPOSITORY_FIXTURE}/.github/workflows/ci.yml"
  assert_contains "$CHECK_OUTPUT" \
    "job name must be a one-line plain or quoted scalar"
  echo "PASS: rejects an unsupported CI job name layout"
}

test_rejects_incomplete_required_check_contract() {
  write_valid_fixtures
  sed -i "/^- \`Typecheck\`$/d" \
    "${REPOSITORY_FIXTURE}/.github/repository-policy.md"
  run_check
  [[ "$CHECK_STATUS" -eq 1 ]] || {
    printf 'Expected an incomplete required-check contract to fail. Output:\n%s\n' \
      "$CHECK_OUTPUT" >&2
    return 1
  }
  assert_contains "$CHECK_OUTPUT" \
    "required-check contract in ${REPOSITORY_FIXTURE}/.github/repository-policy.md must list exactly six checks; found 5"
  echo "PASS: rejects an incomplete required-check contract"
}

write_matching_ruleset_fixture() {
  jq -n '
    [{
      "id": 17,
      "name": "Main checks",
      "target": "branch",
      "enforcement": "active",
      "conditions": {"ref_name": {"include": ["refs/heads/main"], "exclude": []}},
      "rules": [{
        "type": "required_status_checks",
        "parameters": {
          "required_status_checks": [
            {"context": "Typecheck", "integration_id": 15368},
            {"context": "Unit tests (web + libs)", "integration_id": 15368},
            {"context": "API tests (Postgres)", "integration_id": 15368},
            {"context": "Security audit (prod deps)", "integration_id": 15368},
            {"context": "Docker image", "integration_id": 15368},
            {"context": "Build (web + API)", "integration_id": 15368}
          ]
        }
      }]
    }]
  ' > "$RULESETS_FIXTURE"
}

test_accepts_matching_main_ruleset() {
  write_valid_fixtures
  write_matching_ruleset_fixture
  run_check
  [[ "$CHECK_STATUS" -eq 0 ]] || {
    printf 'Expected a matching main ruleset to pass. Output:\n%s\n' "$CHECK_OUTPUT" >&2
    return 1
  }
  assert_contains "$CHECK_OUTPUT" \
    "Classic branch protection: verified for owner/repository:main."
  assert_contains "$CHECK_OUTPUT" \
    "Ruleset verification: verified 1 active main-branch ruleset(s) with the six-check GitHub Actions contract."
  echo "PASS: accepts a matching main-branch ruleset"
}

test_rejects_ruleset_check_mismatch() {
  write_valid_fixtures
  write_matching_ruleset_fixture
  jq '.[0].rules[0].parameters.required_status_checks[0].integration_id = 99999' \
    "$RULESETS_FIXTURE" > "${RULESETS_FIXTURE}.tmp"
  mv "${RULESETS_FIXTURE}.tmp" "$RULESETS_FIXTURE"
  run_check
  [[ "$CHECK_STATUS" -eq 1 ]] || {
    printf 'Expected a ruleset app identity mismatch to fail. Output:\n%s\n' "$CHECK_OUTPUT" >&2
    return 1
  }
  assert_contains "$CHECK_OUTPUT" \
    "ruleset required check 4: expected 'Typecheck"
  assert_contains "$CHECK_OUTPUT" $'\t15368'
  assert_contains "$CHECK_OUTPUT" $'\t99999'
  echo "PASS: rejects a ruleset check identity mismatch"
}

test_ignores_non_main_rulesets() {
  write_valid_fixtures
  jq -n '[
    {
      "target": "branch",
      "enforcement": "active",
      "conditions": {"ref_name": {"include": ["refs/heads/release"], "exclude": []}},
      "rules": [{"type": "required_status_checks", "parameters": {"required_status_checks": []}}]
    },
    {
      "target": "branch",
      "enforcement": "disabled",
      "conditions": {"ref_name": {"include": ["refs/heads/main"], "exclude": []}},
      "rules": [{"type": "required_status_checks", "parameters": {"required_status_checks": []}}]
    }
  ]' > "$RULESETS_FIXTURE"
  run_check
  [[ "$CHECK_STATUS" -eq 0 ]] || {
    printf 'Expected non-applicable rulesets to be ignored. Output:\n%s\n' "$CHECK_OUTPUT" >&2
    return 1
  }
  assert_contains "$CHECK_OUTPUT" \
    "Ruleset verification: no active main-branch ruleset is configured for owner/repository:main."
  echo "PASS: ignores inactive and non-main rulesets"
}

test_reports_ruleset_access_unavailable() {
  write_valid_fixtures
  set +e
  CHECK_OUTPUT=$(
    PATH="${FAKE_BIN}:$PATH" \
      CHECK_REPOSITORY_ROOT="$REPOSITORY_FIXTURE" \
      FAKE_GH_PROTECTION="$PROTECTION_FIXTURE" \
      FAKE_GH_SIGNATURES="$SIGNATURE_FIXTURE" \
      FAKE_GH_RULESETS="$RULESETS_FIXTURE" \
      FAKE_GH_RULESETS_FAIL=1 \
      bash "$CHECK_SCRIPT" --repo owner/repository 2>&1
  )
  CHECK_STATUS=$?
  set -e
  [[ "$CHECK_STATUS" -eq 1 ]] || {
    printf 'Expected unavailable ruleset access to fail. Output:\n%s\n' "$CHECK_OUTPUT" >&2
    return 1
  }
  assert_contains "$CHECK_OUTPUT" \
    "Ruleset verification unavailable for owner/repository:main"
  assert_not_contains "$CHECK_OUTPUT" "super-secret"
  echo "PASS: reports unavailable ruleset access without raw CLI output"
}

test_redacts_cli_errors() {
  write_valid_fixtures
  set +e
  CHECK_OUTPUT=$(
    PATH="${FAKE_BIN}:$PATH" \
      FAKE_GH_PROTECTION="$PROTECTION_FIXTURE" \
      FAKE_GH_SIGNATURES="$SIGNATURE_FIXTURE" \
      FAKE_GH_FAIL=1 \
      bash "$CHECK_SCRIPT" --repo owner/repository 2>&1
  )
  CHECK_STATUS=$?
  set -e
  [[ "$CHECK_STATUS" -eq 1 ]] || {
    printf 'Expected a CLI error to fail. Output:\n%s\n' "$CHECK_OUTPUT" >&2
    return 1
  }
  assert_contains "$CHECK_OUTPUT" \
    "Classic branch protection verification unavailable for owner/repository:main; could not read required-signatures protection"
  assert_not_contains "$CHECK_OUTPUT" "super-secret"
  echo "PASS: suppresses credentials from CLI errors"
}

test_accepts_complete_policy
test_rejects_field_mismatch \
  "required_status_checks.strict" \
  '.required_status_checks.strict = false' \
  true false
test_rejects_field_mismatch \
  "required_pull_request_reviews.required_approving_review_count" \
  '.required_pull_request_reviews.required_approving_review_count = 0' \
  1 0
test_rejects_field_mismatch \
  "required_pull_request_reviews.dismiss_stale_reviews" \
  '.required_pull_request_reviews.dismiss_stale_reviews = false' \
  true false
test_rejects_field_mismatch \
  "enforce_admins.enabled" \
  '.enforce_admins.enabled = true' \
  false true
test_rejects_field_mismatch \
  "required_conversation_resolution.enabled" \
  '.required_conversation_resolution.enabled = true' \
  false true
test_rejects_field_mismatch \
  "allow_force_pushes" \
  '.allow_force_pushes.enabled = true' \
  false true
test_rejects_field_mismatch \
  "allow_deletions" \
  '.allow_deletions.enabled = true' \
  false true
test_rejects_signed_commit_mismatch
test_rejects_check_count_mismatch
test_rejects_check_identity_mismatch
test_rejects_renamed_ci_job_without_policy_update
test_accepts_explicit_ci_job_rename_policy_update
test_accepts_comments_and_quoted_ci_job_names
test_rejects_unsupported_ci_job_name_layout
test_rejects_incomplete_required_check_contract
test_accepts_matching_main_ruleset
test_rejects_ruleset_check_mismatch
test_ignores_non_main_rulesets
test_reports_ruleset_access_unavailable
test_redacts_cli_errors
echo "All GitHub branch-protection policy tests passed."