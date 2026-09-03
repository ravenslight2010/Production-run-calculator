#!/usr/bin/env bash

set -euo pipefail

workspace_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
workflow_dir="$workspace_root/.github/workflows"
actionlint_package="$workspace_root/scripts/package.json"
actionlint_workflow="$workflow_dir/workflow-lint.yml"
ci_workflow="$workflow_dir/ci.yml"
release_workflow="$workflow_dir/release-check.yml"
nightly_large_spec_workflow="$workflow_dir/nightly-large-spec.yml"

mapfile -t workflow_files < <(
  find "$workflow_dir" -type f \( -name '*.yml' -o -name '*.yaml' \) -print | sort
)

if (( ${#workflow_files[@]} == 0 )); then
  echo "Workflow lint failed: no GitHub Actions workflow files were found in $workflow_dir." >&2
  exit 1
fi

local_actionlint_version=""
local_actionlint_state="missing"
if [[ -f "$actionlint_package" ]]; then
  if grep -Eq '^[[:space:]]*"github-actionlint"[[:space:]]*:' "$actionlint_package"; then
    local_actionlint_state="malformed"
  fi
  local_actionlint_version="$(
    sed -nE \
      's/^[[:space:]]*"github-actionlint"[[:space:]]*:[[:space:]]*"([^"]+)"[[:space:]]*,?[[:space:]]*$/\1/p' \
      "$actionlint_package" | head -n1
  )"
  if [[ -n "$local_actionlint_version" ]]; then
    local_actionlint_state="configured"
  fi
fi

ci_actionlint_version=""
ci_actionlint_state="missing"
if [[ -f "$actionlint_workflow" ]]; then
  if grep -Eq '^[[:space:]]*ACTIONLINT_VERSION:' "$actionlint_workflow"; then
    ci_actionlint_state="malformed"
  fi
  ci_actionlint_version="$(
    sed -nE \
      's/^[[:space:]]*ACTIONLINT_VERSION:[[:space:]]*"?([^[:space:]#"]+)"?[[:space:]]*(#.*)?$/\1/p' \
      "$actionlint_workflow" | head -n1
  )"
  if [[ -n "$ci_actionlint_version" ]]; then
    ci_actionlint_state="configured"
  fi
fi

local_actionlint_display="${local_actionlint_version:-<missing>}"
if [[ "$local_actionlint_state" == "malformed" ]]; then
  local_actionlint_display="<malformed>"
fi
ci_actionlint_display="${ci_actionlint_version:-<missing>}"
if [[ "$ci_actionlint_state" == "malformed" ]]; then
  ci_actionlint_display="<malformed>"
fi

actionlint_release_pattern='^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$'

echo "Configured actionlint versions:"
echo "  local wrapper (scripts/package.json): ${local_actionlint_display}"
echo "  CI workflow (.github/workflows/workflow-lint.yml): ${ci_actionlint_display}"

invalid_actionlint_release=0
if [[ "$local_actionlint_state" == "configured" &&
  ! "$local_actionlint_version" =~ $actionlint_release_pattern ]]; then
  echo "Invalid local actionlint release in scripts/package.json: ${local_actionlint_version}." >&2
  invalid_actionlint_release=1
fi
if [[ "$ci_actionlint_state" == "configured" &&
  ! "$ci_actionlint_version" =~ $actionlint_release_pattern ]]; then
  echo "Invalid CI actionlint release in .github/workflows/workflow-lint.yml: ${ci_actionlint_version}." >&2
  invalid_actionlint_release=1
fi
if (( invalid_actionlint_release )); then
  cat >&2 <<'EOF'
Workflow lint version check failed because an actionlint release is invalid.
Use a numeric major.minor.patch release such as 1.7.12.
EOF
  exit 1
fi

if [[ "$local_actionlint_state" != "configured" || "$ci_actionlint_state" != "configured" ]]; then
  if [[ "$local_actionlint_state" == "malformed" ]]; then
    echo "Malformed local actionlint declaration: scripts/package.json." >&2
  elif [[ "$local_actionlint_state" == "missing" ]]; then
    echo "Missing local actionlint declaration: scripts/package.json." >&2
  fi
  if [[ "$ci_actionlint_state" == "malformed" ]]; then
    echo "Malformed CI actionlint declaration: .github/workflows/workflow-lint.yml." >&2
  elif [[ "$ci_actionlint_state" == "missing" ]]; then
    echo "Missing CI actionlint declaration: .github/workflows/workflow-lint.yml." >&2
  fi
  cat >&2 <<'EOF'
Workflow lint version check failed because one or both actionlint versions are
not configured or malformed. Set the github-actionlint devDependency and ACTIONLINT_VERSION
to the same release.
EOF
  exit 1
fi

if [[ "$local_actionlint_version" != "$ci_actionlint_version" ]]; then
  cat >&2 <<'EOF'
Workflow lint version check failed: the local actionlint wrapper and CI use
different releases.

Update scripts/package.json and .github/workflows/workflow-lint.yml to the same
actionlint version, then run `pnpm install` to refresh pnpm-lock.yaml.
EOF
  exit 1
fi

check_workflow_timeouts() {
  local workflow_label="$1"
  local workflow_path="$2"

  if [[ ! -f "$workflow_path" ]]; then
    echo "${workflow_label} workflow timeout check failed: ${workflow_path} is missing." >&2
    return 1
  fi

  local timeout_check_output
  timeout_check_output="$(
    awk '
      function finish_job() {
        if (current_job == "") {
          return
        }
        checked_jobs++
        if (!saw_timeout) {
          print "  " current_job ": missing timeout-minutes"
          failures++
        } else if (timeout_value !~ /^[1-9][0-9]*$/) {
          print "  " current_job ": timeout-minutes must be a positive integer (found: " timeout_value ")"
          failures++
        }
      }

      $0 == "jobs:" {
        in_jobs = 1
        next
      }

      in_jobs && $0 ~ /^[^[:space:]]/ {
        finish_job()
        in_jobs = 0
        next
      }

      in_jobs && $0 ~ /^  [[:alnum:]_-]+:[[:space:]]*(#.*)?$/ {
        finish_job()
        current_job = $0
        sub(/^  /, "", current_job)
        sub(/:.*/, "", current_job)
        saw_timeout = 0
        timeout_value = ""
        next
      }

      in_jobs && current_job != "" && $0 ~ /^    timeout-minutes:[[:space:]]*/ {
        timeout_value = $0
        sub(/^    timeout-minutes:[[:space:]]*/, "", timeout_value)
        sub(/[[:space:]]+#.*/, "", timeout_value)
        gsub(/[[:space:]]/, "", timeout_value)
        saw_timeout = 1
        next
      }

      END {
        if (in_jobs) {
          finish_job()
        }
        if (checked_jobs == 0) {
          print "  no jobs found"
          failures++
        }
        exit(failures ? 1 : 0)
      }
    ' "$workflow_path"
  )" || {
    cat >&2 <<EOF
${workflow_label} workflow timeout check failed. Every job in ${workflow_path} must
declare a positive integer timeout-minutes value:
$timeout_check_output
EOF
    return 1
  }

  echo "${workflow_label} workflow jobs have positive timeout-minutes values."
}

check_workflow_timeouts "CI" "$ci_workflow"
check_workflow_timeouts "Release check" "$release_workflow"
check_workflow_timeouts "Nightly large-spec" "$nightly_large_spec_workflow"

if [[ -n "${ACTIONLINT_BIN:-}" ]]; then
  actionlint_bin="$ACTIONLINT_BIN"
elif command -v github-actionlint >/dev/null 2>&1; then
  # github-actionlint downloads and caches the official actionlint release
  # matching its pinned package version, so developers do not need to install
  # a separate system binary.
  actionlint_bin="$(command -v github-actionlint)"
elif command -v actionlint >/dev/null 2>&1; then
  # Keep the CI-installed binary as a fallback for environments that do not
  # install workspace dependencies before invoking this check.
  actionlint_bin="$(command -v actionlint)"
else
  cat >&2 <<'EOF'
Workflow lint could not run because actionlint is not available.

Run `pnpm install` to install the repository's pinned actionlint wrapper, then
retry `pnpm run check:workflows`. You can also set ACTIONLINT_BIN to an
explicit actionlint executable.
EOF
  exit 127
fi

echo "Validating ${#workflow_files[@]} GitHub Actions workflow files with actionlint..."

# SC2034 is limited to existing shell loop counters whose values are not used.
# Keep actionlint's YAML and GitHub expression validation enabled.
if ! "$actionlint_bin" -ignore 'SC2034' "${workflow_files[@]}"; then
  cat >&2 <<'EOF'

Workflow lint failed. Fix the reported workflow syntax or GitHub expression
errors, then run `pnpm run check:workflows` again before opening a PR.
EOF
  exit 1
fi

echo "GitHub Actions workflow syntax and expressions are valid."