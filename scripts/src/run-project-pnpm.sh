#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd "${SCRIPT_DIR}/../.." && pwd)
cd "$REPO_ROOT"

if (( $# == 0 )); then
  printf 'Usage: %s <pnpm arguments...>\n' "${BASH_SOURCE[0]}" >&2
  exit 2
fi

# Load the same selection logic used by the interactive Replit shell.
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/configure-project-pnpm.sh"
configure_project_pnpm "$REPO_ROOT" || exit $?
unset -f configure_project_pnpm

pnpm_version=$(
  node -e '
    const packageJson = require(process.argv[1]);
    process.stdout.write(packageJson.packageManager.slice("pnpm@".length));
  ' "${REPO_ROOT}/package.json"
)
if ! selected_version=$(pnpm --version); then
  printf 'Could not start the pinned project pnpm@%s. Check HTTPS registry access and the Corepack cache, then retry.\n' \
    "$pnpm_version" >&2
  exit 1
fi
if [[ "$selected_version" != "$pnpm_version" ]]; then
  printf 'Project pnpm selection resolved %s; expected %s. Restore the Corepack shim and retry.\n' \
    "$selected_version" "$pnpm_version" >&2
  exit 1
fi

exec pnpm "$@"
