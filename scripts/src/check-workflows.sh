#!/usr/bin/env bash

set -euo pipefail

workspace_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
workflow_dir="$workspace_root/.github/workflows"
actionlint_package="$workspace_root/scripts/package.json"
actionlint_workflow="$workflow_dir/workflow-lint.yml"

mapfile -t workflow_files < <(
  find "$workflow_dir" -type f \( -name '*.yml' -o -name '*.yaml' \) -print | sort
)

if (( ${#workflow_files[@]} == 0 )); then
  echo "Workflow lint failed: no GitHub Actions workflow files were found in $workflow_dir." >&2
  exit 1
fi

local_actionlint_version=""
if [[ -f "$actionlint_package" ]]; then
  local_actionlint_version="$(
    sed -nE \
      's/^[[:space:]]*"github-actionlint"[[:space:]]*:[[:space:]]*"([^"]+)"[[:space:]]*,?[[:space:]]*$/\1/p' \
      "$actionlint_package" | head -n1
  )"
fi

ci_actionlint_version=""
if [[ -f "$actionlint_workflow" ]]; then
  ci_actionlint_version="$(
    sed -nE \
      's/^[[:space:]]*ACTIONLINT_VERSION:[[:space:]]*"?([^[:space:]#"]+)"?[[:space:]]*(#.*)?$/\1/p' \
      "$actionlint_workflow" | head -n1
  )"
fi

echo "Configured actionlint versions:"
echo "  local wrapper (scripts/package.json): ${local_actionlint_version:-<missing>}"
echo "  CI workflow (.github/workflows/workflow-lint.yml): ${ci_actionlint_version:-<missing>}"

if [[ -z "$local_actionlint_version" || -z "$ci_actionlint_version" ]]; then
  if [[ ! -f "$actionlint_package" ]]; then
    echo "Missing local actionlint declaration: scripts/package.json." >&2
  fi
  if [[ ! -f "$actionlint_workflow" ]]; then
    echo "Missing CI actionlint declaration: .github/workflows/workflow-lint.yml." >&2
  fi
  cat >&2 <<'EOF'
Workflow lint version check failed because one or both actionlint versions are
not configured. Set the github-actionlint devDependency and ACTIONLINT_VERSION
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