#!/usr/bin/env bash

# Run release commands with the exact Node executable bound to retained
# evaluation evidence. Putting the executable's directory first on PATH is
# required because pnpm and its child scripts resolve `node` independently.

set -euo pipefail

# Replit's system trust store contains the certificates needed for verified
# HTTPS requests from the pinned Node runtime. Keep certificate verification on;
# do not replace this with NODE_TLS_REJECT_UNAUTHORIZED=0.
export NODE_USE_SYSTEM_CA=1

# The pinned Node/OpenSSL build can have a default CA directory inside an
# immutable Nix store path that is not present in this workspace. Point OpenSSL
# at readable host trust-store paths before starting Node, npm, or npx. Prefer
# the Nix-provided bundle when available, then a valid inherited bundle, then
# common Linux system bundles. Keep both CA file and directory lookup enabled.
system_ca_file=""
for candidate in \
  "${NIX_SSL_CERT_FILE:-}" \
  "${SSL_CERT_FILE:-}" \
  /etc/ssl/certs/ca-certificates.crt \
  /etc/ssl/cert.pem \
  /etc/pki/tls/certs/ca-bundle.crt; do
  if [[ -n "$candidate" && -r "$candidate" && -s "$candidate" ]]; then
    system_ca_file="$candidate"
    break
  fi
done
if [[ -z "$system_ca_file" ]]; then
  printf 'Release runner could not find a readable system CA certificate bundle.\n' >&2
  exit 1
fi
export SSL_CERT_FILE="$system_ca_file"

system_ca_dir=""
for candidate in \
  "${NIX_SSL_CERT_DIR:-}" \
  "${SSL_CERT_DIR:-}" \
  /etc/ssl/certs \
  /etc/pki/tls/certs; do
  if [[ -n "$candidate" && -d "$candidate" && -r "$candidate" ]]; then
    system_ca_dir="$candidate"
    break
  fi
done
if [[ -z "$system_ca_dir" ]]; then
  printf 'Release runner could not find a readable system CA certificate directory.\n' >&2
  exit 1
fi
export SSL_CERT_DIR="$system_ca_dir"

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd "${SCRIPT_DIR}/../.." && pwd)
NODE_SELECTOR="${REPO_ROOT}/.nvmrc"
RELEASE_RUNNER_LOCK_WAIT_MAX_SECONDS=7200
RELEASE_RUNNER_LOCK_WAIT_DEFAULT_SECONDS=7200

if (( $# == 0 )); then
  printf 'Usage: %s <command> [args...]\n' "${BASH_SOURCE[0]}" >&2
  exit 2
fi

# The configured validation workflows share this workspace's pnpm links and
# build outputs. Serialize runner invocations so concurrent completion checks
# cannot compete for those shared files or exhaust the workspace's workers.
# Keep the lock descriptor open across exec so it remains held by the command
# tree, and pass the lock key to nested runner calls to avoid self-deadlock.
lock_digest=$(printf '%s' "$REPO_ROOT" | sha256sum)
lock_key=${lock_digest%% *}
if [[ "${RELEASE_RUNNER_LOCK_KEY:-}" != "$lock_key" ]]; then
  if ! command -v flock >/dev/null 2>&1; then
    printf 'Release runner requires flock to serialize workspace validation.\n' >&2
    exit 127
  fi

  lock_owner_expected="${UID:-$(id -u)}"
  lock_dir="/tmp/replit-release-runner-${lock_owner_expected}"
  if [[ ! -d "$lock_dir" && ! -L "$lock_dir" ]]; then
    mkdir -m 700 -- "$lock_dir" 2>/dev/null || true
  fi
  if [[ -L "$lock_dir" || ! -d "$lock_dir" ]]; then
    printf 'Release runner could not prepare its private lock directory.\n' >&2
    exit 1
  fi
  lock_dir_owner=$(stat -c '%u' -- "$lock_dir")
  lock_dir_mode=$(stat -c '%a' -- "$lock_dir")
  if [[ "$lock_dir_owner" != "$lock_owner_expected" || "$lock_dir_mode" != "700" ]]; then
    printf 'Release runner lock directory must be owned by this user with mode 700.\n' >&2
    exit 1
  fi

  lock_file="${lock_dir}/${lock_key}.lock"
  lock_owner_file="${lock_dir}/${lock_key}.owner"
  exec {release_runner_lock_fd}>>"$lock_file"
  if ! flock --nonblock "$release_runner_lock_fd"; then
    lock_wait_seconds="${RELEASE_RUNNER_LOCK_WAIT_SECONDS:-$RELEASE_RUNNER_LOCK_WAIT_DEFAULT_SECONDS}"
    if [[ ! "$lock_wait_seconds" =~ ^[1-9][0-9]{0,3}$ ]] ||
      (( lock_wait_seconds > RELEASE_RUNNER_LOCK_WAIT_MAX_SECONDS )); then
      printf \
        'Release runner lock wait must be between 1 and %s seconds; received an invalid limit.\n' \
        "$RELEASE_RUNNER_LOCK_WAIT_MAX_SECONDS" >&2
      exit 2
    fi

    lock_owner_pid="unknown"
    lock_owner_started_at="unknown"
    lock_owner_state="unknown"
    if [[ -r "$lock_owner_file" ]]; then
      read -r recorded_owner_pid _recorded_owner_epoch lock_owner_started_at \
        <"$lock_owner_file" || true
      if [[ "${recorded_owner_pid:-}" =~ ^[1-9][0-9]*$ ]]; then
        lock_owner_pid="$recorded_owner_pid"
        lock_owner_state=$(ps -p "$lock_owner_pid" -o stat= 2>/dev/null | tr -d '[:space:]' || true)
        [[ -n "$lock_owner_state" ]] || lock_owner_state="not-running"
      fi
      [[ "${lock_owner_started_at:-}" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$ ]] ||
        lock_owner_started_at="unknown"
    fi

    printf \
      'Release runner is waiting for the workspace validation lock (owner_pid=%s owner_started_at=%s owner_state=%s wait_limit=%ss).\n' \
      "$lock_owner_pid" "$lock_owner_started_at" "$lock_owner_state" \
      "$lock_wait_seconds" >&2
    lock_wait_started_epoch=$(date +%s)
    if flock --exclusive --timeout "$lock_wait_seconds" \
      --conflict-exit-code 75 "$release_runner_lock_fd"; then
      lock_wait_elapsed_seconds=$(($(date +%s) - lock_wait_started_epoch))
      printf \
        'Release runner acquired the workspace validation lock after %ss (previous_owner_pid=%s).\n' \
        "$lock_wait_elapsed_seconds" "$lock_owner_pid" >&2
    else
      lock_status=$?
      if (( lock_status == 75 )); then
        printf \
          'Release runner timed out after %s seconds waiting for the workspace validation lock (owner_pid=%s owner_started_at=%s owner_state=%s). Retry after the current validation command finishes; inspect the reported PID if it remains active.\n' \
          "$lock_wait_seconds" "$lock_owner_pid" "$lock_owner_started_at" \
          "$lock_owner_state" >&2
        exec {release_runner_lock_fd}>&-
        exit 75
      fi
      printf \
        'Release runner could not acquire the workspace validation lock (flock_status=%s).\n' \
        "$lock_status" >&2
      exec {release_runner_lock_fd}>&-
      exit "$lock_status"
    fi
  fi

  lock_owner_started_epoch=$(date +%s)
  lock_owner_started_at=$(date -u +'%Y-%m-%dT%H:%M:%SZ')
  if ! printf '%s %s %s\n' "$$" "$lock_owner_started_epoch" \
    "$lock_owner_started_at" >"$lock_owner_file"; then
    printf 'Release runner could not record workspace lock ownership.\n' >&2
    exec {release_runner_lock_fd}>&-
    exit 1
  fi
  export RELEASE_RUNNER_LOCK_KEY="$lock_key"
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
active_child_pid=""

# shellcheck disable=SC2317
stop_active_child() {
  local signal="$1"
  local process_group="$active_child_pid"
  local deadline=$((SECONDS + 10))

  [[ -n "$process_group" ]] || return 0
  kill -s "$signal" -- "-$process_group" 2>/dev/null ||
    kill -s "$signal" "$process_group" 2>/dev/null ||
    true
  while ps -eo sid=,stat= |
    awk -v session="$process_group" \
      '$1 == session && $2 !~ /^Z/ { found = 1 } END { exit !found }'; do
    if (( SECONDS >= deadline )); then
      kill -KILL -- "-$process_group" 2>/dev/null || true
      break
    fi
    sleep 0.1
  done
}

# shellcheck disable=SC2317
handle_signal() {
  local signal="$1"
  local exit_code="$2"

  trap '' HUP INT TERM
  if [[ -n "$active_child_pid" ]]; then
    stop_active_child "$signal"
    wait "$active_child_pid" 2>/dev/null || true
    active_child_pid=""
  fi
  exit "$exit_code"
}

trap 'handle_signal HUP 129' HUP
trap 'handle_signal INT 130' INT
trap 'handle_signal TERM 143' TERM

npx_bin=""
if ! npx_bin=$(command -v npx 2>/dev/null); then
  printf \
    'Release runner could not find npx; cannot make pinned Node package node@%s available via npx; refusing to run release command.\n' \
    "$required_node_version" >&2
  exit 127
fi

# shellcheck disable=SC2016
RELEASE_NODE_FALLBACK_MARKER="$fallback_marker" \
  python3 -c '
import os
import signal
import sys

os.setsid()
signal.signal(signal.SIGINT, signal.SIG_DFL)
signal.signal(signal.SIGQUIT, signal.SIG_DFL)
os.execvp(sys.argv[1], sys.argv[1:])
' "$npx_bin" \
  --yes --package="node@${required_node_version}" -- bash -c '
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
' release-node-runner "$@" &
active_child_pid=$!
if wait "$active_child_pid"; then
  npx_status=0
else
  npx_status=$?
fi
active_child_pid=""

if (( npx_status == 0 )); then
  exit 0
else
  if [[ ! -e "$fallback_marker" ]]; then
    printf \
      'Release runner could not make pinned Node package node@%s available via npx; refusing to run release command.\n' \
      "$required_node_version" >&2
  fi
  exit "$npx_status"
fi
