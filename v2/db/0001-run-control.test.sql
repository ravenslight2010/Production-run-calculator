\set ON_ERROR_STOP on

BEGIN;

INSERT INTO v2.runs (
  facility_id, id, status, revision, created_at, updated_at, setup_snapshot
) VALUES (
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000002',
  'planned',
  0,
  '2026-11-10T12:00:00Z',
  '2026-11-10T12:00:00Z',
  '{}'::jsonb
);

INSERT INTO v2.run_station_progress (
  facility_id, run_id, station_key, status, updated_at
) VALUES (
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000002',
  'dough',
  'not_started',
  '2026-11-10T12:00:00Z'
);

INSERT INTO v2.command_receipts (
  facility_id, actor_id, command_id, request_hash, response, created_at
) VALUES (
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000003',
  'start-run-0001',
  repeat('a', 64),
  '{"status":"accepted","revision":1}'::jsonb,
  '2026-11-10T12:01:00Z'
);

INSERT INTO v2.run_events (
  facility_id, run_id, revision, event_type, occurred_at, payload
) VALUES (
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000002',
  1,
  'run.started',
  '2026-11-10T12:01:00Z',
  '{"revision":1}'::jsonb
);

INSERT INTO v2.outbox_events (
  event_id, facility_id, run_id, revision, event_type, payload, created_at
) VALUES (
  '00000000-0000-4000-8000-000000000004',
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000002',
  1,
  'run.changed',
  '{"revision":1}'::jsonb,
  '2026-11-10T12:01:00Z'
);

INSERT INTO v2.worker_leases (lease_name) VALUES ('auto-track');

DO $$
DECLARE
  changed_rows integer;
BEGIN
  BEGIN
    INSERT INTO v2.runs (
      facility_id, id, status, revision, created_at, updated_at, setup_snapshot
    ) VALUES (
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000005',
      'running',
      0,
      '2026-11-10T12:00:00Z',
      '2026-11-10T12:00:00Z',
      '{}'::jsonb
    );
    RAISE EXCEPTION 'Expected invalid running state to be rejected';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  BEGIN
    INSERT INTO v2.run_pause_intervals (
      facility_id, run_id, pause_number, paused_at
    ) VALUES (
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000002',
      1,
      '2026-11-10T12:02:00Z'
    );
    INSERT INTO v2.run_pause_intervals (
      facility_id, run_id, pause_number, paused_at
    ) VALUES (
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000002',
      2,
      '2026-11-10T12:03:00Z'
    );
    RAISE EXCEPTION 'Expected only one open pause interval per run';
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;

  BEGIN
    INSERT INTO v2.command_receipts (
      facility_id, actor_id, command_id, request_hash, response, created_at
    ) VALUES (
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000003',
      'start-run-0001',
      repeat('b', 64),
      '{"status":"accepted","revision":2}'::jsonb,
      '2026-11-10T12:02:00Z'
    );
    RAISE EXCEPTION 'Expected duplicate idempotency key to be rejected';
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;

  BEGIN
    UPDATE v2.run_events
      SET payload = '{"revision":2}'::jsonb
      WHERE facility_id = '00000000-0000-4000-8000-000000000001'
        AND run_id = '00000000-0000-4000-8000-000000000002'
        AND revision = 1;
    RAISE EXCEPTION 'Expected run event mutation to be rejected';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN
    NULL;
  END;

  BEGIN
    UPDATE v2.command_receipts
      SET response = '{"status":"accepted","revision":2}'::jsonb
      WHERE facility_id = '00000000-0000-4000-8000-000000000001'
        AND actor_id = '00000000-0000-4000-8000-000000000003'
        AND command_id = 'start-run-0001';
    RAISE EXCEPTION 'Expected command receipt mutation to be rejected';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN
    NULL;
  END;

  UPDATE v2.outbox_events
    SET delivered_at = '2026-11-10T12:02:00Z'
    WHERE event_id = '00000000-0000-4000-8000-000000000004';
  GET DIAGNOSTICS changed_rows = ROW_COUNT;
  IF changed_rows <> 1 THEN
    RAISE EXCEPTION 'Expected the first outbox delivery receipt to be accepted';
  END IF;

  BEGIN
    UPDATE v2.outbox_events
      SET delivered_at = NULL
      WHERE event_id = '00000000-0000-4000-8000-000000000004';
    RAISE EXCEPTION 'Expected outbox delivery receipt reset to be rejected';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN
    NULL;
  END;

  BEGIN
    DELETE FROM v2.outbox_events
      WHERE event_id = '00000000-0000-4000-8000-000000000004';
    RAISE EXCEPTION 'Expected outbox event deletion to be rejected';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN
    NULL;
  END;

  IF NOT EXISTS (
    SELECT 1 FROM v2.outbox_events
    WHERE event_id = '00000000-0000-4000-8000-000000000004'
      AND delivered_at = '2026-11-10T12:02:00Z'
  ) THEN
    RAISE EXCEPTION 'Outbox event delivery receipt was not preserved';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM v2.command_receipts
    WHERE command_id = 'start-run-0001'
      AND response = '{"status":"accepted","revision":1}'::jsonb
  ) THEN
    RAISE EXCEPTION 'Command receipt was changed by a rejected mutation';
  END IF;
END
$$;

DO $$
DECLARE
  v_facility_id uuid := '10000000-0000-4000-8000-000000000001';
  v_run_id uuid := '10000000-0000-4000-8000-000000000002';
  v_actor_id uuid := '10000000-0000-4000-8000-000000000003';
  v_created_at timestamptz := clock_timestamp() - interval '1 minute';
  v_result jsonb;
  v_replay jsonb;
  v_conflict jsonb;
  v_count integer;
BEGIN
  INSERT INTO v2.runs (
    facility_id, id, status, revision, created_at, updated_at, setup_snapshot
  ) VALUES (
    v_facility_id, v_run_id, 'planned', 0, v_created_at, v_created_at, '{}'::jsonb
  );

  v_result := v2.apply_run_lifecycle_command(
    v_facility_id, v_run_id, v_actor_id, 'command-start-1',
    repeat('a', 64), 'start', 0
  );
  IF v_result->>'outcome' <> 'accepted'
     OR v_result->'run'->>'status' <> 'running'
     OR v_result->'run'->>'revision' <> '1' THEN
    RAISE EXCEPTION 'Run start did not return its accepted canonical state: %', v_result;
  END IF;

  v_replay := v2.apply_run_lifecycle_command(
    v_facility_id, v_run_id, v_actor_id, 'command-start-1',
    repeat('a', 64), 'start', 0
  );
  IF v_replay->>'outcome' <> 'accepted'
     OR v_replay->>'replayed' <> 'true'
     OR v_replay->'run'->>'revision' <> '1' THEN
    RAISE EXCEPTION 'Retried start did not return its original receipt: %', v_replay;
  END IF;

  BEGIN
    PERFORM v2.apply_run_lifecycle_command(
      v_facility_id, v_run_id, v_actor_id, 'command-start-1',
      repeat('b', 64), 'start', 0
    );
    RAISE EXCEPTION 'Expected idempotency key reuse to be rejected';
  EXCEPTION WHEN invalid_parameter_value THEN
    NULL;
  END;

  v_conflict := v2.apply_run_lifecycle_command(
    v_facility_id, v_run_id, v_actor_id, 'command-stale-pause',
    repeat('c', 64), 'pause', 0
  );
  IF v_conflict->>'outcome' <> 'conflict'
     OR v_conflict->'currentRun'->>'revision' <> '1'
     OR v_conflict->'currentRun'->>'status' <> 'running' THEN
    RAISE EXCEPTION 'Stale run command did not return the canonical conflict: %', v_conflict;
  END IF;

  v_result := v2.apply_run_lifecycle_command(
    v_facility_id, v_run_id, v_actor_id, 'command-pause-1',
    repeat('d', 64), 'pause', 1
  );
  IF v_result->'run'->>'status' <> 'paused' OR v_result->'run'->>'revision' <> '2' THEN
    RAISE EXCEPTION 'Run pause did not advance the canonical revision: %', v_result;
  END IF;

  v_result := v2.apply_run_lifecycle_command(
    v_facility_id, v_run_id, v_actor_id, 'command-resume-1',
    repeat('e', 64), 'resume', 2
  );
  IF v_result->'run'->>'status' <> 'running' OR v_result->'run'->>'revision' <> '3' THEN
    RAISE EXCEPTION 'Run resume did not advance the canonical revision: %', v_result;
  END IF;

  v_result := v2.apply_run_lifecycle_command(
    v_facility_id, v_run_id, v_actor_id, 'command-pause-2',
    repeat('f', 64), 'pause', 3
  );
  IF v_result->'run'->>'status' <> 'paused' OR v_result->'run'->>'revision' <> '4' THEN
    RAISE EXCEPTION 'Second run pause did not advance the canonical revision: %', v_result;
  END IF;

  v_result := v2.apply_run_lifecycle_command(
    v_facility_id, v_run_id, v_actor_id, 'command-complete-1',
    repeat('0', 64), 'complete', 4
  );
  IF v_result->'run'->>'status' <> 'completed'
     OR v_result->'run'->>'revision' <> '5'
     OR v_result->'run'->'pauseIntervals'->1->>'endedAt' IS NULL THEN
    RAISE EXCEPTION 'Run completion did not close its final pause interval: %', v_result;
  END IF;

  SELECT count(*) INTO v_count FROM v2.run_events
    WHERE facility_id = v_facility_id AND run_id = v_run_id;
  IF v_count <> 5 THEN RAISE EXCEPTION 'Expected five lifecycle events, got %', v_count; END IF;

  SELECT count(*) INTO v_count FROM v2.outbox_events
    WHERE facility_id = v_facility_id AND run_id = v_run_id;
  IF v_count <> 5 THEN RAISE EXCEPTION 'Expected five outbox events, got %', v_count; END IF;

  SELECT count(*) INTO v_count FROM v2.command_receipts
    WHERE facility_id = v_facility_id AND actor_id = v_actor_id;
  IF v_count <> 5 THEN RAISE EXCEPTION 'Expected five successful command receipts, got %', v_count; END IF;

  v_result := v2.apply_run_lifecycle_command(
    v_facility_id, v_run_id, v_actor_id, 'command-invalid-start',
    repeat('1', 64), 'start', 5
  );
  IF v_result->>'outcome' <> 'invalid_transition' THEN
    RAISE EXCEPTION 'Completed run accepted an invalid start command: %', v_result;
  END IF;
END
$$;

DO $$
DECLARE
  v_count integer;
BEGIN
  BEGIN
    PERFORM v2.create_planned_run(
      '50000000-0000-4000-8000-000000000001',
      '50000000-0000-4000-8000-000000000002',
      'invalid-missing-label', repeat('a', 64),
      '{"targetCases":1}'::jsonb
    );
    RAISE EXCEPTION 'Expected missing run label to be rejected';
  EXCEPTION WHEN invalid_parameter_value THEN
    NULL;
  END;

  BEGIN
    PERFORM v2.create_planned_run(
      '50000000-0000-4000-8000-000000000001',
      '50000000-0000-4000-8000-000000000002',
      'invalid-extra-field', repeat('b', 64),
      '{"label":"Run","targetCases":1,"facilityId":"untrusted"}'::jsonb
    );
    RAISE EXCEPTION 'Expected unsupported run setup field to be rejected';
  EXCEPTION WHEN invalid_parameter_value THEN
    NULL;
  END;

  BEGIN
    PERFORM v2.create_planned_run(
      '50000000-0000-4000-8000-000000000001',
      '50000000-0000-4000-8000-000000000002',
      'invalid-fractional-target', repeat('c', 64),
      '{"label":"Run","targetCases":1.5}'::jsonb
    );
    RAISE EXCEPTION 'Expected fractional target cases to be rejected';
  EXCEPTION WHEN invalid_parameter_value THEN
    NULL;
  END;

  SELECT count(*) INTO v_count
    FROM v2.runs
    WHERE facility_id = '50000000-0000-4000-8000-000000000001';
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'Invalid run creation left % runs behind', v_count;
  END IF;
END
$$;

ROLLBACK;
