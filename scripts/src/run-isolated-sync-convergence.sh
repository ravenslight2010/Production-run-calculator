#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd "${SCRIPT_DIR}/../.." && pwd)
readonly SCRIPT_DIR REPO_ROOT
cd "$REPO_ROOT"

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

cleanup() {
  local exit_status=$?
  trap - EXIT HUP INT TERM

  if [[ -n "$pg_data" && -n "$pg_bin" ]]; then
    if "$pg_bin/pg_ctl" -D "$pg_data" -m immediate -w stop >/dev/null 2>&1; then
      rm -rf -- "$pg_data"
    elif "$pg_bin/pg_ctl" -D "$pg_data" status >/dev/null 2>&1; then
      printf 'Could not stop the disposable PostgreSQL server; preserving its data directory.\n' >&2
      (( exit_status != 0 )) || exit_status=1
    else
      rm -rf -- "$pg_data"
    fi
  fi

  if [[ -n "$test_log" ]]; then
    rm -f -- "$test_log"
  fi
  exit "$exit_status"
}
trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

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
if timeout --signal=TERM --kill-after=10s 300s \
  pnpm --filter @workspace/api-server exec vitest run \
    src/routes/sync.convergence.integration.test.ts >"$test_log" 2>&1; then
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
