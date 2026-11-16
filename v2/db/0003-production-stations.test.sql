DO $$
DECLARE
  v_run_id uuid := '71000000-0000-4000-8000-000000000011';
  v_facility_id uuid := '71000000-0000-4000-8000-000000000001';
  v_actor_id uuid := '71000000-0000-4000-8000-000000000002';
  v_result jsonb;
  v_run jsonb;
  v_progress jsonb;
BEGIN
  v_result := v2.create_planned_run(
    v_facility_id, v_actor_id, 'station-run-create', repeat('1', 64),
    '{"label":"Synthetic station test","targetCases":40}'::jsonb
  );
  v_run_id := (v_result->'run'->>'id')::uuid;
  v_result := v2.apply_run_lifecycle_command(
    v_facility_id, v_run_id, v_actor_id, 'station-run-start', repeat('2', 64), 'start', 0
  );
  IF v_result->>'outcome' <> 'accepted' OR (v_result->'run'->>'revision')::bigint <> 1 THEN
    RAISE EXCEPTION 'station fixture run did not start canonically: %', v_result;
  END IF;

  v_result := v2.apply_station_command(
    v_facility_id, v_run_id, v_actor_id, 'station-line-config', repeat('3', 64), 1,
    'line', 'manual',
    '{"autoTrackRatePerMinute":600,"timerDurationSeconds":60,"casesPerSkid":20}'::jsonb,
    '{"casesProduced":0,"casesOnLine":0}'::jsonb,
    'casesProduced'
  );
  IF v_result->>'outcome' <> 'accepted'
     OR (v_result->'run'->>'revision')::bigint <> 2
     OR v_result->'run'->'stationProgress'->'line'->'inputs'->>'casesPerSkid' <> '20' THEN
    RAISE EXCEPTION 'station setup/progress was not returned canonically: %', v_result;
  END IF;

  v_result := v2.apply_station_command(
    v_facility_id, v_run_id, v_actor_id, 'station-line-early-tick', repeat('4', 64), 2,
    'line', 'auto_track', '{}'::jsonb, '{}'::jsonb, 'casesProduced'
  );
  IF v_result->>'outcome' <> 'not_due'
     OR (v_result->'currentRun'->>'revision')::bigint <> 2 THEN
    RAISE EXCEPTION 'automatic progress advanced before its server-owned due time: %', v_result;
  END IF;

  PERFORM pg_sleep(0.25);
  v_result := v2.apply_station_command(
    v_facility_id, v_run_id, v_actor_id, 'station-line-due-tick', repeat('5', 64), 2,
    'line', 'auto_track', '{}'::jsonb, '{}'::jsonb, 'casesProduced'
  );
  IF v_result->>'outcome' <> 'accepted'
     OR (v_result->'run'->>'revision')::bigint <> 3
     OR (v_result->'run'->'stationProgress'->'line'->'progress'->>'casesProduced')::numeric < 1 THEN
    RAISE EXCEPTION 'server automatic progress did not advance after its due time: %', v_result;
  END IF;

  v_run := v_result->'run';
  v_result := v2.apply_station_command(
    v_facility_id, v_run_id, v_actor_id, 'station-line-due-tick', repeat('5', 64), 2,
    'line', 'auto_track', '{}'::jsonb, '{}'::jsonb, 'casesProduced'
  );
  IF v_result->>'outcome' <> 'accepted' OR v_result->>'replayed' <> 'true'
     OR v_result->'run'->>'revision' <> v_run->>'revision' THEN
    RAISE EXCEPTION 'automatic command retry duplicated progress: %', v_result;
  END IF;

  v_result := v2.apply_station_command(
    v_facility_id, v_run_id, v_actor_id, 'station-line-manual-correction', repeat('6', 64), 3,
    'line', 'manual', '{}'::jsonb, '{"casesProduced":5}'::jsonb, 'casesProduced'
  );
  IF v_result->>'outcome' <> 'accepted'
     OR (v_result->'run'->'stationProgress'->'line'->'progress'->>'casesProduced')::numeric <> 5 THEN
    RAISE EXCEPTION 'manual correction did not replace the canonical counter: %', v_result;
  END IF;
  v_result := v2.apply_station_command(
    v_facility_id, v_run_id, v_actor_id, 'station-line-after-correction', repeat('7', 64), 4,
    'line', 'auto_track', '{}'::jsonb, '{}'::jsonb, 'casesProduced'
  );
  IF v_result->>'outcome' <> 'not_due'
     OR (v_result->'currentRun'->'stationProgress'->'line'->'progress'->>'casesProduced')::numeric <> 5 THEN
    RAISE EXCEPTION 'automatic progress did not rebase after a manual correction: %', v_result;
  END IF;

  v_result := v2.apply_station_command(
    v_facility_id, v_run_id, v_actor_id, 'station-line-timer-start', repeat('8', 64), 4,
    'line', 'timer_start', '{}'::jsonb, '{}'::jsonb, 'casesProduced'
  );
  IF v_result->>'outcome' <> 'accepted'
     OR v_result->'run'->'stationProgress'->'line'->'progress'->>'timerStatus' <> 'running' THEN
    RAISE EXCEPTION 'server timer did not start: %', v_result;
  END IF;
  PERFORM pg_sleep(0.15);
  v_result := v2.apply_station_command(
    v_facility_id, v_run_id, v_actor_id, 'station-line-timer-pause', repeat('9', 64), 5,
    'line', 'timer_pause', '{}'::jsonb, '{}'::jsonb, 'casesProduced'
  );
  v_progress := v_result->'run'->'stationProgress'->'line'->'progress';
  IF v_result->>'outcome' <> 'accepted'
     OR v_progress->>'timerStatus' <> 'paused'
     OR COALESCE((v_progress->>'timerElapsedMs')::numeric, 0) < 1 THEN
    RAISE EXCEPTION 'server timer pause did not preserve elapsed time: %', v_result;
  END IF;

  v_result := v2.apply_station_command(
    v_facility_id, v_run_id, v_actor_id, 'station-line-stale-edit', repeat('a', 64), 4,
    'line', 'manual', '{}'::jsonb, '{"casesProduced":1}'::jsonb, 'casesProduced'
  );
  IF v_result->>'outcome' <> 'conflict'
     OR (v_result->'currentRun'->>'revision')::bigint <> 6
     OR (v_result->'currentRun'->'stationProgress'->'line'->'progress'->>'casesProduced')::numeric <> 5 THEN
    RAISE EXCEPTION 'stale station edit did not preserve canonical progress: %', v_result;
  END IF;

  BEGIN
    PERFORM v2.apply_station_command(
      v_facility_id, v_run_id, v_actor_id, 'station-invalid-field', repeat('b', 64), 6,
      'packaging', 'manual', '{}'::jsonb, '{"casesCompleted":9}'::jsonb, 'casesPacked'
    );
    RAISE EXCEPTION 'station command accepted a field belonging to a different station';
  EXCEPTION WHEN invalid_parameter_value THEN
    NULL;
  END;

  v_result := v2.apply_station_command(
    v_facility_id, v_run_id, v_actor_id, 'station-dough-fractional-capacity', repeat('c', 64), 6,
    'dough', 'manual', '{"casesPerBatch":53.7658,"traysPerBatch":24}'::jsonb,
    '{}'::jsonb, 'casesProduced'
  );
  IF v_result->>'outcome' <> 'accepted'
     OR v_result->'run'->'stationProgress'->'dough'->'inputs'->>'casesPerBatch' <> '53.7658'
     OR v_result->'run'->'stationProgress'->'dough'->'inputs'->>'traysPerBatch' <> '24' THEN
    RAISE EXCEPTION 'fractional dough case capacity was not stored canonically: %', v_result;
  END IF;

  IF (SELECT COUNT(*) FROM v2.run_events WHERE run_id = v_run_id) <> 8 THEN
    RAISE EXCEPTION 'station operations did not append one event per accepted mutation';
  END IF;
END
$$;
