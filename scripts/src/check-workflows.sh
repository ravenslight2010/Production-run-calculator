#!/usr/bin/env bash

set -euo pipefail

workspace_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
workflow_dir="$workspace_root/.github/workflows"

mapfile -t workflow_files < <(
  find "$workflow_dir" -type f \( -name '*.yml' -o -name '*.yaml' \) -print | sort
)

if (( ${#workflow_files[@]} == 0 )); then
  echo "Workflow lint failed: no GitHub Actions workflow files were found in $workflow_dir." >&2
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