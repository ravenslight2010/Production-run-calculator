#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd "${SCRIPT_DIR}/../.." && pwd)
readonly SCRIPT_DIR REPO_ROOT
cd "$REPO_ROOT"

SYNC_TEST_PATH="${1:-src/routes/sync.convergence.integration.test.ts}"
if (( $# > 1 )) || [[ "$SYNC_TEST_PATH" != "src/routes/sync.convergence.integration.test.ts" ]]; then
  printf 'Isolated sync convergence validation only accepts src/routes/sync.convergence.integration.test.ts.\n' >&2
  exit 64
fi

case "${NODE_ENV:-}:${APP_ENV:-}:${REPLIT_DEPLOYMENT:-}" in
  production:*|prod:*|*:production:*|*:prod:*|*:*:1)
    printf 'Refusing isolated sync convergence validation in a production runtime.\n' >&2
    exit 1
    ;;
esac

for command_name in python3 mktemp timeout pnpm; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    printf 'Isolated sync convergence validation requires %s.\n' "$command_name" >&2
    exit 127
  fi
done

postgres_path=$(command -v postgres)
pg_bin=$(dirname "$postgres_path")
for pg_command in initdb pg_ctl createdb; do
  if [[ ! -x "${pg_bin}/${pg_command}" ]]; then
    printf 'Isolated sync convergence validation requires PostgreSQL %s beside postgres.\n' \
      "$pg_command" >&2
    exit 127
  fi
done

choose_local_port() {
  python3 -c 'import socket; s = socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1]); s.close()'
}

PG_PORT="${SYNC_CONVERGENCE_POSTGRES_PORT:-$(choose_local_port)}"
DB_SUFFIX="$(python3 -c 'import secrets; print(secrets.token_hex(6))')"
DB_NAME="sync_convergence_test_${DB_SUFFIX}"
pg_data=""
test_log=""
test_status=0
test_elapsed_ms=0
active_child_pid=""

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
' "$@" >"$test_log" 2>&1 &
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
  local exit_status=$?
  local pg_status=0
  trap - EXIT HUP INT TERM

  if [[ -n "$active_child_pid" ]]; then
    stop_active_child TERM
    wait "$active_child_pid" 2>/dev/null || true
    active_child_pid=""
  fi

  if [[ -n "$pg_data" && -n "$pg_bin" ]]; then
    if "$pg_bin/pg_ctl" -D "$pg_data" -m immediate -w stop >/dev/null 2>&1; then
      if ! rm -rf -- "$pg_data"; then
        printf 'Could not remove the stopped disposable PostgreSQL data directory; preserving it at %s.\n' \
          "$pg_data" >&2
        (( exit_status != 0 )) || exit_status=1
      fi
    else
      if "$pg_bin/pg_ctl" -D "$pg_data" status >/dev/null 2>&1; then
        pg_status=0
      else
        pg_status=$?
      fi
      # pg_ctl status uses 3 for a confirmed stopped server; other failures are inconclusive.
      if (( pg_status == 3 )); then
        if ! rm -rf -- "$pg_data"; then
          printf 'Could not remove the stopped disposable PostgreSQL data directory; preserving it at %s.\n' \
            "$pg_data" >&2
          (( exit_status != 0 )) || exit_status=1
        fi
      else
        printf 'Could not confirm that the disposable PostgreSQL server stopped; preserving its data directory at %s.\n' \
          "$pg_data" >&2
        (( exit_status != 0 )) || exit_status=1
      fi
    fi
  fi

  if [[ -n "$test_log" ]]; then
    rm -f -- "$test_log"
  fi
  exit "$exit_status"
}
trap cleanup EXIT
trap 'handle_signal HUP 129' HUP
trap 'handle_signal INT 130' INT
trap 'handle_signal TERM 143' TERM

# Do not allow inherited connection settings, especially a live DATABASE_URL,
# to participate in test setup or child-process configuration.
unset DATABASE_URL PGHOST PGPORT PGDATABASE PGUSER PGPASSWORD PGSSLMODE \
  PGSSLROOTCERT PGSSLCERT PGSSLKEY
export NODE_ENV=test
export E2E_TEST_DB=1
export E2E_APPROVED_DESTRUCTIVE_MODE=1
export SYNC_CONVERGENCE_DISPOSABLE_DB=1

pg_data=$(mktemp -d "${TMPDIR:-/tmp}/sync-convergence-postgres.XXXXXX")
test_log=$(mktemp "${TMPDIR:-/tmp}/sync-convergence-test.XXXXXX")
chmod 600 "$test_log"

"${pg_bin}/initdb" -D "$pg_data" -U postgres --auth=trust --no-instructions >/dev/null
mkdir -p "${pg_data}/socket"
if ! "${pg_bin}/pg_ctl" \
  -D "$pg_data" \
  -o "-F -p ${PG_PORT} -h 127.0.0.1 -k ${pg_data}/socket" \
  -l "${pg_data}/postgres.log" \
  -w start >/dev/null 2>&1; then
  printf 'Could not start the disposable PostgreSQL server.\n' >&2
  tail -n 40 "${pg_data}/postgres.log" >&2 || true
  exit 1
fi

"${pg_bin}/createdb" -h 127.0.0.1 -p "$PG_PORT" -U postgres "$DB_NAME"
export DATABASE_URL="postgresql://postgres@127.0.0.1:${PG_PORT}/${DB_NAME}"

started_ms=$(date +%s%3N)
# Keep this below the API release-step deadline so the runner has time to stop
# the child process group and clean up PostgreSQL before the release gate times out.
if run_isolated_command timeout --signal=TERM --kill-after=10s 420s \
  pnpm --filter @workspace/api-server exec vitest run \
    "$SYNC_TEST_PATH"; then
  test_status=0
else
  test_status=$?
fi
test_elapsed_ms=$(( $(date +%s%3N) - started_ms ))

if (( test_status == 0 )); then
  printf 'sync-convergence status=passed elapsedMs=%s\n' "$test_elapsed_ms"
else
  printf 'sync-convergence status=failed elapsedMs=%s\n' "$test_elapsed_ms" >&2
  sed -E 's#postgres(ql)?://[^[:space:]]+#<database-url>#g' "$test_log" |
    tail -n 50 >&2
  exit "$test_status"
fi
