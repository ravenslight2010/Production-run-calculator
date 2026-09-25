#!/usr/bin/env bash
set -Eeuo pipefail

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
  (
    cd artifacts/run-calculator
    pnpm exec playwright install webkit
  )
fi

stage="applying the canonical database schema"
pnpm --filter @workspace/db run push-force

stage="running the isolated browser suite"
(
  cd artifacts/run-calculator
  pnpm exec playwright test --config="$PLAYWRIGHT_CONFIG" "${playwright_args[@]}"
)

stage="finishing isolated browser validation"