#!/usr/bin/env bash

# This file is sourced by the project-specific Replit Bash startup file.
# Keep selection limited to that shell and its children; do not mutate any
# system-wide Node installation or alter TLS settings.

find_cached_shell_node() {
  local npm_cache_root="$1"
  local required_version="$2"
  local candidate canonical_candidate actual_version
  local had_nullglob=0
  local -a candidates=()

  [[ -d "${npm_cache_root}/_npx" ]] || return 1
  shopt -q nullglob && had_nullglob=1
  shopt -s nullglob
  candidates=("${npm_cache_root}"/_npx/*/node_modules/node/bin/node)
  (( had_nullglob == 1 )) || shopt -u nullglob

  for candidate in "${candidates[@]}"; do
    [[ -x "$candidate" ]] || continue
    canonical_candidate=$(realpath -e -- "$candidate" 2>/dev/null) || continue
    case "$canonical_candidate" in
      "${npm_cache_root}"/_npx/*/node_modules/node/bin/node) ;;
      *) continue ;;
    esac
    actual_version=$("$canonical_candidate" --version 2>/dev/null || true)
    if [[ "$actual_version" == "v${required_version}" ]]; then
      printf '%s\n' "$canonical_candidate"
      return 0
    fi
  done
  return 1
}

select_replit_shell_node() {
  local selector repo_root required_version current_node current_version
  local store_root candidate selected_node selected_version selected_node_dir
  local cache_path cache_root npm_cache_root cache_owner lock_file lock_fd npm_bin
  local npm_user_config npm_global_config config_path
  local guarded_node_options

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
    if [[ -z "${HOME:-}" || "$HOME" != /* ]]; then
      printf 'Cannot provision interactive Node v%s: HOME must be an absolute user directory.\n' \
        "$required_version" >&2
      return 1
    fi

    cache_path="${REPLIT_SHELL_NODE_CACHE_ROOT:-${HOME}/.cache/replit-pinned-node}"
    if [[ -L "$cache_path" ]]; then
      printf 'Cannot provision interactive Node v%s: the runtime cache path must not be a symbolic link.\n' \
        "$required_version" >&2
      return 1
    fi
    cache_root=$(realpath -m -- "$cache_path") || {
      printf 'Cannot resolve the private cache for interactive Node v%s.\n' \
        "$required_version" >&2
      return 1
    }
    case "$cache_root" in
      "$repo_root"|"$repo_root"/*)
        printf 'Cannot provision interactive Node v%s: its runtime cache must stay outside the project.\n' \
          "$required_version" >&2
        return 1
        ;;
    esac
    mkdir -p -- "$cache_root" || {
      printf 'Cannot create the private cache for interactive Node v%s.\n' \
        "$required_version" >&2
      return 1
    }
    chmod 700 -- "$cache_root" || {
      printf 'Cannot secure the private cache for interactive Node v%s.\n' \
        "$required_version" >&2
      return 1
    }
    cache_root=$(realpath -e -- "$cache_root") || return 1
    if [[ -L "$cache_root" ]]; then
      printf 'Cannot provision interactive Node v%s: the runtime cache must be a real directory.\n' \
        "$required_version" >&2
      return 1
    fi
    cache_owner=$(stat -c '%u' -- "$cache_root") || return 1
    if [[ "$cache_owner" != "$(id -u)" ]]; then
      printf 'Cannot provision interactive Node v%s: the runtime cache must be owned by this user.\n' \
        "$required_version" >&2
      return 1
    fi

    npm_cache_root="${cache_root}/npm-cache"
    if [[ -L "$npm_cache_root" ]]; then
      printf 'Cannot provision interactive Node v%s: the npm cache path must not be a symbolic link.\n' \
        "$required_version" >&2
      return 1
    fi
    mkdir -p -- "$npm_cache_root" || return 1
    chmod 700 -- "$npm_cache_root" || return 1
    npm_user_config="${cache_root}/npm-user.npmrc"
    npm_global_config="${cache_root}/npm-global.npmrc"
    for config_path in "$npm_user_config" "$npm_global_config"; do
      if [[ -L "$config_path" || ( -e "$config_path" && ! -f "$config_path" ) ]]; then
        printf 'Cannot provision interactive Node v%s: npm config files must be regular files.\n' \
          "$required_version" >&2
        return 1
      fi
      (
        umask 077
        : >>"$config_path"
      ) || return 1
      chmod 600 -- "$config_path" || return 1
    done

    # Serialize only cache provisioning. Interactive shells must not hold the
    # workspace validation lock for their lifetime.
    lock_file="${cache_root}/install.lock"
    if [[ -L "$lock_file" ]]; then
      printf 'Cannot provision interactive Node v%s: the runtime lock path must not be a symbolic link.\n' \
        "$required_version" >&2
      return 1
    fi
    (
      umask 077
      : >>"$lock_file"
    ) || return 1
    chmod 600 -- "$lock_file" || return 1
    exec {lock_fd}>>"$lock_file" || return 1
    if ! flock --exclusive --timeout 300 "$lock_fd"; then
      exec {lock_fd}>&-
      printf 'Timed out waiting for the interactive Node cache setup lock; retry opening the shell.\n' >&2
      return 1
    fi

    selected_node=$(find_cached_shell_node "$npm_cache_root" "$required_version" || true)
    if [[ -z "$selected_node" ]]; then
      npm_bin=$(type -P npm 2>/dev/null || true)
      if [[ -z "$npm_bin" || ! -x "$npm_bin" ]]; then
        flock --unlock "$lock_fd" || true
        exec {lock_fd}>&-
        printf 'Cannot provision interactive Node v%s: npm is unavailable in the Replit runtime.\n' \
          "$required_version" >&2
        return 1
      fi

      guarded_node_options="${NODE_OPTIONS:+${NODE_OPTIONS} }--require=\"${repo_root}/scripts/src/release-node-https-only.cjs\""
      if ! (
        cd "$cache_root" &&
          env \
            NODE_OPTIONS="$guarded_node_options" \
            RELEASE_NODE_VERSION="$required_version" \
            npm_config_cache="$npm_cache_root" \
            npm_config_registry="https://registry.npmjs.org/" \
             npm_config_userconfig="$npm_user_config" \
             npm_config_globalconfig="$npm_global_config" \
            npm_config_audit=false \
            npm_config_fund=false \
            npm_config_update_notifier=false \
            npm_config_yes=true \
          timeout --signal=TERM --kill-after=10s 300s \
          "$npm_bin" exec --yes --package="node@${required_version}" -- bash -c '
              set -euo pipefail
              node_bin=$(type -P node)
              actual_version=$("$node_bin" --version)
              if [[ "$actual_version" != "v${RELEASE_NODE_VERSION}" ]]; then
                printf "npm provisioned Node %s; expected v%s.\n" \
                  "$actual_version" "$RELEASE_NODE_VERSION" >&2
                exit 1
              fi
            '
      ); then
        flock --unlock "$lock_fd" || true
        exec {lock_fd}>&-
        printf 'Could not provision exact Node v%s from the HTTPS npm registry; the interactive shell was not started.\n' \
          "$required_version" >&2
        return 1
      fi

      selected_node=$(find_cached_shell_node "$npm_cache_root" "$required_version" || true)
    fi
    flock --unlock "$lock_fd" || true
    exec {lock_fd}>&-

    if [[ -z "$selected_node" ]]; then
      printf 'The private npm cache did not contain a verified Node v%s runtime after provisioning.\n' \
        "$required_version" >&2
      return 1
    fi
  fi

  if [[ -z "${selected_node:-}" ]]; then
    printf 'Cannot start this interactive shell with the required Node v%s: no exact runtime was found in %s.\n' \
      "$required_version" "$store_root" >&2
    printf 'Restore Node v%s to the Replit environment or use scripts/src/run-release-node.sh for one-off commands.\n' \
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
unset -f find_cached_shell_node
unset -f select_replit_shell_node
if (( _replit_shell_node_status != 0 )); then
  unset _replit_shell_node_status
  return 1
fi
unset _replit_shell_node_status
