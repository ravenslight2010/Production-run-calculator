#!/usr/bin/env bash

# Read-only validation of GitHub's native required-signed-commits rule.
# Authentication is delegated to the GitHub CLI; this script never reads,
# stores, or prints credentials.

set -euo pipefail

usage() {
  cat >&2 <<'EOF'
Usage: pnpm run check:github-signed-commit-policy -- --repo OWNER/REPOSITORY

The repository may also be supplied through GITHUB_REPOSITORY. The check always
validates the main branch and reads the GitHub CLI's existing authentication.
EOF
}

fail() {
  printf 'GitHub signed-commit policy check failed: %s\n' "$1" >&2
  exit 1
}

repo="${GITHUB_REPOSITORY:-}"
while (($# > 0)); do
  case "$1" in
    --)
      shift
      ;;
    --repo)
      (($# >= 2)) || fail "a repository is required after --repo"
      repo=$2
      shift 2
      ;;
    --repo=*)
      repo=${1#--repo=}
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

[[ "$repo" =~ ^[^/[:space:]]+/[^/[:space:]]+$ ]] \
  || fail "supply a repository as OWNER/REPOSITORY with --repo or GITHUB_REPOSITORY"
command -v gh >/dev/null 2>&1 \
  || fail "the GitHub CLI (gh) is required; authenticate it without putting credentials in the repository"

enabled=''
if ! enabled=$(gh api \
  --method GET \
  --header 'Accept: application/vnd.github+json' \
  --header 'X-GitHub-Api-Version: 2022-11-28' \
  --jq '.enabled // false' \
  "repos/${repo}/branches/main/protection/required_signatures" 2>/dev/null); then
  fail "could not read required-signatures protection for ${repo}:main; check GitHub CLI authentication and repository access"
fi

[[ "$enabled" == "true" ]] \
  || fail "GitHub does not report required signed commits for ${repo}:main"

printf 'GitHub policy active: %s:main requires signed commits.\n' "$repo"
