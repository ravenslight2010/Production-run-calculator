#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd "${SCRIPT_DIR}/../.." && pwd)
cd "$REPO_ROOT"

use_retained_startup_tools=0
if [[ "${1:-}" == "--use-retained-startup-tools" ]]; then
  use_retained_startup_tools=1
  shift
fi

if (( $# == 0 )); then
  printf 'Usage: %s [--use-retained-startup-tools] <pnpm arguments...>\n' "${BASH_SOURCE[0]}" >&2
  exit 2
fi

if (( use_retained_startup_tools )); then
  # pnpm 12 reads its bootstrap resolution from the source lockfile even for
  # --version. Without it, a cached native executable can still attempt DNS.
  if [[ ! -f "${REPO_ROOT}/pnpm-lock.yaml" || -L "${REPO_ROOT}/pnpm-lock.yaml" ]]; then
    printf 'Retained startup requires a regular root pnpm-lock.yaml, including its package-manager bootstrap metadata. Restore the complete build input; do not regenerate it during startup.\n' >&2
    exit 1
  fi
  retained_corepack_home=$(node "${SCRIPT_DIR}/runtime-tool-cache.mjs" restore) || exit $?
  export COREPACK_HOME="$retained_corepack_home"
  export COREPACK_ENABLE_NETWORK=0
  # The API itself does not need the startup manager. Remove only the private
  # cache returned by the verified restorer after maintenance exits.
  trap 'rm -rf -- "$(dirname "$retained_corepack_home")"' EXIT
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

if (( use_retained_startup_tools )); then
  pnpm "$@"
else
  exec pnpm "$@"
fi
