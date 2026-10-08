#!/usr/bin/env bash

set -euo pipefail

workspace_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
proxy_script="$workspace_root/scripts/local_model_eval_proxy.py"
state_root="${XDG_STATE_HOME:-"${HOME:?HOME must be set}/.local/state"}"
state_dir="${LOCAL_MODEL_ENDPOINT_STATE_DIR:-$state_root/local-model-eval-proxy}"
pid_file="$state_dir/proxy.pid"
startup_timeout="${LOCAL_MODEL_STARTUP_TIMEOUT_SECONDS:-60}"

if ! [[ "$startup_timeout" =~ ^[1-9][0-9]{0,2}$ ]] || ((startup_timeout > 300)); then
  echo "Startup timeout must be between 1 and 300 seconds." >&2
  exit 2
fi

umask 077
mkdir -p "$state_dir"
chmod 700 "$state_dir"
exec 9>"$state_dir/startup.lock"
flock -x 9

read_pid() {
  local candidate
  [[ -r "$pid_file" ]] || return 1
  IFS= read -r candidate < "$pid_file" || return 1
  [[ "$candidate" =~ ^[1-9][0-9]*$ ]] || return 1
  printf '%s\n' "$candidate"
}

process_matches() {
  local pid="$1"
  local arguments

  [[ "$pid" =~ ^[1-9][0-9]*$ && -r "/proc/$pid/cmdline" ]] || return 1
  arguments="$(tr '\0' '\n' < "/proc/$pid/cmdline" 2>/dev/null || true)"
  grep -Fxq "$proxy_script" <<< "$arguments"
}

endpoint_ready() {
  command -v curl >/dev/null 2>&1 || return 1
  command -v python3 >/dev/null 2>&1 || return 1
  curl --noproxy '*' --silent --fail --connect-timeout 1 --max-time 3 \
    --max-filesize 65536 \
    http://127.0.0.1:11434/v1/models 2>/dev/null |
    python3 -c '
import json
import sys

try:
    data = json.load(sys.stdin)
except (json.JSONDecodeError, UnicodeDecodeError):
    raise SystemExit(1)
raise SystemExit(0 if any(
    isinstance(model, dict) and model.get("id") == "qwen3:8b"
    for model in data.get("data", [])
) else 1)
' >/dev/null 2>&1
}

wait_for_ready() {
  local pid="$1"
  local attempt

  for ((attempt = 0; attempt < startup_timeout; attempt++)); do
    if ! process_matches "$pid"; then
      return 1
    fi
    if endpoint_ready; then
      return 0
    fi
    sleep 1
  done
  return 1
}

start_endpoint() {
  local pid
  local temporary_pid_file

  if pid="$(read_pid 2>/dev/null)"; then
    if process_matches "$pid"; then
      if wait_for_ready "$pid"; then
        echo "Local model endpoint is ready at http://127.0.0.1:11434/v1."
        return 0
      fi
      echo "The tracked local model endpoint is not responding as expected." >&2
      return 1
    fi
    rm -f "$pid_file"
  fi

  if endpoint_ready; then
    echo "An unmanaged endpoint is already responding; refusing to claim it or start a duplicate." >&2
    return 1
  fi

  cd "$workspace_root"
  nohup python3 "$proxy_script" 9>&- </dev/null >/dev/null 2>&1 &
  pid=$!
  temporary_pid_file="$pid_file.tmp.$$"
  printf '%s\n' "$pid" > "$temporary_pid_file"
  mv -f "$temporary_pid_file" "$pid_file"

  if wait_for_ready "$pid"; then
    echo "Local model endpoint is ready at http://127.0.0.1:11434/v1."
    return 0
  fi

  if process_matches "$pid"; then
    kill -TERM "$pid" 2>/dev/null || true
  fi
  rm -f "$pid_file"
  echo "Local model endpoint did not become ready; startup output was suppressed." >&2
  return 1
}

stop_endpoint() {
  local pid
  local attempt

  if ! pid="$(read_pid 2>/dev/null)"; then
    rm -f "$pid_file"
    if endpoint_ready; then
      echo "The endpoint is responding but is not managed by this startup helper." >&2
      return 1
    fi
    echo "No managed local model endpoint is running."
    return 0
  fi

  if ! process_matches "$pid"; then
    rm -f "$pid_file"
    echo "Removed a stale local model endpoint process record."
    return 0
  fi

  kill -TERM "$pid"
  for ((attempt = 0; attempt < 10; attempt++)); do
    if ! process_matches "$pid"; then
      rm -f "$pid_file"
      echo "Local model endpoint stopped."
      return 0
    fi
    sleep 1
  done

  echo "Local model endpoint did not stop within 10 seconds." >&2
  return 1
}

show_status() {
  local pid

  if pid="$(read_pid 2>/dev/null)" && process_matches "$pid"; then
    if endpoint_ready; then
      echo "Local model endpoint is running at http://127.0.0.1:11434/v1."
      return 0
    fi
    echo "Local model endpoint process is running but is not ready." >&2
    return 1
  fi

  if endpoint_ready; then
    echo "The endpoint is responding but is not managed by this startup helper." >&2
    return 1
  fi

  echo "Local model endpoint is not running."
  return 1
}

case "${1:-}" in
  start)
    start_endpoint
    ;;
  stop)
    stop_endpoint
    ;;
  status)
    show_status
    ;;
  *)
    echo "Usage: $0 {start|stop|status}" >&2
    exit 2
    ;;
esac
