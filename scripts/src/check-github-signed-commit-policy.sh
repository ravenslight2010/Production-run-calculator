#!/usr/bin/env bash

# Read-only validation of GitHub's native main-branch protection rule.
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

protection_endpoint() {
  printf 'repos/%s/branches/main/protection\n' "$repo"
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

protection_values=''
if ! protection_values=$(gh api \
  --method GET \
  --header 'Accept: application/vnd.github+json' \
  --header 'X-GitHub-Api-Version: 2022-11-28' \
  --jq '
    [
      ["required_status_checks.strict", ((.required_status_checks.strict // false) | tostring)],
      ["required_pull_request_reviews.required_approving_review_count", ((.required_pull_request_reviews.required_approving_review_count // 0) | tostring)],
      ["required_pull_request_reviews.dismiss_stale_reviews", ((.required_pull_request_reviews.dismiss_stale_reviews // false) | tostring)],
      ["enforce_admins.enabled", ((.enforce_admins.enabled // false) | tostring)],
      ["required_conversation_resolution.enabled", ((.required_conversation_resolution.enabled // false) | tostring)],
      ["allow_force_pushes", ((.allow_force_pushes // false) | tostring)],
      ["allow_deletions", ((.allow_deletions // false) | tostring)]
    ]
    + (
      (.required_status_checks.checks // [])
      | map(["required_status_checks.check", (.context // ""), ((.app_id // "null") | tostring)])
      | sort_by(.[1], .[2])
    )
    | .[]
    | @tsv
  ' \
  "$(protection_endpoint)" 2>/dev/null); then
  fail "could not read branch protection for ${repo}:main; check GitHub CLI authentication and repository access"
fi

declare -A actual_values=()
actual_checks=()
while IFS=$'\t' read -r field value app_id; do
  [[ -n "$field" ]] || continue
  if [[ "$field" == "required_status_checks.check" ]]; then
    actual_checks+=("${value}"$'\t'"${app_id}")
  else
    actual_values["$field"]="$value"
  fi
done <<< "$protection_values"

expected_fields=(
  'required_status_checks.strict=true'
  'required_pull_request_reviews.required_approving_review_count=1'
  'required_pull_request_reviews.dismiss_stale_reviews=true'
  'enforce_admins.enabled=true'
  'required_conversation_resolution.enabled=true'
  'allow_force_pushes=false'
  'allow_deletions=false'
)
for expected_field in "${expected_fields[@]}"; do
  field="${expected_field%%=*}"
  expected="${expected_field#*=}"
  actual="${actual_values[$field]-<missing>}"
  [[ "$actual" == "$expected" ]] || \
    fail "main protection field ${field}: expected ${expected}, got ${actual}"
done

expected_checks=(
  $'API tests (Postgres)\t15368'
  $'Build (web + API)\t15368'
  $'Desktop and phone department journey\t15368'
  $'Docker image\t15368'
  $'Release gates and retained standard evidence\t15368'
  $'Security audit (prod deps)\t15368'
  $'Typecheck\t15368'
  $'Unit tests (web + libs)\t15368'
)
if [[ "${#actual_checks[@]}" -ne "${#expected_checks[@]}" ]]; then
  fail "main protection field required_status_checks.checks: expected exactly ${#expected_checks[@]} GitHub Actions checks, got ${#actual_checks[@]}"
fi
for index in "${!expected_checks[@]}"; do
  [[ "${actual_checks[$index]}" == "${expected_checks[$index]}" ]] || \
    fail "main protection field required_status_checks.checks[${index}]: expected '${expected_checks[$index]}', got '${actual_checks[$index]}'"
done

printf 'GitHub policy active: %s:main requires signed commits and complete branch protection.\n' "$repo"
