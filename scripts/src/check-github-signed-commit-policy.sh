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

workspace_root="${CHECK_REPOSITORY_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
policy_file="$workspace_root/.github/repository-policy.md"
ci_workflow="$workspace_root/.github/workflows/ci.yml"

check_required_workflow_contract() {
  local required_check
  local job_name
  local policy_check_count
  local ci_job_count
  local policy_checks_output
  local ci_job_names_output

  [[ -f "$policy_file" ]] || fail \
    "required-check contract file is missing: ${policy_file}"
  [[ -f "$ci_workflow" ]] || fail \
    "CI workflow for required-check contract is missing: ${ci_workflow}"

  policy_checks_output="$(
    awk '
      $0 == "The required GitHub Actions checks are:" {
        in_required_checks = 1
        next
      }
      in_required_checks && $0 ~ /^Each required check must be reported/ {
        exit
      }
      in_required_checks && $0 ~ /^- `[^`]+`$/ {
        check = $0
        sub(/^- `/, "", check)
        sub(/`$/, "", check)
        print check
      }
    ' "$policy_file"
  )"
  mapfile -t required_checks < <(printf '%s\n' "$policy_checks_output" | sed '/^$/d')
  policy_check_count="${#required_checks[@]}"
  [[ "$policy_check_count" -eq 6 ]] || fail \
    "required-check contract in ${policy_file} must list exactly six checks; found ${policy_check_count}"

  declare -A policy_check_names=()
  for required_check in "${required_checks[@]}"; do
    [[ -z "${policy_check_names[$required_check]+x}" ]] || fail \
      "required-check contract in ${policy_file} lists '${required_check}' more than once"
    policy_check_names["$required_check"]=1
  done

  ci_job_names_output="$(
    awk '
      function finish_job() {
        if (current_job_name != "") {
          print current_job_name
        }
        current_job_name = ""
      }

      $0 == "jobs:" {
        in_jobs = 1
        next
      }
      in_jobs && $0 ~ /^[^[:space:]]/ {
        finish_job()
        exit
      }
      in_jobs && $0 ~ /^  [[:alnum:]_-]+:[[:space:]]*(#.*)?$/ {
        finish_job()
        next
      }
      in_jobs && $0 ~ /^    name:[[:space:]]+/ {
        current_job_name = $0
        sub(/^    name:[[:space:]]+/, "", current_job_name)
        sub(/[[:space:]]+#.*$/, "", current_job_name)
      }

      END {
        finish_job()
      }
    ' "$ci_workflow"
  )"
  mapfile -t ci_job_names < <(printf '%s\n' "$ci_job_names_output" | sed '/^$/d')
  ci_job_count="${#ci_job_names[@]}"
  (( ci_job_count > 0 )) || fail \
    "required-check contract could not find any named jobs in ${ci_workflow}"

  declare -A ci_job_name_counts=()
  for job_name in "${ci_job_names[@]}"; do
    ci_job_name_counts["$job_name"]=$(( ${ci_job_name_counts[$job_name]:-0} + 1 ))
  done
  for job_name in "${!ci_job_name_counts[@]}"; do
    [[ "${ci_job_name_counts[$job_name]}" -eq 1 ]] || fail \
      "required-check contract cannot map duplicate CI job name '${job_name}' in ${ci_workflow}"
  done

  mapfile -t sorted_required_checks < <(
    printf '%s\n' "${required_checks[@]}" | LC_ALL=C sort
  )
  for required_check in "${sorted_required_checks[@]}"; do
    [[ -n "${ci_job_name_counts[$required_check]+x}" ]] || fail \
      "required check '${required_check}' from ${policy_file} has no matching named job in ${ci_workflow}; if the job was renamed, update the policy contract in the same change"
  done
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
check_required_workflow_contract
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
      ["allow_force_pushes", ((.allow_force_pushes.enabled // false) | tostring)],
      ["allow_deletions", ((.allow_deletions.enabled // false) | tostring)]
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
  'enforce_admins.enabled=false'
   'required_conversation_resolution.enabled=false'
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

expected_checks=()
for required_check in "${sorted_required_checks[@]}"; do
  expected_checks+=("${required_check}"$'\t15368')
done
if [[ "${#actual_checks[@]}" -ne "${#expected_checks[@]}" ]]; then
  fail "main protection field required_status_checks.checks: expected exactly ${#expected_checks[@]} GitHub Actions checks, got ${#actual_checks[@]}"
fi
for index in "${!expected_checks[@]}"; do
  [[ "${actual_checks[$index]}" == "${expected_checks[$index]}" ]] || \
    fail "main protection field required_status_checks.checks[${index}]: expected '${expected_checks[$index]}', got '${actual_checks[$index]}'"
done

printf 'GitHub policy active: %s:main requires signed commits, pull-request review, and six required checks.\n' "$repo"
