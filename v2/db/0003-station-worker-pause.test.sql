DO $$
DECLARE
  v_facility_id uuid := '74000000-0000-4000-8000-000000000001';
  v_actor_id uuid := '74000000-0000-4000-8000-000000000002';
  v_run_id uuid;
  v_started_at timestamptz := clock_timestamp() - interval '100 seconds';
  v_result jsonb;
  v_progress jsonb;
  v_cases numeric;
  v_remainder numeric;
BEGIN
  v_result := v2.create_planned_run(
    v_facility_id, v_actor_id, 'worker-pause-run-create', repeat('c', 64),
    '{"label":"Worker pause test","targetCases":1000}'::jsonb
  );
  v_run_id := (v_result->'run'->>'id')::uuid;
  v_result := v2.apply_run_lifecycle_command(
    v_facility_id, v_run_id, v_actor_id, 'worker-pause-run-start',
    repeat('d', 64), 'start', 0
  );
  IF v_result->>'outcome' <> 'accepted' THEN
    RAISE EXCEPTION 'worker pause fixture run did not start: %', v_result;
  END IF;

  v_result := v2.apply_station_command(
    v_facility_id, v_run_id, v_actor_id, 'worker-pause-station-config',
    repeat('e', 64), 1, 'line', 'manual',
    '{"autoTrackRatePerMinute":60,"casesPerSkid":20}'::jsonb,
    '{"casesProduced":0}'::jsonb, 'casesProduced'
  );
  IF v_result->>'outcome' <> 'accepted' THEN
    RAISE EXCEPTION 'worker pause fixture station did not configure: %', v_result;
  END IF;

  UPDATE v2.runs
    SET created_at = v_started_at - interval '1 second',
        started_at = v_started_at,
        updated_at = clock_timestamp()
    WHERE facility_id = v_facility_id AND id = v_run_id;
  UPDATE v2.run_station_progress
    SET progress = jsonb_set(
          progress,
          '{autoTrackLastAt}',
          to_jsonb(to_char(v_started_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
        ) || '{"autoTrackRemainder":0.5}'::jsonb,
        next_due_at = v_started_at,
        updated_at = clock_timestamp()
    WHERE facility_id = v_facility_id AND run_id = v_run_id AND station_key = 'line';
  INSERT INTO v2.run_pause_intervals (
    facility_id, run_id, pause_number, paused_at, resumed_at
  ) VALUES (
    v_facility_id, v_run_id, 1, v_started_at + interval '20 seconds',
    v_started_at + interval '80.25 seconds'
  );

  IF NOT EXISTS (
    SELECT 1 FROM v2.list_due_station_auto_track(50)
    WHERE facility_id = v_facility_id AND run_id = v_run_id AND station_key = 'line'
  ) THEN
    RAISE EXCEPTION 'running due station was not returned to the worker';
  END IF;
  v_result := v2.apply_run_lifecycle_command(
    v_facility_id, v_run_id, v_actor_id, 'worker-pause-run-pause',
    repeat('1', 64), 'pause', 2
  );
  IF v_result->>'outcome' <> 'accepted'
     OR EXISTS (
       SELECT 1 FROM v2.list_due_station_auto_track(50)
       WHERE facility_id = v_facility_id AND run_id = v_run_id AND station_key = 'line'
     ) THEN
    RAISE EXCEPTION 'paused run remained eligible for background station work: %', v_result;
  END IF;
  v_result := v2.apply_run_lifecycle_command(
    v_facility_id, v_run_id, v_actor_id, 'worker-pause-run-resume',
    repeat('2', 64), 'resume', 3
  );
  IF v_result->>'outcome' <> 'accepted'
     OR NOT EXISTS (
       SELECT 1 FROM v2.list_due_station_auto_track(50)
       WHERE facility_id = v_facility_id AND run_id = v_run_id AND station_key = 'line'
     ) THEN
    RAISE EXCEPTION 'resumed due station was not returned to the worker: %', v_result;
  END IF;

  v_result := v2.apply_station_command(
    v_facility_id, v_run_id, v_actor_id, 'worker-pause-auto-track',
    repeat('f', 64), 4, 'line', 'auto_track', '{}'::jsonb, '{}'::jsonb,
    'casesProduced'
  );
  v_progress := v_result->'run'->'stationProgress'->'line'->'progress';
  v_cases := (v_progress->>'casesProduced')::numeric;
  v_remainder := (v_progress->>'autoTrackRemainder')::numeric;
  IF v_result->>'outcome' <> 'accepted'
     OR v_cases <> 40
     OR v_remainder < 0.2 OR v_remainder > 0.5 THEN
    RAISE EXCEPTION 'worker station tick did not preserve pause-aware fractional carry: %', v_result;
  END IF;
END
$$;
