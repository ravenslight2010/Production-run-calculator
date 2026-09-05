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
fi

jq -r "$filter" "$fixture"
EOF
chmod +x "${FAKE_BIN}/gh"

write_valid_fixtures() {
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
      {"context": "Build (web + API)", "app_id": 15368},
      {"context": "Desktop and phone department journey", "app_id": 15368},
      {"context": "Release gates and retained standard evidence", "app_id": 15368}
    ]
  },
  "enforce_admins": {"enabled": true},
  "required_pull_request_reviews": {
    "required_approving_review_count": 1,
    "dismiss_stale_reviews": true
  },
  "required_conversation_resolution": {"enabled": true},
  "allow_force_pushes": false,
  "allow_deletions": false
}
EOF
  printf '{"enabled":true}\n' > "$SIGNATURE_FIXTURE"
}

run_check() {
  set +e
  CHECK_OUTPUT=$(
    PATH="${FAKE_BIN}:$PATH" \
      FAKE_GH_PROTECTION="$PROTECTION_FIXTURE" \
      FAKE_GH_SIGNATURES="$SIGNATURE_FIXTURE" \
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
  assert_contains "$CHECK_OUTPUT" "requires signed commits and complete branch protection"
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
  jq '.required_status_checks.checks |= .[0:7]' "$PROTECTION_FIXTURE" > "${PROTECTION_FIXTURE}.tmp"
  mv "${PROTECTION_FIXTURE}.tmp" "$PROTECTION_FIXTURE"
  run_check
  [[ "$CHECK_STATUS" -eq 1 ]] || {
    printf 'Expected required-check count mismatch to fail. Output:\n%s\n' "$CHECK_OUTPUT" >&2
    return 1
  }
  assert_contains "$CHECK_OUTPUT" \
    "main protection field required_status_checks.checks: expected exactly 8 GitHub Actions checks, got 7"
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
    "main protection field required_status_checks.checks[6]: expected 'Typecheck"
  assert_contains "$CHECK_OUTPUT" $'\t15368'
  assert_contains "$CHECK_OUTPUT" $'\t99999'
  echo "PASS: rejects a non-GitHub-Actions check identity"
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
    "could not read required-signatures protection for owner/repository:main"
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
  '.enforce_admins.enabled = false' \
  true false
test_rejects_field_mismatch \
  "required_conversation_resolution.enabled" \
  '.required_conversation_resolution.enabled = false' \
  true false
test_rejects_field_mismatch \
  "allow_force_pushes" \
  '.allow_force_pushes = true' \
  false true
test_rejects_field_mismatch \
  "allow_deletions" \
  '.allow_deletions = true' \
  false true
test_rejects_signed_commit_mismatch
test_rejects_check_count_mismatch
test_rejects_check_identity_mismatch
test_redacts_cli_errors
echo "All GitHub branch-protection policy tests passed."