#!/usr/bin/env bash

# Read the current workspace's bounded, private release-runner wait history.
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd "${SCRIPT_DIR}/../.." && pwd)
current_uid=$(id -u)
lock_dir="/tmp/replit-release-runner-${current_uid}"
workspace_digest=$(printf '%s' "$REPO_ROOT" | sha256sum)
workspace_key=${workspace_digest%% *}
history_file="${lock_dir}/${workspace_key}.wait-history.jsonl"
history_limit=20
event_pattern='^\{"timestamp_utc":"([0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z)","elapsed_wait_seconds":([0-9]+),"outcome":"(acquired|timeout|interrupted)","owner_pid":"(unknown|[1-9][0-9]*)","owner_started_at":"(unknown|[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z)"\}$'
declare -a rows=()

printf 'Recent local validation lock waits (up to %s records):\n' \
  "$history_limit"

if [[ ! -e "$lock_dir" && ! -L "$lock_dir" ]]; then
  printf 'No local lock-wait history found for this workspace.\n'
  printf 'This local history does not include Replit-managed task-runner waits.\n'
  exit 0
fi

if [[ -L "$lock_dir" || ! -d "$lock_dir" ]] ||
  [[ "$(stat -c '%u' -- "$lock_dir" 2>/dev/null || true)" != "$current_uid" ]] ||
  [[ "$(stat -c '%a' -- "$lock_dir" 2>/dev/null || true)" != "700" ]]; then
  printf 'Cannot safely read local lock-wait history: its private directory is unavailable.\n' >&2
  exit 1
fi

if [[ ! -e "$history_file" && ! -L "$history_file" ]]; then
  printf 'No local lock-wait history found for this workspace.\n'
  printf 'This local history does not include Replit-managed task-runner waits.\n'
  exit 0
fi

if [[ -L "$history_file" || ! -f "$history_file" ]] ||
  [[ "$(stat -c '%u' -- "$history_file" 2>/dev/null || true)" != "$current_uid" ]] ||
  [[ "$(stat -c '%a' -- "$history_file" 2>/dev/null || true)" != "600" ]]; then
  printf 'Cannot safely read local lock-wait history: its file is unavailable.\n' >&2
  exit 1
fi

while IFS= read -r line || [[ -n "$line" ]]; do
  if [[ "$line" =~ $event_pattern ]]; then
    printf -v row '%s\t%s\t%s\t%s\t%s' \
      "${BASH_REMATCH[1]}" "${BASH_REMATCH[2]}" "${BASH_REMATCH[3]}" \
      "${BASH_REMATCH[4]}" "${BASH_REMATCH[5]}"
    rows+=("$row")
    if (( ${#rows[@]} > history_limit )); then
      rows=("${rows[@]:1}")
    fi
  fi
done <"$history_file"

if (( ${#rows[@]} == 0 )); then
  printf 'No valid local lock-wait history records found.\n'
else
  printf 'Timestamp (UTC)\tElapsed (seconds)\tOutcome\tOwner PID\tOwner start (UTC)\n'
  printf '%s\n' "${rows[@]}"
fi

printf 'This local history does not include Replit-managed task-runner waits.\n'
