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
"${PSQL[@]}" -f "$ROOT/v2/db/0002-staff-auth.sql" >/dev/null

BOOTSTRAP_HASH='argon2id$v=19$m=19456,t=2,p=1$c2FsdA==$aGFzaA=='
BOOTSTRAP_SQL="SELECT v2.bootstrap_first_manager('V2FirstManagerRace', '$BOOTSTRAP_HASH');"
"${PSQL[@]}" -c "$BOOTSTRAP_SQL" > "$TMP_DIR/bootstrap-race-1" &
BOOTSTRAP_PID_1=$!
"${PSQL[@]}" -c "$BOOTSTRAP_SQL" > "$TMP_DIR/bootstrap-race-2" &
BOOTSTRAP_PID_2=$!
wait "$BOOTSTRAP_PID_1"
wait "$BOOTSTRAP_PID_2"
BOOTSTRAP_RESULTS="$(cat "$TMP_DIR/bootstrap-race-1" "$TMP_DIR/bootstrap-race-2" | tr -d '[:space:]' | fold -w1 | sort | tr '\n' ' ')"
BOOTSTRAP_COUNT="$("${PSQL[@]}" -c "
  SELECT count(*)
  FROM v2.staff_accounts AS u
  JOIN v2.user_roles AS ur ON ur.user_id = u.id
  WHERE lower(u.username) = 'v2firstmanagerrace' AND ur.role_name = 'manager'
")"
if [[ "$BOOTSTRAP_RESULTS" != "f t " || "$BOOTSTRAP_COUNT" != "1" ]]; then
  echo "Concurrent first-manager bootstrap did not create exactly one manager: $BOOTSTRAP_RESULTS / $BOOTSTRAP_COUNT" >&2
  exit 1
fi
"${PSQL[@]}" -c "DELETE FROM v2.staff_accounts WHERE lower(username) = 'v2firstmanagerrace';" >/dev/null
if [[ "$("${PSQL[@]}" -c "SELECT v2.staff_bootstrap_open();")" != "f" ]]; then
  echo "First-manager setup reopened after its account was removed despite its completion marker." >&2
  exit 1
fi
"${PSQL[@]}" -c "DELETE FROM v2.staff_bootstrap_marker;" >/dev/null
if [[ "$("${PSQL[@]}" -c "SELECT v2.staff_bootstrap_open();")" != "t" ]]; then
  echo "The disposable database could not be returned to its clean bootstrap state." >&2
  exit 1
fi
"${PSQL[@]}" -f "$ROOT/v2/db/0002-staff-auth.test.sql"
"${PSQL[@]}" -f "$ROOT/v2/db/0003-production-stations.sql" >/dev/null
"${PSQL[@]}" -f "$ROOT/v2/db/0003-production-stations.test.sql"
"${PSQL[@]}" -f "$ROOT/v2/db/0003-worker-leases.test.sql"
"${PSQL[@]}" -f "$ROOT/v2/db/0003-station-worker-pause.test.sql"
LEASE_RACE_SQL_A="
  SELECT COALESCE(v2.claim_worker_lease(
    'station-auto-track-race',
    '73000000-0000-4000-8000-000000000003',
    30
  )::text, 'none')
"
LEASE_RACE_SQL_B="
  SELECT COALESCE(v2.claim_worker_lease(
    'station-auto-track-race',
    '73000000-0000-4000-8000-000000000004',
    30
  )::text, 'none')
"
"${PSQL[@]}" -c "$LEASE_RACE_SQL_A" > "$TMP_DIR/lease-race-1" &
LEASE_RACE_PID_A=$!
"${PSQL[@]}" -c "$LEASE_RACE_SQL_B" > "$TMP_DIR/lease-race-2" &
LEASE_RACE_PID_B=$!
wait "$LEASE_RACE_PID_A"
wait "$LEASE_RACE_PID_B"
LEASE_RACE_RESULTS="$(cat "$TMP_DIR/lease-race-1" "$TMP_DIR/lease-race-2" | sort | tr '\n' ' ')"
if [[ "$LEASE_RACE_RESULTS" != "1 none " ]]; then
  echo "Competing station worker lease claims produced unexpected results: $LEASE_RACE_RESULTS" >&2
  exit 1
fi
"${PSQL[@]}" -c "
  SELECT v2.release_worker_lease(
    'station-auto-track-race',
    '73000000-0000-4000-8000-000000000003',
    1
  );
  SELECT v2.release_worker_lease(
    'station-auto-track-race',
    '73000000-0000-4000-8000-000000000004',
    1
  );
" >/dev/null
"${PSQL[@]}" -f "$ROOT/v2/db/0004-import-inventory.sql" >/dev/null
"${PSQL[@]}" -f "$ROOT/v2/db/0004-import-inventory.test.sql"
"${PSQL[@]}" -f "$ROOT/v2/db/0005-dough-capacity-sources.sql" >/dev/null
"${PSQL[@]}" -f "$ROOT/v2/db/0005-dough-capacity-sources.test.sql"

"${PSQL[@]}" -c "
  CREATE ROLE v2_api_test NOLOGIN;
  CREATE ROLE v2_api_login LOGIN;
  GRANT v2_api_test TO v2_api_login;
  GRANT USAGE ON SCHEMA v2 TO v2_api_test;
  GRANT EXECUTE ON FUNCTION v2.create_planned_run(uuid, uuid, text, text, jsonb) TO v2_api_test;
  GRANT EXECUTE ON FUNCTION v2.get_run(uuid, uuid) TO v2_api_test;
  GRANT EXECUTE ON FUNCTION v2.list_runs(uuid, integer) TO v2_api_test;
  GRANT EXECUTE ON FUNCTION v2.list_run_products(uuid) TO v2_api_test;
  GRANT EXECUTE ON FUNCTION v2.list_workbook_source_links(uuid, text) TO v2_api_test;
  GRANT EXECUTE ON FUNCTION v2.apply_run_lifecycle_command(
    uuid, uuid, uuid, text, text, text, bigint
  ) TO v2_api_test;
  GRANT EXECUTE ON FUNCTION v2.apply_station_command(
    uuid, uuid, uuid, text, text, bigint, text, text, jsonb, jsonb, text
  ) TO v2_api_test;
  GRANT EXECUTE ON FUNCTION v2.claim_worker_lease(text, uuid, integer) TO v2_api_test;
  GRANT EXECUTE ON FUNCTION v2.heartbeat_worker_lease(text, uuid, bigint, integer) TO v2_api_test;
  GRANT EXECUTE ON FUNCTION v2.release_worker_lease(text, uuid, bigint) TO v2_api_test;
  GRANT EXECUTE ON FUNCTION v2.list_due_station_auto_track(integer) TO v2_api_test;
  GRANT EXECUTE ON FUNCTION v2.find_staff_for_sign_in(text) TO v2_api_test;
  GRANT EXECUTE ON FUNCTION v2.open_staff_session(uuid, text, text, timestamptz) TO v2_api_test;
  GRANT EXECUTE ON FUNCTION v2.resolve_staff_session(text) TO v2_api_test;
  GRANT EXECUTE ON FUNCTION v2.revoke_staff_session(text) TO v2_api_test;
  GRANT EXECUTE ON FUNCTION v2.staff_bootstrap_open() TO v2_api_test;
  GRANT EXECUTE ON FUNCTION v2.bootstrap_first_manager(text, text) TO v2_api_test;
  GRANT EXECUTE ON FUNCTION v2.list_staff_accounts(uuid) TO v2_api_test;
  GRANT EXECUTE ON FUNCTION v2.list_staff_roles(uuid) TO v2_api_test;
  GRANT EXECUTE ON FUNCTION v2.create_staff_account(uuid, text, text, text) TO v2_api_test;
  GRANT EXECUTE ON FUNCTION v2.update_staff_account(uuid, uuid, boolean, text) TO v2_api_test;
  GRANT EXECUTE ON FUNCTION v2.list_inventory_warehouses(uuid) TO v2_api_test;
  GRANT EXECUTE ON FUNCTION v2.list_inventory_products(uuid) TO v2_api_test;
  GRANT EXECUTE ON FUNCTION v2.list_inventory_stock(uuid, uuid) TO v2_api_test;
  GRANT EXECUTE ON FUNCTION v2.list_inventory_movements(uuid, uuid, integer, timestamptz, uuid) TO v2_api_test;
  GRANT EXECUTE ON FUNCTION v2.create_inventory_warehouse(uuid, uuid, text, text, text) TO v2_api_test;
  GRANT EXECUTE ON FUNCTION v2.stage_setup_import(uuid, uuid, text, text, text, jsonb) TO v2_api_test;
  GRANT EXECUTE ON FUNCTION v2.apply_setup_import(uuid, uuid, uuid) TO v2_api_test;
  GRANT EXECUTE ON FUNCTION v2.undo_setup_import(uuid, uuid, uuid) TO v2_api_test;
  GRANT EXECUTE ON FUNCTION v2.list_setup_imports(uuid, integer) TO v2_api_test;
  GRANT EXECUTE ON FUNCTION v2.get_setup_import(uuid, uuid) TO v2_api_test;
  GRANT EXECUTE ON FUNCTION v2.record_inventory_movement(
    uuid, uuid, text, text, uuid, text, text, numeric, text
  ) TO v2_api_test;
  GRANT EXECUTE ON FUNCTION v2.transfer_inventory(
    uuid, uuid, text, text, uuid, uuid, text, numeric, text
  ) TO v2_api_test;
  GRANT EXECUTE ON FUNCTION v2.stage_opening_count(
    uuid, uuid, text, text, uuid, jsonb
  ) TO v2_api_test;
  GRANT EXECUTE ON FUNCTION v2.review_opening_count(uuid, uuid, uuid) TO v2_api_test;
  GRANT EXECUTE ON FUNCTION v2.apply_opening_count(uuid, uuid, uuid) TO v2_api_test;
  GRANT EXECUTE ON FUNCTION v2.get_opening_count(uuid, uuid) TO v2_api_test;
  GRANT EXECUTE ON FUNCTION v2.list_opening_counts(uuid, integer) TO v2_api_test;
" >/dev/null

API_WORKER_ACCESS="$("${PSQL[@]}" -c "
  SET ROLE v2_api_test;
  SELECT v2.claim_worker_lease(
    'station-auto-track-api-test',
    '20000000-0000-4000-8000-000000000009',
    30
  );
  SELECT v2.heartbeat_worker_lease(
    'station-auto-track-api-test',
    '20000000-0000-4000-8000-000000000009',
    1,
    30
  );
  SELECT count(*) >= 0 FROM v2.list_due_station_auto_track(10);
  SELECT v2.release_worker_lease(
    'station-auto-track-api-test',
    '20000000-0000-4000-8000-000000000009',
    1
  );
  RESET ROLE;
")"
if [[ "$API_WORKER_ACCESS" != $'1\nt\nt\nt' ]]; then
  echo "Restricted API role could not access station worker functions safely: $API_WORKER_ACCESS" >&2
  exit 1
fi

"${PSQL[@]}" -c "
  INSERT INTO v2.staff_accounts (id, username, password_hash, disabled)
  VALUES (
    '72000000-0000-4000-8000-000000000001',
    'V2ApiRoleCheck',
    'argon2id\$v=19\$m=19456,t=2,p=1\$c2FsdA==\$aGFzaA==',
    false
  );
  INSERT INTO v2.user_roles (user_id, role_name)
  VALUES ('72000000-0000-4000-8000-000000000001', 'operator');
" >/dev/null

API_AUTH_LOOKUP="$("${PSQL[@]}" -c "
  SET ROLE v2_api_test;
  SELECT staff_id::text || '|' || disabled
    FROM v2.find_staff_for_sign_in('v2apirolecheck');
  RESET ROLE;
")"
if [[ "$API_AUTH_LOOKUP" != "72000000-0000-4000-8000-000000000001|false" ]]; then
  echo "Restricted API role could not perform V2 sign-in lookup: $API_AUTH_LOOKUP" >&2
  exit 1
fi

API_AUTH_SESSION="$("${PSQL[@]}" -c "
  SET ROLE v2_api_test;
  SELECT v2.open_staff_session(
    '72000000-0000-4000-8000-000000000001',
    repeat('a', 64),
    repeat('b', 64),
    clock_timestamp() + interval '1 day'
  );
  SELECT actor_id::text || '|' || role_name || '|' ||
         (csrf_hash = repeat('b', 64))
    FROM v2.resolve_staff_session(repeat('a', 64));
  SELECT v2.revoke_staff_session(repeat('a', 64));
  RESET ROLE;
")"
if [[ "$API_AUTH_SESSION" != $'t\n72000000-0000-4000-8000-000000000001|operator|true\nt' ]]; then
  echo "Restricted API role could not open, resolve, and revoke a V2 session: $API_AUTH_SESSION" >&2
  exit 1
fi
"${PSQL[@]}" -c "
  DELETE FROM v2.staff_accounts
  WHERE id = '72000000-0000-4000-8000-000000000001';
" >/dev/null
if [[ "$("${PSQL[@]}" -c "SELECT v2.staff_bootstrap_open();")" != "t" ]]; then
  echo "The HTTP integration fixture did not return the V2 database to its clean bootstrap state." >&2
  exit 1
fi

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

"${PSQL[@]}" -c "
  INSERT INTO v2.products (facility_id, code, name, base_unit, active)
  VALUES
    ('40000000-0000-4000-8000-000000000001', 'TEST-RUN', 'Test Run Product', 'case', true),
    ('60000000-0000-4000-8000-000000000001', 'TEST-RACE', 'Test Race Product', 'case', true);
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

CREATE_RESULT="$("${PSQL[@]}" -c "
  SET ROLE v2_api_test;
  SELECT
    (result->>'outcome') || '|' ||
    (result->>'replayed') || '|' ||
    (result->'run'->>'status') || '|' ||
    (result->'run'->>'revision') || '|' ||
    CASE WHEN (result->'run'->>'createdAt') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$'
      THEN 'canonical-time' ELSE 'invalid-time' END
  FROM (
    SELECT v2.create_planned_run(
      '40000000-0000-4000-8000-000000000001',
      '40000000-0000-4000-8000-000000000002',
      'create-run-once', repeat('e', 64),
       '{\"label\":\"V2 run\",\"targetCases\":7,\"productCode\":\"TEST-RUN\"}'::jsonb
    ) AS result
  ) AS created;
  RESET ROLE;
")"
if [[ "$CREATE_RESULT" != "created|false|planned|0|canonical-time" ]]; then
  echo "Restricted API role could not create a canonical planned run: $CREATE_RESULT" >&2
  exit 1
fi

REPLAY_RESULT="$("${PSQL[@]}" -c "
  SET ROLE v2_api_test;
  SELECT
    (result->>'outcome') || '|' ||
    (result->>'replayed') || '|' ||
    (result->'run'->>'id')
  FROM (
    SELECT v2.create_planned_run(
      '40000000-0000-4000-8000-000000000001',
      '40000000-0000-4000-8000-000000000002',
      'create-run-once', repeat('e', 64),
       '{\"label\":\"V2 run\",\"targetCases\":7,\"productCode\":\"TEST-RUN\"}'::jsonb
    ) AS result
  ) AS replayed;
  RESET ROLE;
" )"
IFS='|' read -r REPLAY_OUTCOME REPLAYED CREATED_RUN_ID <<< "$REPLAY_RESULT"
if [[ "$REPLAY_OUTCOME" != "created" || "$REPLAYED" != "true" ]]; then
  echo "Run creation retry did not return the original result: $REPLAY_RESULT" >&2
  exit 1
fi
if [[ ! "$CREATED_RUN_ID" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$ ]]; then
  echo "Run creation returned an invalid server-generated run ID: $CREATED_RUN_ID" >&2
  exit 1
fi

READ_RESULT="$("${PSQL[@]}" -c "
  SET ROLE v2_api_test;
  SELECT
    (v2.get_run(
      '40000000-0000-4000-8000-000000000001',
      '$CREATED_RUN_ID'
    )->>'status')
    || '|' ||
    jsonb_array_length(v2.list_runs('40000000-0000-4000-8000-000000000001', 100))
    || '|' ||
    CASE WHEN v2.get_run(
      '40000000-0000-4000-8000-000000000009',
      '$CREATED_RUN_ID'
    ) IS NULL THEN 'facility-fenced' ELSE 'facility-leak' END;
  RESET ROLE;
")"
if [[ "$READ_RESULT" != "planned|1|facility-fenced" ]]; then
  echo "Facility-scoped run reads returned an unexpected result: $READ_RESULT" >&2
  exit 1
fi

CREATE_RACE_SQL="
  SELECT
    (result->>'outcome') || '|' ||
    (result->>'replayed') || '|' ||
    (result->'run'->>'id')
  FROM (
    SELECT v2.create_planned_run(
      '60000000-0000-4000-8000-000000000001',
      '60000000-0000-4000-8000-000000000002',
      '60000000-0000-4000-8000-000000000003',
      repeat('f', 64),
       '{\"label\":\"Concurrent create\",\"targetCases\":12,\"productCode\":\"TEST-RACE\"}'::jsonb
    ) AS result
  ) AS created
"

"${PSQL[@]}" -c "$CREATE_RACE_SQL" > "$TMP_DIR/create-race-1" &
CREATE_PID_1=$!
"${PSQL[@]}" -c "$CREATE_RACE_SQL" > "$TMP_DIR/create-race-2" &
CREATE_PID_2=$!
wait "$CREATE_PID_1"
wait "$CREATE_PID_2"

CREATE_RACE_RESULTS="$(cat "$TMP_DIR/create-race-1" "$TMP_DIR/create-race-2" | sort)"
CREATE_RACE_FLAGS="$(printf '%s\n' "$CREATE_RACE_RESULTS" | cut -d'|' -f2 | sort | tr '\n' ' ')"
CREATE_RACE_ID_COUNT="$(printf '%s\n' "$CREATE_RACE_RESULTS" | cut -d'|' -f3 | sort -u | wc -l | tr -d ' ')"
if [[ "$CREATE_RACE_FLAGS" != "false true " || "$CREATE_RACE_ID_COUNT" != "1" ]]; then
  echo "Concurrent run creation did not converge on one idempotent result: $CREATE_RACE_RESULTS" >&2
  exit 1
fi

CREATE_RACE_STATE="$("${PSQL[@]}" -c "
  SELECT
    (SELECT count(*) FROM v2.runs
      WHERE facility_id = '60000000-0000-4000-8000-000000000001')
    || '|' ||
    (SELECT count(*) FROM v2.run_events
      WHERE facility_id = '60000000-0000-4000-8000-000000000001')
    || '|' ||
    (SELECT count(*) FROM v2.outbox_events
      WHERE facility_id = '60000000-0000-4000-8000-000000000001')
    || '|' ||
    (SELECT count(*) FROM v2.command_receipts
      WHERE facility_id = '60000000-0000-4000-8000-000000000001'
        AND command_id = '60000000-0000-4000-8000-000000000003')
")"
if [[ "$CREATE_RACE_STATE" != "1|1|1|1" ]]; then
  echo "Concurrent run creation produced duplicate persisted effects: $CREATE_RACE_STATE" >&2
  exit 1
fi

assert_no_direct_table_access() {
  local table="$1"
  if "${PSQL[@]}" -c "SET ROLE v2_api_test; SELECT count(*) FROM $table;" \
    > /dev/null 2> "$TMP_DIR/direct-table-access.log"; then
    echo "API role unexpectedly has direct access to $table" >&2
    exit 1
  fi
  if ! grep -q "permission denied" "$TMP_DIR/direct-table-access.log"; then
    cat "$TMP_DIR/direct-table-access.log" >&2
    echo "Direct access to $table failed for an unexpected reason" >&2
    exit 1
  fi
}
assert_no_direct_table_access "v2.runs"
assert_no_direct_table_access "v2.staff_accounts"
assert_no_direct_table_access "v2.staff_sessions"
assert_no_direct_table_access "v2.staff_bootstrap_marker"
assert_no_direct_table_access "v2.user_roles"
assert_no_direct_table_access "v2.roles"
assert_no_direct_table_access "v2.facility_scope"
assert_no_direct_table_access "v2.products"
assert_no_direct_table_access "v2.master_records"
assert_no_direct_table_access "v2.setup_imports"
assert_no_direct_table_access "v2.inventory_warehouses"
assert_no_direct_table_access "v2.inventory_balances"
assert_no_direct_table_access "v2.inventory_movements"
assert_no_direct_table_access "v2.opening_counts"

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

STATION_RUN_ID="50000000-0000-4000-8000-000000000002"
"${PSQL[@]}" -c "
  WITH test_time AS (SELECT clock_timestamp() AS at)
  INSERT INTO v2.runs (
    facility_id, id, status, created_at, updated_at, started_at, setup_snapshot
  )
  SELECT
    '50000000-0000-4000-8000-000000000001'::uuid,
    '$STATION_RUN_ID'::uuid,
    'running', at, at, at,
    '{\"label\":\"Concurrent station test\",\"targetCases\":10}'::jsonb
  FROM test_time
" >/dev/null

STATION_COMMAND_A_SQL="
  SET ROLE v2_api_test;
  SELECT (result->>'outcome') || '|' ||
         COALESCE(result->'run'->>'revision', result->'currentRun'->>'revision')
  FROM (
    SELECT v2.apply_station_command(
      '50000000-0000-4000-8000-000000000001',
      '$STATION_RUN_ID',
      '20000000-0000-4000-8000-000000000005',
      'station-concurrent-a', repeat('f', 64), 0,
      'line', 'manual', '{}'::jsonb, '{\"casesProduced\":1}'::jsonb,
      'casesProduced'
    ) AS result
  ) AS command_result;
  RESET ROLE;
"
STATION_COMMAND_B_SQL="
  SET ROLE v2_api_test;
  SELECT (result->>'outcome') || '|' ||
         COALESCE(result->'run'->>'revision', result->'currentRun'->>'revision')
  FROM (
    SELECT v2.apply_station_command(
      '50000000-0000-4000-8000-000000000001',
      '$STATION_RUN_ID',
      '20000000-0000-4000-8000-000000000006',
      'station-concurrent-b', repeat('e', 64), 0,
      'line', 'manual', '{}'::jsonb, '{\"casesProduced\":2}'::jsonb,
      'casesProduced'
    ) AS result
  ) AS command_result;
  RESET ROLE;
"
"${PSQL[@]}" -c "$STATION_COMMAND_A_SQL" > "$TMP_DIR/station-concurrent-1" &
STATION_PID_1=$!
"${PSQL[@]}" -c "$STATION_COMMAND_B_SQL" > "$TMP_DIR/station-concurrent-2" &
STATION_PID_2=$!
wait "$STATION_PID_1"
wait "$STATION_PID_2"
STATION_CONFLICT_RESULTS="$(cat "$TMP_DIR/station-concurrent-1" "$TMP_DIR/station-concurrent-2" | sort | tr '\n' ' ')"
if [[ "$STATION_CONFLICT_RESULTS" != "accepted|1 conflict|1 " ]]; then
  echo "Concurrent station revision race produced unexpected results: $STATION_CONFLICT_RESULTS" >&2
  exit 1
fi
STATION_FINAL_STATE="$("${PSQL[@]}" -c "
  SELECT revision || '|' ||
    (SELECT count(*) FROM v2.run_events WHERE run_id = '$STATION_RUN_ID') || '|' ||
    (SELECT count(*) FROM v2.command_receipts
      WHERE command_id IN ('station-concurrent-a', 'station-concurrent-b')) || '|' ||
    (SELECT progress->>'casesProduced' FROM v2.run_station_progress
      WHERE run_id = '$STATION_RUN_ID' AND station_key = 'line')
  FROM v2.runs WHERE id = '$STATION_RUN_ID'
")"
if [[ "$STATION_FINAL_STATE" != "1|1|1|1" && "$STATION_FINAL_STATE" != "1|1|1|2" ]]; then
  echo "Concurrent station race left unexpected canonical state: $STATION_FINAL_STATE" >&2
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

RACE_IDS="$("${PSQL[@]}" <<'SQL'
SELECT facility_id AS race_facility FROM v2.facility_scope WHERE singleton \gset
SELECT (v2.stage_setup_import(
  :'race_facility'::uuid,
  '99000000-0000-4000-8000-000000000002',
  'stock-race-product',
  repeat('6', 64),
  'products',
  '[{"code":"RACE","name":"Race Product","unit":"each"}]'::jsonb
)->>'importId') AS race_import \gset
SELECT v2.apply_setup_import(
  :'race_facility'::uuid,
  '99000000-0000-4000-8000-000000000002',
  :'race_import'::uuid
) AS applied \gset
SELECT (v2.create_inventory_warehouse(
  :'race_facility'::uuid,
  '99000000-0000-4000-8000-000000000002',
  'stock-race-warehouse',
  repeat('7', 64),
  'Race warehouse'
)->'warehouse'->>'id') AS race_warehouse \gset
SELECT (v2.stage_opening_count(
  :'race_facility'::uuid,
  '99000000-0000-4000-8000-000000000002',
  'stock-race-opening',
  repeat('8', 64),
  :'race_warehouse'::uuid,
  (
    SELECT jsonb_agg(jsonb_build_object(
      'productCode', code,
      'quantity', CASE WHEN code = 'RACE' THEN '1' ELSE '0' END
    ))
    FROM v2.products
    WHERE facility_id = :'race_facility'::uuid AND active
  )
)->>'countId') AS race_count \gset
SELECT v2.review_opening_count(
  :'race_facility'::uuid,
  '99000000-0000-4000-8000-000000000002',
  :'race_count'::uuid
) AS reviewed \gset
SELECT v2.apply_opening_count(
  :'race_facility'::uuid,
  '99000000-0000-4000-8000-000000000002',
  :'race_count'::uuid
) AS applied \gset
\echo :race_facility|:race_warehouse
SQL
)"
IFS='|' read -r RACE_FACILITY RACE_WAREHOUSE <<< "$RACE_IDS"
RACE_ACTOR="99000000-0000-4000-8000-000000000002"
RACE_COMMAND_A="
  SELECT v2.record_inventory_movement(
    '$RACE_FACILITY', '$RACE_ACTOR', 'stock-race-adjust-a', repeat('9', 64),
    '$RACE_WAREHOUSE', 'RACE', 'adjustment', 1, 'Concurrent correction A'
  )"
RACE_COMMAND_B="
  SELECT v2.record_inventory_movement(
    '$RACE_FACILITY', '$RACE_ACTOR', 'stock-race-adjust-b', repeat('a', 64),
    '$RACE_WAREHOUSE', 'RACE', 'adjustment', 1, 'Concurrent correction B'
  )"
"${PSQL[@]}" -c "$RACE_COMMAND_A" > "$TMP_DIR/stock-race-a" &
STOCK_RACE_PID_A=$!
"${PSQL[@]}" -c "$RACE_COMMAND_B" > "$TMP_DIR/stock-race-b" &
STOCK_RACE_PID_B=$!
wait "$STOCK_RACE_PID_A"
wait "$STOCK_RACE_PID_B"
STOCK_RACE_STATE="$("${PSQL[@]}" -c "
  SELECT b.quantity::text || '|' || count(m.id)
  FROM v2.inventory_balances b
  JOIN v2.inventory_movements m
    ON m.facility_id = b.facility_id
   AND m.warehouse_id = b.warehouse_id
   AND m.product_id = b.product_id
  WHERE b.facility_id = '$RACE_FACILITY'
    AND b.warehouse_id = '$RACE_WAREHOUSE'
  GROUP BY b.quantity
")"
if [[ "$STOCK_RACE_STATE" != "3.000000|3" ]]; then
  echo "Concurrent inventory adjustments did not serialize correctly: $STOCK_RACE_STATE" >&2
  exit 1
fi

"${PSQL[@]}" -f "$ROOT/v2/db/0006-run-inventory-linkage.sql" >/dev/null
"${PSQL[@]}" -c "
  GRANT EXECUTE ON FUNCTION v2.set_production_warehouse(uuid, uuid, text, text, uuid) TO v2_api_test;
  GRANT EXECUTE ON FUNCTION v2.complete_run_with_inventory(uuid, uuid, uuid, text, text, text, bigint) TO v2_api_test;
" >/dev/null
assert_no_direct_table_access "v2.run_inventory_consumptions"
assert_no_direct_table_access "v2.inventory_movements"
INVENTORY_COMPLETION_PRIVILEGES="$("${PSQL[@]}" -c "
  SET ROLE v2_api_test;
  SELECT has_function_privilege(current_user,
    'v2.set_production_warehouse(uuid,uuid,text,text,uuid)', 'EXECUTE')
    AND has_function_privilege(current_user,
    'v2.complete_run_with_inventory(uuid,uuid,uuid,text,text,text,bigint)', 'EXECUTE');
  RESET ROLE;
")"
if [[ "$INVENTORY_COMPLETION_PRIVILEGES" != "t" ]]; then
  echo "Restricted API role lacks the intended inventory/run command access." >&2
  exit 1
fi
ENCODED_DB_USER="$(python3 - "$DB_USER" <<'PY'
import sys
import urllib.parse

print(urllib.parse.quote(sys.argv[1], safe=""))
PY
)"
V2_TEST_ADMIN_URL="postgresql://$ENCODED_DB_USER@127.0.0.1:$PORT/v2_test"
V2_API_URL="postgresql://v2_api_login@127.0.0.1:$PORT/v2_test"
V2_TEST_ADMIN_URL="$V2_TEST_ADMIN_URL" V2_DATABASE_URL="$V2_API_URL" \
  NODE_ENV=development PORT=0 node "$ROOT/v2/server/http-postgres.integration.mjs"
V2_DATABASE_URL="$V2_API_URL" NODE_ENV=development \
  node "$ROOT/v2/server/http-postgres.browser.integration.mjs"
"${PSQL[@]}" -f "$ROOT/v2/db/0006-run-inventory-linkage.test.sql"
"${PSQL[@]}" -f "$ROOT/v2/db/0007-staff-role-equivalents.sql" >/dev/null
"${PSQL[@]}" -f "$ROOT/v2/db/0007-staff-role-equivalents.test.sql"
"${PSQL[@]}" -f "$ROOT/v2/db/cutover-transfer-rehearsal.test.sql"

printf 'Run schema and lifecycle checks passed.\n'
printf 'Concurrent first-manager bootstrap passed: exactly one manager was created.\n'
printf 'Restricted API role check passed: %s\n' "$API_ROLE_RESULT"
printf 'Restricted API station worker function access passed: %s\n' "$API_WORKER_ACCESS"
printf 'V2 auth function access passed: %s\n' "$API_AUTH_LOOKUP / session lookup / revoke"
printf 'Restricted API role has no direct table access (runs and auth data).\n'
printf 'Restricted API run creation passed: %s\n' "$CREATE_RESULT"
printf 'Run creation replay passed: %s\n' "$REPLAY_RESULT"
printf 'Facility-scoped run reads passed: %s\n' "$READ_RESULT"
printf 'Concurrent run creation passed: %s (%s)\n' "$CREATE_RACE_FLAGS" "$CREATE_RACE_STATE"
printf 'Same-key retry race passed: %s\n' "$SAME_RESULTS"
printf 'Competing revision race passed: %s\n' "$CONFLICT_RESULTS"
printf 'Concurrent station revision race passed: %s (%s)\n' "$STATION_CONFLICT_RESULTS" "$STATION_FINAL_STATE"
printf 'Competing station worker lease claim passed: %s\n' "$LEASE_RACE_RESULTS"
printf 'Stored state and event counts passed: %s\n' "$FINAL_STATE"
printf 'Concurrent stock adjustment and ledger reconciliation passed: %s\n' "$STOCK_RACE_STATE"
printf 'V2 run-to-inventory snapshot, shortage, and retry checks passed.\n'
printf 'Restricted API run/inventory command grants passed: %s\n' "$INVENTORY_COMPLETION_PRIVILEGES"
printf 'Synthetic V1-to-V2 setup and staff transfer rehearsal passed.\n'
