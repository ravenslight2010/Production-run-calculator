#!/usr/bin/env bash

# Run release commands with the exact Node executable bound to retained
# evaluation evidence. Putting the executable's directory first on PATH is
# required because pnpm and its child scripts resolve `node` independently.

set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd "${SCRIPT_DIR}/../.." && pwd)
NODE_SELECTOR="${REPO_ROOT}/.nvmrc"

if (( $# == 0 )); then
  printf 'Usage: %s <command> [args...]\n' "${BASH_SOURCE[0]}" >&2
  exit 2
fi

if [[ ! -f "$NODE_SELECTOR" ]]; then
  printf 'Release Node selector is missing: %s\n' "$NODE_SELECTOR" >&2
  exit 1
fi

required_node_version=$(tr -d '[:space:]' <"$NODE_SELECTOR")
if [[ -z "$required_node_version" ]]; then
  printf 'Release Node selector is empty: %s\n' "$NODE_SELECTOR" >&2
  exit 1
fi

export RELEASE_NODE_VERSION="$required_node_version"
export RELEASE_REPO_ROOT="$REPO_ROOT"

# If the runner already has the selected Node version, use it directly. This
# avoids an unnecessary npx package download while still putting the selected
# executable first on PATH for pnpm and its child scripts.
node_bin=""
if node_bin=$(command -v node 2>/dev/null); then
  actual_node_version=$("$node_bin" --version 2>/dev/null || true)
  expected_node_version="v${required_node_version}"
  if [[ "$actual_node_version" == "$expected_node_version" ]]; then
    node_bin_dir=$(dirname "$node_bin")
    export PATH="${node_bin_dir}:$PATH"

    # Check the selected executable against the retained benchmark manifest,
    # .nvmrc, and explicit CI pins before any release child can write evidence.
    "$node_bin" "$RELEASE_REPO_ROOT/scripts/src/check-routine-node-version.mjs"

    exec "$@"
  fi
fi

# npx makes the requested Node package available as a binary. The nested
# shell deliberately discovers that binary and prepends its directory to
# PATH before starting pnpm; wrapping pnpm alone does not control the Node
# executable used by package scripts.
fallback_marker_dir=$(mktemp -d "${TMPDIR:-/tmp}/run-release-node.XXXXXX")
fallback_marker="${fallback_marker_dir}/started"
trap 'rm -rf "$fallback_marker_dir"' EXIT

npx_bin=""
if ! npx_bin=$(command -v npx 2>/dev/null); then
  printf \
    'Release runner could not find npx; cannot make pinned Node package node@%s available via npx; refusing to run release command.\n' \
    "$required_node_version" >&2
  exit 127
fi

# shellcheck disable=SC2016
if RELEASE_NODE_FALLBACK_MARKER="$fallback_marker" \
  "$npx_bin" --yes --package="node@${required_node_version}" -- bash -c '
  set -euo pipefail

  : >"$RELEASE_NODE_FALLBACK_MARKER"
  node_bin=$(command -v node)
  actual_node_version=$("$node_bin" --version)
  expected_node_version="v${RELEASE_NODE_VERSION}"
  if [[ "$actual_node_version" != "$expected_node_version" ]]; then
    printf "Release runner resolved Node %s; expected %s.\n" \
      "$actual_node_version" "$expected_node_version" >&2
    exit 1
  fi

  export PATH="$(dirname "$node_bin"):$PATH"

  # Check the selected executable against the retained benchmark manifest,
  # .nvmrc, and explicit CI pins before any release child can write evidence.
  "$node_bin" "$RELEASE_REPO_ROOT/scripts/src/check-routine-node-version.mjs"

  exec "$@"
' release-node-runner "$@"; then
  exit 0
else
  npx_status=$?
  if [[ ! -e "$fallback_marker" ]]; then
    printf \
      'Release runner could not make pinned Node package node@%s available via npx; refusing to run release command.\n' \
      "$required_node_version" >&2
  fi
  exit "$npx_status"
fi
