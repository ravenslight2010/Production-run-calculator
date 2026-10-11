#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd "${SCRIPT_DIR}/../.." && pwd)
readonly SCRIPT_DIR REPO_ROOT
cd "$REPO_ROOT"

PLAYWRIGHT_CONFIG="${BROWSER_TEST_PLAYWRIGHT_CONFIG:-playwright.config.ts}"
declare -a playwright_args=()
while (($#)); do
  if [[ "$1" == --playwright-config=* ]]; then
    PLAYWRIGHT_CONFIG="${1#*=}"
    if [[ -z "$PLAYWRIGHT_CONFIG" ]]; then
      printf 'The --playwright-config option requires a config path.\n' >&2
      exit 2
    fi
  else
    playwright_args+=("$1")
  fi
  shift
done
readonly PLAYWRIGHT_CONFIG

choose_local_port() {
  python3 -c 'import socket; s = socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1]); s.close()'
}

API_PORT="${RELEASE_BROWSER_API_PORT:-$(choose_local_port)}"
WEB_PORT="${RELEASE_BROWSER_WEB_PORT:-$(choose_local_port)}"
PG_PORT="${BROWSER_TEST_POSTGRES_PORT:-$(choose_local_port)}"
while [[ "$WEB_PORT" == "$API_PORT" || "$WEB_PORT" == "$PG_PORT" ]]; do
  WEB_PORT="$(choose_local_port)"
done
while [[ "$PG_PORT" == "$API_PORT" || "$PG_PORT" == "$WEB_PORT" ]]; do
  PG_PORT="$(choose_local_port)"
done
readonly API_PORT WEB_PORT PG_PORT
readonly DB_NAME="browser_e2e"

stage="checking the local PostgreSQL runtime"
pg_bin=""
pg_data=""
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
  local child_signal="$signal"

  trap '' HUP INT TERM
  if [[ -n "$active_child_pid" ]]; then
    if [[ "$signal" != INT && "$stage" == "running the isolated browser suite" ]]; then
      child_signal=INT
    fi
    stop_active_child "$child_signal"
    wait "$active_child_pid" 2>/dev/null || true
    active_child_pid=""
  fi
  exit "$exit_code"
}

run_isolated_command() {
  local child_status

  python3 -c '
import os
import signal
import sys

os.setsid()
signal.signal(signal.SIGINT, signal.SIG_DFL)
signal.signal(signal.SIGQUIT, signal.SIG_DFL)
os.execvp(sys.argv[1], sys.argv[1:])
' "$@" &
  active_child_pid=$!
  if wait "$active_child_pid"; then
    child_status=0
  else
    child_status=$?
  fi
  active_child_pid=""
  return "$child_status"
}

cleanup() {
  local exit_code=$?
  local database_stopped=1
  trap - EXIT HUP INT TERM
  if [[ -n "$active_child_pid" ]]; then
    stop_active_child TERM
    wait "$active_child_pid" 2>/dev/null || true
    active_child_pid=""
  fi
  if [[ -n "$pg_data" && -n "$pg_bin" ]]; then
    if ! "$pg_bin/pg_ctl" -D "$pg_data" -m immediate -w stop >/dev/null 2>&1 &&
      "$pg_bin/pg_ctl" -D "$pg_data" status >/dev/null 2>&1; then
      database_stopped=0
      printf \
        'Could not stop the disposable PostgreSQL server; preserving its data directory at %s.\n' \
        "$pg_data" >&2
      (( exit_code != 0 )) || exit_code=1
    else
      rm -rf -- "$pg_data"
    fi
  fi
  if [[ -n "$pg_data" && -e "$pg_data" ]]; then
    database_stopped=0
  fi
  if (( exit_code != 0 )); then
    printf 'Isolated browser validation failed while %s.\n' "$stage" >&2
    if (( database_stopped )); then
      printf 'The disposable database was cleaned up. Review the preceding command output, fix that stage, and retry.\n' >&2
    else
      printf 'The disposable database directory was preserved because PostgreSQL may still be using it. Review the preceding command output before retrying.\n' >&2
    fi
  fi
  exit "$exit_code"
}
trap cleanup EXIT
trap 'handle_signal HUP 129' HUP
trap 'handle_signal INT 130' INT
trap 'handle_signal TERM 143' TERM

case "${NODE_ENV:-}:${APP_ENV:-}:${REPLIT_DEPLOYMENT:-}" in
  production:*|prod:*|*:production:*|*:prod:*|*:*:1)
    printf 'Refusing isolated browser validation in a production environment.\n' >&2
    exit 1
    ;;
esac

pg_bin="$(dirname "$(command -v postgres)")"
pg_data="$(mktemp -d /tmp/browser-validation-pg.XXXXXX)"

stage="initializing the disposable PostgreSQL cluster"
"$pg_bin/initdb" -D "$pg_data" -U postgres --auth=trust >/dev/null

stage="starting the disposable PostgreSQL cluster"
mkdir -p "$pg_data/socket"
if ! "$pg_bin/pg_ctl" \
  -D "$pg_data" \
  -o "-F -p $PG_PORT -k $pg_data/socket" \
  -l "$pg_data/postgres.log" \
  -w start >/dev/null 2>&1; then
  tail -n 60 "$pg_data/postgres.log" >&2 || true
  exit 1
fi

stage="creating the disposable browser database"
"$pg_bin/createdb" -h 127.0.0.1 -p "$PG_PORT" -U postgres "$DB_NAME"

export DATABASE_URL="postgresql://postgres@127.0.0.1:${PG_PORT}/${DB_NAME}"
export E2E_TEST_DB=1
export E2E_APPROVED_DESTRUCTIVE_MODE=1
export RELEASE_BROWSER_LOCAL_SERVERS=1
export RELEASE_BROWSER_API_PORT="$API_PORT"
export RELEASE_BROWSER_WEB_PORT="$WEB_PORT"
export PLAYWRIGHT_BASE_URL="http://127.0.0.1:${WEB_PORT}"
export PLAYWRIGHT_API_BASE_URL="http://127.0.0.1:${API_PORT}"
if [[ -z "${PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH:-}" ]]; then
  PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH="$(
    command -v chromium ||
      command -v chromium-browser ||
      command -v google-chrome ||
      true
  )"
fi
export PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
if [[ -n "${PLAYWRIGHT_RELEASE_REPORT_PATH:-}" ]]; then
  export PLAYWRIGHT_RELEASE_REPORT_PATH
elif [[ "$PLAYWRIGHT_CONFIG" == "playwright.config.ts" ]]; then
  export PLAYWRIGHT_RELEASE_REPORT_PATH="$PWD/release-evidence/browser-full/FINAL-REPORT.md"
else
  unset PLAYWRIGHT_RELEASE_REPORT_PATH
fi

if [[ "${BROWSER_TEST_INSTALL_WEBKIT:-0}" == "1" ]]; then
  stage="installing the WebKit browser"
  # shellcheck disable=SC2016
  run_isolated_command bash -c \
    'cd "$1" && shift && exec "$@"' \
    isolated-browser-install "$PWD/artifacts/run-calculator" \
    pnpm exec playwright install webkit
fi

stage="applying the canonical database schema"
run_isolated_command pnpm --filter @workspace/db run push-force

stage="running the isolated browser suite"
# shellcheck disable=SC2016
run_isolated_command bash -c \
  'cd "$1" && shift && exec "$@"' \
  isolated-browser-suite "$PWD/artifacts/run-calculator" \
  pnpm exec playwright test --config="$PLAYWRIGHT_CONFIG" "${playwright_args[@]}"

stage="finishing isolated browser validation"