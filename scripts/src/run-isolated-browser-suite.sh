#!/usr/bin/env bash
set -Eeuo pipefail

readonly API_PORT="${RELEASE_BROWSER_API_PORT:-18083}"
readonly WEB_PORT="${RELEASE_BROWSER_WEB_PORT:-18084}"
readonly PG_PORT="${BROWSER_TEST_POSTGRES_PORT:-15432}"
readonly DB_NAME="browser_e2e"
readonly REPORT_PATH="${PLAYWRIGHT_RELEASE_REPORT_PATH:-$PWD/release-evidence/browser-full/FINAL-REPORT.md}"
readonly PLAYWRIGHT_CONFIG="${BROWSER_TEST_PLAYWRIGHT_CONFIG:-playwright.config.ts}"

stage="checking the local PostgreSQL runtime"
pg_bin=""
pg_data=""

cleanup() {
  local exit_code=$?
  trap - EXIT
  if [[ -n "$pg_data" && -n "$pg_bin" ]]; then
    "$pg_bin/pg_ctl" -D "$pg_data" -m immediate stop >/dev/null 2>&1 || true
    rm -rf "$pg_data"
  fi
  if (( exit_code != 0 )); then
    printf 'Isolated browser validation failed while %s.\n' "$stage" >&2
    printf 'The disposable database was cleaned up; no live production records were used. Review the preceding command output, fix that stage, and retry.\n' >&2
  fi
  exit "$exit_code"
}
trap cleanup EXIT

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
"$pg_bin/pg_ctl" -D "$pg_data" -o "-F -p $PG_PORT -k /tmp" -w start >/dev/null

stage="creating the disposable browser database"
"$pg_bin/createdb" -h 127.0.0.1 -p "$PG_PORT" -U postgres "$DB_NAME"

export DATABASE_URL="postgresql://postgres@127.0.0.1:${PG_PORT}/${DB_NAME}"
export E2E_TEST_DB=1
export E2E_APPROVED_DESTRUCTIVE_MODE=1
export RELEASE_BROWSER_LOCAL_SERVERS=1
export RELEASE_BROWSER_API_PORT="$API_PORT"
export RELEASE_BROWSER_WEB_PORT="$WEB_PORT"
export PLAYWRIGHT_BASE_URL="http://127.0.0.1:${WEB_PORT}"
export PLAYWRIGHT_RELEASE_REPORT_PATH="$REPORT_PATH"

stage="applying the canonical database schema"
pnpm --filter @workspace/db run push-force

stage="running the isolated browser suite"
(
  cd artifacts/run-calculator
  pnpm exec playwright test --config="$PLAYWRIGHT_CONFIG" "$@"
)

stage="finishing isolated browser validation"