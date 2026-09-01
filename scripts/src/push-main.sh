#!/usr/bin/env bash

# Validate explicitly staged changes, commit them, and push directly to
# origin/main. This script intentionally does not stage files or rewrite the
# configured remote, so callers remain in control of both the change set and
# authentication.

set -euo pipefail

usage() {
  cat >&2 <<'EOF'
Usage: pnpm run push:main -- --message "Commit message"

Requires:
  - the current branch to be main
  - explicitly staged changes and no unstaged worktree changes
  - a configured origin remote
  - credentials that can push origin/main

The command runs `pnpm run typecheck` before creating the commit.
EOF
}

fail() {
  printf 'Guarded push aborted: %s\n' "$1" >&2
  exit 1
}

redact_git_output() {
  # Git normally redacts credentials itself, but remote hooks and custom
  # helpers can echo URLs. Do not repeat a credential-bearing URL verbatim.
  sed -E \
    -e 's#(https?://)[^/@[:space:]]+@#\1[credentials-redacted]@#g' \
    -e 's#(ssh://)[^/@[:space:]]+@#\1[credentials-redacted]@#g'
}

print_git_output() {
  if [[ -n "$1" ]]; then
    printf '%s\n' "$1" | redact_git_output >&2
  fi
}

message=''
while (($# > 0)); do
  case "$1" in
    --)
      shift
      ;;
    -m|--message)
      (($# >= 2)) || fail "a commit message is required after $1"
      message=$2
      shift 2
      ;;
    --message=*)
      message=${1#--message=}
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      usage
      fail "unknown argument: $1"
      ;;
  esac
done

if [[ -z "${message//[[:space:]]/}" ]]; then
  usage
  fail "a non-empty commit message is required"
fi

repo_root=$(git rev-parse --show-toplevel 2>/dev/null) \
  || fail "run this command from inside a Git worktree"
cd "$repo_root"

branch=$(git symbolic-ref --quiet --short HEAD 2>/dev/null) \
  || fail "the repository is in detached HEAD state; check out main"
[[ "$branch" == "main" ]] \
  || fail "expected branch main, but found $branch"

remote_url=$(git remote get-url origin 2>/dev/null) \
  || fail "the origin remote is not configured"
[[ -n "$remote_url" ]] \
  || fail "the origin remote is empty"

status_lines=$(git status --porcelain=v1 --untracked-files=all)
if [[ -n "$status_lines" ]]; then
  while IFS= read -r status_line; do
    [[ -n "$status_line" ]] || continue
    # Porcelain's second status column describes the worktree. Untracked
    # files are `??`, so they are also rejected as unstaged work.
    if [[ "${status_line:1:1}" != " " ]]; then
      fail "unstaged worktree changes detected; stage only the intended changes and retry"
    fi
  done <<< "$status_lines"
fi

if git diff --cached --quiet --exit-code; then
  fail "no staged changes found; stage the intended files explicitly and retry"
else
  diff_status=$?
  [[ "$diff_status" -eq 1 ]] \
    || fail "could not inspect staged changes (git diff exited $diff_status)"
fi

# Refresh origin/main before validation and commit. This turns a known
# non-fast-forward into a non-destructive refusal rather than creating a local
# commit that cannot be delivered. A missing remote main is allowed for the
# initial push; other fetch errors are actionable failures.
fetch_output=''
if ! fetch_output=$(git fetch origin main 2>&1); then
  if ! grep -Eqi "couldn't find remote ref main|could not find remote ref main|remote ref main not found" <<< "$fetch_output"; then
    print_git_output "$fetch_output"
    fail "could not read origin/main; check the origin remote and GitHub authentication"
  fi
fi

if git show-ref --verify --quiet refs/remotes/origin/main; then
  if git merge-base --is-ancestor refs/remotes/origin/main HEAD; then
    :
  else
    ancestry_status=$?
    if [[ "$ancestry_status" -eq 1 ]]; then
      fail "origin/main has commits that are not in local main; pull or reconcile them before retrying"
    fi
    fail "could not verify whether the push would be fast-forward"
  fi
fi

printf 'Running validation: pnpm run typecheck\n'
if ! pnpm run typecheck; then
  fail "validation failed; no commit or push was made"
fi

commit_output=''
if ! commit_output=$(git commit -m "$message" 2>&1); then
  print_git_output "$commit_output"
  fail "git commit failed; no push was attempted"
fi
print_git_output "$commit_output"

push_output=''
if ! push_output=$(git push --porcelain origin HEAD:main 2>&1); then
  print_git_output "$push_output"
  if grep -Eqi "authentication failed|could not read username|permission denied|access denied|unauthori[sz]ed|403|401" <<< "$push_output"; then
    fail "authentication failed while pushing origin/main; configure GitHub credentials for origin and retry (the commit remains local)"
  fi
  fail "push to origin/main was rejected or failed; inspect the message above (the commit remains local)"
fi
print_git_output "$push_output"
printf 'Guarded push complete: committed and pushed to origin/main.\n'