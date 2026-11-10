#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PG_BIN="$(dirname "$(command -v initdb)")"
TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/v2-run-control.XXXXXX")"
PORT="$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1]); s.close()')"
DB_USER="$(id -un)"

cleanup() {
  "$PG_BIN/pg_ctl" -D "$TMP_DIR/data" -m immediate -w stop >/dev/null 2>&1 || true
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

if [[ "$(id -u)" -eq 0 ]]; then
  echo "Run this check as a non-root user; initdb refuses root." >&2
  exit 1
fi

"$PG_BIN/initdb" \
  -D "$TMP_DIR/data" \
  -U "$DB_USER" \
  --no-locale \
  --encoding=UTF8 \
  --auth-local=trust \
  --auth-host=trust >/dev/null

if ! "$PG_BIN/pg_ctl" \
  -D "$TMP_DIR/data" \
  -o "-F -p $PORT -h 127.0.0.1 -k $TMP_DIR" \
  -l "$TMP_DIR/postgres.log" \
  -w start >/dev/null; then
  cat "$TMP_DIR/postgres.log" >&2
  exit 1
fi

"$PG_BIN/createdb" -h 127.0.0.1 -p "$PORT" -U "$DB_USER" v2_test
PSQL=(
  "$PG_BIN/psql" -X -q -A -t -v ON_ERROR_STOP=1
  -h 127.0.0.1 -p "$PORT" -U "$DB_USER" -d v2_test
)

"${PSQL[@]}" -f "$ROOT/v2/db/0001-run-control.sql" >/dev/null
"${PSQL[@]}" -f "$ROOT/v2/db/0001-run-control.test.sql"

"${PSQL[@]}" -c "
  CREATE ROLE v2_api_test NOLOGIN;
  GRANT USAGE ON SCHEMA v2 TO v2_api_test;
  GRANT EXECUTE ON FUNCTION v2.apply_run_lifecycle_command(
    uuid, uuid, uuid, text, text, text, bigint
  ) TO v2_api_test;
" >/dev/null

"${PSQL[@]}" -c "
  WITH test_time AS (
    SELECT clock_timestamp() - interval '1 minute' AS created_at
  )
  INSERT INTO v2.runs (
    facility_id, id, status, created_at, updated_at, setup_snapshot
  )
  SELECT
    '20000000-0000-4000-8000-000000000001'::uuid,
    '20000000-0000-4000-8000-000000000002'::uuid,
    'planned', created_at, created_at, '{}'::jsonb
  FROM test_time
  UNION ALL
  SELECT
    '20000000-0000-4000-8000-000000000003'::uuid,
    '20000000-0000-4000-8000-000000000004'::uuid,
    'planned', created_at, created_at, '{}'::jsonb
  FROM test_time
  UNION ALL
  SELECT
    '30000000-0000-4000-8000-000000000001'::uuid,
    '30000000-0000-4000-8000-000000000002'::uuid,
    'planned', created_at, created_at, '{}'::jsonb
  FROM test_time
" >/dev/null

API_ROLE_RESULT="$("${PSQL[@]}" -c "
  SET ROLE v2_api_test;
  SELECT (result->>'outcome') || '|' || (result->>'replayed') || '|' ||
         (result->'run'->>'revision')
  FROM (
    SELECT v2.apply_run_lifecycle_command(
      '30000000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000002',
      '30000000-0000-4000-8000-000000000003',
      'api-role-start', repeat('d', 64), 'start', 0
    ) AS result
  ) AS command_result;
  RESET ROLE;
")"
if [[ "$API_ROLE_RESULT" != "accepted|false|1" ]]; then
  echo "Restricted API role could not use the command boundary: $API_ROLE_RESULT" >&2
  exit 1
fi

if "${PSQL[@]}" -c "SET ROLE v2_api_test; SELECT count(*) FROM v2.runs;" \
  > /dev/null 2> "$TMP_DIR/direct-table-access.log"; then
  echo "API role unexpectedly has direct table access" >&2
  exit 1
fi
if ! grep -q "permission denied" "$TMP_DIR/direct-table-access.log"; then
  cat "$TMP_DIR/direct-table-access.log" >&2
  echo "Direct table access failed for an unexpected reason" >&2
  exit 1
fi

SAME_COMMAND_SQL="
  SELECT (result->>'outcome') || '|' || (result->>'replayed') || '|' ||
         (result->'run'->>'revision')
  FROM (
    SELECT v2.apply_run_lifecycle_command(
      '20000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000002',
      '20000000-0000-4000-8000-000000000005',
      'same-key', repeat('a', 64), 'start', 0
    ) AS result
  ) AS command_result
"

"${PSQL[@]}" -c "$SAME_COMMAND_SQL" > "$TMP_DIR/same-key-1" &
SAME_PID_1=$!
"${PSQL[@]}" -c "$SAME_COMMAND_SQL" > "$TMP_DIR/same-key-2" &
SAME_PID_2=$!
wait "$SAME_PID_1"
wait "$SAME_PID_2"

SAME_RESULTS="$(cat "$TMP_DIR/same-key-1" "$TMP_DIR/same-key-2" | sort | tr '\n' ' ')"
if [[ "$SAME_RESULTS" != "accepted|false|1 accepted|true|1 " ]]; then
  echo "Same-key retry race produced unexpected results: $SAME_RESULTS" >&2
  exit 1
fi

START_A_SQL="
  SELECT result->>'outcome'
  FROM (
    SELECT v2.apply_run_lifecycle_command(
      '20000000-0000-4000-8000-000000000003',
      '20000000-0000-4000-8000-000000000004',
      '20000000-0000-4000-8000-000000000005',
      'start-a', repeat('b', 64), 'start', 0
    ) AS result
  ) AS command_result
"
START_B_SQL="
  SELECT result->>'outcome'
  FROM (
    SELECT v2.apply_run_lifecycle_command(
      '20000000-0000-4000-8000-000000000003',
      '20000000-0000-4000-8000-000000000004',
      '20000000-0000-4000-8000-000000000006',
      'start-b', repeat('c', 64), 'start', 0
    ) AS result
  ) AS command_result
"

"${PSQL[@]}" -c "$START_A_SQL" > "$TMP_DIR/conflict-1" &
CONFLICT_PID_1=$!
"${PSQL[@]}" -c "$START_B_SQL" > "$TMP_DIR/conflict-2" &
CONFLICT_PID_2=$!
wait "$CONFLICT_PID_1"
wait "$CONFLICT_PID_2"

CONFLICT_RESULTS="$(cat "$TMP_DIR/conflict-1" "$TMP_DIR/conflict-2" | sort | tr '\n' ' ')"
if [[ "$CONFLICT_RESULTS" != "accepted conflict " ]]; then
  echo "Competing revision race produced unexpected results: $CONFLICT_RESULTS" >&2
  exit 1
fi

FINAL_STATE="$("${PSQL[@]}" -c "
  SELECT
    (SELECT status || '|' || revision FROM v2.runs
      WHERE id = '20000000-0000-4000-8000-000000000002')
    || '|' ||
    (SELECT count(*) FROM v2.run_events
      WHERE run_id = '20000000-0000-4000-8000-000000000002')
    || '|' ||
    (SELECT count(*) FROM v2.command_receipts WHERE command_id = 'same-key')
    || '|' ||
    (SELECT status || '|' || revision FROM v2.runs
      WHERE id = '20000000-0000-4000-8000-000000000004')
    || '|' ||
    (SELECT count(*) FROM v2.run_events
      WHERE run_id = '20000000-0000-4000-8000-000000000004')
")"

if [[ "$FINAL_STATE" != "running|1|1|1|running|1|1" ]]; then
  echo "Race checks left unexpected database state: $FINAL_STATE" >&2
  exit 1
fi

printf 'Run schema and lifecycle checks passed.\n'
printf 'Restricted API role check passed: %s\n' "$API_ROLE_RESULT"
printf 'Same-key retry race passed: %s\n' "$SAME_RESULTS"
printf 'Competing revision race passed: %s\n' "$CONFLICT_RESULTS"
printf 'Stored state and event counts passed: %s\n' "$FINAL_STATE"
