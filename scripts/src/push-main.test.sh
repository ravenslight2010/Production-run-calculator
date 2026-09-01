#!/usr/bin/env bash

# The guarded push tests use only temporary repositories and local bare
# remotes. No test contacts the configured GitHub repository.

set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
PUSH_SCRIPT="${SCRIPT_DIR}/push-main.sh"
TEST_ROOT=$(mktemp -d)
FAKE_BIN="${TEST_ROOT}/bin"
mkdir -p "$FAKE_BIN"
trap 'rm -rf "$TEST_ROOT"' EXIT

cat > "${FAKE_BIN}/pnpm" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
if [[ "${1:-}" == "run" && "${2:-}" == "typecheck" ]]; then
  if [[ "${FAKE_PNPM_SHOULD_FAIL:-0}" == "1" ]]; then
    echo "simulated typecheck failure" >&2
    exit 23
  fi
  if [[ -n "${FAKE_PNPM_LOG:-}" ]]; then
    printf 'validated\n' >> "$FAKE_PNPM_LOG"
  fi
  exit 0
fi
echo "unexpected pnpm invocation: $*" >&2
exit 99
EOF
chmod +x "${FAKE_BIN}/pnpm"

make_repo() {
  local name="$1"
  local repo="${TEST_ROOT}/${name}"
  local remote="${TEST_ROOT}/${name}.git"
  mkdir -p "$repo"
  git init -q --bare "$remote"
  git -C "$repo" init -q -b main
  git -C "$repo" config user.email "guard-test@example.invalid"
  git -C "$repo" config user.name "Guard test"
  git -C "$repo" config commit.gpgsign false
  git -C "$repo" remote add origin "$remote"
  printf 'base\n' > "${repo}/tracked.txt"
  cp "$PUSH_SCRIPT" "${repo}/push-main.sh"
  git -C "$repo" add tracked.txt push-main.sh
  git -C "$repo" commit -q -m base
  git -C "$repo" push -q -u origin main
  printf '%s\n' "$repo"
}

run_push() {
  local repo="$1"
  shift
  set +e
  PUSH_OUTPUT=$(cd "$repo" && PATH="${FAKE_BIN}:$PATH" "$@" 2>&1)
  PUSH_STATUS=$?
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

assert_status() {
  local expected="$1"
  if [[ "$PUSH_STATUS" -ne "$expected" ]]; then
    printf 'Expected exit %s, got %s. Output:\n%s\n' "$expected" "$PUSH_STATUS" "$PUSH_OUTPUT" >&2
    return 1
  fi
}

assert_commit_count() {
  local repo="$1"
  local expected="$2"
  local actual
  actual=$(git -C "$repo" rev-list --count main)
  [[ "$actual" -eq "$expected" ]] || {
    printf 'Expected %s commits, got %s\n' "$expected" "$actual" >&2
    return 1
  }
}

test_requires_message_and_staged_changes() {
  local repo
  repo=$(make_repo missing-inputs)
  run_push "$repo" bash push-main.sh -- --help
  assert_status 0
  assert_contains "$PUSH_OUTPUT" "Usage: pnpm run push:main"

  run_push "$repo" bash push-main.sh
  assert_status 1
  assert_contains "$PUSH_OUTPUT" "non-empty commit message is required"

  run_push "$repo" bash push-main.sh --message "nothing staged"
  assert_status 1
  assert_contains "$PUSH_OUTPUT" "no staged changes found"
}

test_rejects_branch_and_unstaged_work() {
  local repo
  repo=$(make_repo safety)
  printf 'change\n' >> "${repo}/tracked.txt"
  git -C "$repo" add tracked.txt
  printf 'unstaged\n' >> "${repo}/tracked.txt"
  run_push "$repo" bash push-main.sh --message "should not commit"
  assert_status 1
  assert_contains "$PUSH_OUTPUT" "unstaged worktree changes detected"
  assert_commit_count "$repo" 1

  git -C "$repo" checkout -q -b feature
  git -C "$repo" restore tracked.txt
  printf 'change\n' >> "${repo}/tracked.txt"
  git -C "$repo" add tracked.txt
  run_push "$repo" bash push-main.sh --message "wrong branch"
  assert_status 1
  assert_contains "$PUSH_OUTPUT" "expected branch main"
  assert_commit_count "$repo" 1
}

test_rejects_missing_origin() {
  local repo
  repo=$(make_repo missing-origin)
  git -C "$repo" remote remove origin
  printf 'change without origin\n' >> "${repo}/tracked.txt"
  git -C "$repo" add tracked.txt
  run_push "$repo" bash push-main.sh --message "missing origin"
  assert_status 1
  assert_contains "$PUSH_OUTPUT" "origin remote is not configured"
  assert_commit_count "$repo" 1
}

test_validation_failure_does_not_commit_or_push() {
  local repo="${TEST_ROOT}/validation"
  repo=$(make_repo validation)
  printf 'validated change\n' >> "${repo}/tracked.txt"
  git -C "$repo" add tracked.txt
  validation_log="${repo}/validation.log"
  run_push "$repo" env FAKE_PNPM_SHOULD_FAIL=1 FAKE_PNPM_LOG="$validation_log" bash push-main.sh --message "blocked"
  assert_status 1
  assert_contains "$PUSH_OUTPUT" "validation failed; no commit or push was made"
  assert_commit_count "$repo" 1
  [[ ! -e "$validation_log" ]] || {
    printf 'Validation log should not be created on a failing validation.\n' >&2
    return 1
  }
  [[ "$(git --git-dir="${repo}/.git" rev-parse refs/remotes/origin/main)" == "$(git -C "$repo" rev-parse main)" ]]
}

test_success_commits_and_targets_origin_main() {
  local repo
  repo=$(make_repo success)
  printf 'successful change\n' >> "${repo}/tracked.txt"
  git -C "$repo" add tracked.txt
  validation_log="${repo}/validation.log"
  run_push "$repo" env FAKE_PNPM_LOG="$validation_log" bash push-main.sh --message "successful guarded push"
  assert_status 0
  assert_contains "$PUSH_OUTPUT" "Guarded push complete"
  assert_commit_count "$repo" 2
  [[ "$(git --git-dir="${repo}/.git" rev-parse refs/remotes/origin/main)" == "$(git -C "$repo" rev-parse main)" ]]
  [[ "$(git --git-dir="${TEST_ROOT}/success.git" rev-parse refs/heads/main)" == "$(git -C "$repo" rev-parse main)" ]]
  [[ "$(cat "$validation_log")" == "validated" ]]
}

configure_ssh_signing() {
  local repo="$1"
  local key="${TEST_ROOT}/guard-signing-key"
  local allowed_signers="${TEST_ROOT}/guard-allowed-signers"

  ssh-keygen -q -t ed25519 -N '' -C "guard-test@example.invalid" -f "$key"
  printf 'guard-test@example.invalid namespaces="git" ' > "$allowed_signers"
  cat "${key}.pub" >> "$allowed_signers"

  git -C "$repo" config push.main.requireSigned true
  git -C "$repo" config gpg.format ssh
  git -C "$repo" config user.signingkey "$key"
  git -C "$repo" config commit.gpgsign true
  git -C "$repo" config gpg.ssh.allowedSignersFile "$allowed_signers"
}

test_signed_commit_is_accepted_when_signing_is_required() {
  local repo
  repo=$(make_repo signed-required)
  configure_ssh_signing "$repo"
  printf 'signed change\n' >> "${repo}/tracked.txt"
  git -C "$repo" add tracked.txt

  run_push "$repo" bash push-main.sh --message "signed guarded push"
  assert_status 0
  assert_contains "$PUSH_OUTPUT" "Guarded push complete"
  assert_commit_count "$repo" 2
  git -C "$repo" verify-commit HEAD >/dev/null 2>&1
  [[ "$(git --git-dir="${TEST_ROOT}/signed-required.git" rev-parse refs/heads/main)" == "$(git -C "$repo" rev-parse main)" ]]
}

test_unsigned_commit_is_rejected_when_signing_is_required() {
  local repo
  repo=$(make_repo unsigned-required)
  git -C "$repo" config push.main.requireSigned true
  printf 'unsigned change\n' >> "${repo}/tracked.txt"
  git -C "$repo" add tracked.txt

  run_push "$repo" bash push-main.sh --message "unsigned guarded push"
  assert_status 1
  assert_contains "$PUSH_OUTPUT" "signed commit required by push.main.requireSigned"
  assert_not_contains "$PUSH_OUTPUT" "Guarded push complete"
  assert_commit_count "$repo" 2
  if git -C "$repo" verify-commit HEAD >/dev/null 2>&1; then
    printf 'The unsigned test unexpectedly created a verifiable signature.\n' >&2
    return 1
  fi
  [[ "$(git --git-dir="${TEST_ROOT}/unsigned-required.git" rev-parse refs/heads/main)" != "$(git -C "$repo" rev-parse main)" ]]
}

test_rejects_known_remote_divergence_before_commit() {
  local repo remote diverged
  repo=$(make_repo divergence)
  remote="${TEST_ROOT}/divergence.git"

  git clone -q --branch main "$remote" "${TEST_ROOT}/divergent-clone"
  git -C "${TEST_ROOT}/divergent-clone" config user.email "guard-test@example.invalid"
  git -C "${TEST_ROOT}/divergent-clone" config user.name "Guard test"
  printf 'remote change\n' >> "${TEST_ROOT}/divergent-clone/tracked.txt"
  git -C "${TEST_ROOT}/divergent-clone" add tracked.txt
  git -C "${TEST_ROOT}/divergent-clone" commit -q -m "remote change"
  git -C "${TEST_ROOT}/divergent-clone" push -q origin main
  diverged=$(git --git-dir="$remote" rev-parse refs/heads/main)

  printf 'local change\n' >> "${repo}/tracked.txt"
  git -C "$repo" add tracked.txt
  run_push "$repo" bash push-main.sh --message "not safe"
  assert_status 1
  assert_contains "$PUSH_OUTPUT" "origin/main has commits"
  assert_commit_count "$repo" 1
  [[ "$(git --git-dir="$remote" rev-parse refs/heads/main)" == "$diverged" ]]
}

test_rejected_push_redacts_credentials() {
  local repo remote hook_output
  repo=$(make_repo rejected)
  remote="${TEST_ROOT}/rejected.git"
  hook_output="https://user:super-secret@example.invalid/repo.git"
  cat > "${remote}/hooks/pre-receive" <<EOF
#!/usr/bin/env bash
echo "authentication failed for '${hook_output}'" >&2
exit 1
EOF
  chmod +x "${remote}/hooks/pre-receive"

  printf 'rejected change\n' >> "${repo}/tracked.txt"
  git -C "$repo" add tracked.txt
  run_push "$repo" bash push-main.sh --message "rejected push"
  assert_status 1
  assert_contains "$PUSH_OUTPUT" "authentication failed while pushing origin/main"
  assert_not_contains "$PUSH_OUTPUT" "super-secret"
  assert_commit_count "$repo" 2
  [[ "$(git --git-dir="$remote" rev-parse refs/heads/main)" != "$(git -C "$repo" rev-parse main)" ]]
}

test_requires_message_and_staged_changes
test_rejects_branch_and_unstaged_work
test_rejects_missing_origin
test_validation_failure_does_not_commit_or_push
test_success_commits_and_targets_origin_main
test_signed_commit_is_accepted_when_signing_is_required
test_unsigned_commit_is_rejected_when_signing_is_required
test_rejects_known_remote_divergence_before_commit
test_rejected_push_redacts_credentials
printf 'All guarded GitHub push tests passed.\n'