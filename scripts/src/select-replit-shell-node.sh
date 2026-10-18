#!/usr/bin/env bash

# This file is sourced by the project-specific Replit Bash startup file.
# Keep selection limited to that shell and its children; do not mutate any
# system-wide Node installation or alter TLS settings.

select_replit_shell_node() {
  local selector repo_root required_version current_node current_version
  local store_root candidate selected_node selected_version selected_node_dir

  repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd) || {
    printf 'Cannot locate the project root for interactive Node selection.\n' >&2
    return 1
  }
  selector="${repo_root}/.nvmrc"
  if [[ ! -f "$selector" ]]; then
    printf 'Cannot select interactive Node: project version pin is missing at %s.\n' \
      "$selector" >&2
    return 1
  fi

  IFS= read -r required_version <"$selector" || true
  required_version="${required_version//[[:space:]]/}"
  if [[ ! "$required_version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    printf 'Cannot select interactive Node: %s must contain one exact X.Y.Z version.\n' \
      "$selector" >&2
    return 1
  fi

  current_node=$(type -P node 2>/dev/null || true)
  if [[ -n "$current_node" ]]; then
    current_version=$("$current_node" --version 2>/dev/null || true)
    if [[ "$current_version" == "v${required_version}" ]]; then
      selected_node="$current_node"
    fi
  fi

  # Replit's Node module may expose an older patch. Find the exact package by
  # its versioned Nix package name rather than embedding an ephemeral store hash.
  store_root="${REPLIT_SHELL_NODE_STORE_ROOT:-/nix/store}"
  if [[ -z "${selected_node:-}" && -d "$store_root" ]]; then
    for candidate in \
      "$store_root"/*-nodejs-"$required_version" \
      "$store_root"/*-nodejs-slim-"$required_version"; do
      [[ -x "$candidate/bin/node" ]] || continue
      selected_version=$("$candidate/bin/node" --version 2>/dev/null || true)
      if [[ "$selected_version" == "v${required_version}" ]]; then
        selected_node="$candidate/bin/node"
        break
      fi
    done
  fi

  if [[ -z "${selected_node:-}" ]]; then
    printf 'Cannot start this interactive shell with the required Node v%s: no exact runtime was found in %s.\n' \
      "$required_version" "$store_root" >&2
    printf 'Restore Node v%s to the Replit environment, then open a new shell. For one-off commands, use scripts/src/run-release-node.sh.\n' \
      "$required_version" >&2
    return 1
  fi

  selected_node_dir=$(dirname "$selected_node") || return 1
  PATH="${selected_node_dir}:${PATH}"
  export PATH
  current_node=$(type -P node 2>/dev/null || true)
  current_version=$("$current_node" --version 2>/dev/null || true)
  if [[ "$current_node" != "$selected_node" ||
    "$current_version" != "v${required_version}" ]]; then
    printf 'Interactive Node selection failed: found %s (%s), expected %s (%s).\n' \
      "${current_node:-no executable}" "${current_version:-unknown version}" \
      "$selected_node" "v${required_version}" >&2
    return 1
  fi
}

select_replit_shell_node
_replit_shell_node_status=$?
unset -f select_replit_shell_node
if (( _replit_shell_node_status != 0 )); then
  unset _replit_shell_node_status
  return 1
fi
unset _replit_shell_node_status
