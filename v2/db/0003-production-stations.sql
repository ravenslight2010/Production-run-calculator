BEGIN;

CREATE FUNCTION v2.claim_worker_lease(
  p_lease_name text,
  p_owner_id uuid,
  p_ttl_seconds integer
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, v2
AS $$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_generation bigint;
BEGIN
  IF p_lease_name IS NULL OR length(p_lease_name) NOT BETWEEN 1 AND 100
     OR p_owner_id IS NULL OR p_ttl_seconds IS NULL
     OR p_ttl_seconds NOT BETWEEN 10 AND 300 THEN
    RAISE EXCEPTION 'Invalid worker lease request' USING ERRCODE = '22023';
  END IF;

  INSERT INTO v2.worker_leases (
    lease_name, owner_id, generation, heartbeat_at, expires_at
  ) VALUES (
    p_lease_name, p_owner_id, 1, v_now, v_now + make_interval(secs => p_ttl_seconds)
  )
  ON CONFLICT (lease_name) DO UPDATE
    SET owner_id = EXCLUDED.owner_id,
        generation = v2.worker_leases.generation + 1,
        heartbeat_at = EXCLUDED.heartbeat_at,
        expires_at = EXCLUDED.expires_at
    WHERE v2.worker_leases.owner_id IS NULL
       OR v2.worker_leases.expires_at <= v_now
  RETURNING generation INTO v_generation;

  RETURN v_generation;
END
$$;

CREATE FUNCTION v2.heartbeat_worker_lease(
  p_lease_name text,
  p_owner_id uuid,
  p_generation bigint,
  p_ttl_seconds integer
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, v2
AS $$
DECLARE
  v_now timestamptz := clock_timestamp();
BEGIN
  IF p_lease_name IS NULL OR length(p_lease_name) NOT BETWEEN 1 AND 100
     OR p_owner_id IS NULL OR p_generation IS NULL OR p_generation < 1
     OR p_ttl_seconds IS NULL OR p_ttl_seconds NOT BETWEEN 10 AND 300 THEN
    RAISE EXCEPTION 'Invalid worker lease heartbeat' USING ERRCODE = '22023';
  END IF;

  UPDATE v2.worker_leases
    SET heartbeat_at = v_now,
        expires_at = v_now + make_interval(secs => p_ttl_seconds)
    WHERE lease_name = p_lease_name
      AND owner_id = p_owner_id
      AND generation = p_generation
      AND expires_at > v_now;
  RETURN FOUND;
END
$$;

CREATE FUNCTION v2.release_worker_lease(
  p_lease_name text,
  p_owner_id uuid,
  p_generation bigint
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, v2
AS $$
BEGIN
  IF p_lease_name IS NULL OR length(p_lease_name) NOT BETWEEN 1 AND 100
     OR p_owner_id IS NULL OR p_generation IS NULL OR p_generation < 1 THEN
    RAISE EXCEPTION 'Invalid worker lease release' USING ERRCODE = '22023';
  END IF;

  UPDATE v2.worker_leases
    SET owner_id = NULL,
        heartbeat_at = NULL,
        expires_at = NULL
    WHERE lease_name = p_lease_name
      AND owner_id = p_owner_id
      AND generation = p_generation;
  RETURN FOUND;
END
$$;

CREATE FUNCTION v2.list_due_station_auto_track(p_limit integer)
RETURNS TABLE (
  facility_id uuid,
  run_id uuid,
  expected_revision bigint,
  station_key text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, v2
AS $$
BEGIN
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'Invalid station worker batch size' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
    SELECT r.facility_id, r.id, r.revision, s.station_key
    FROM v2.runs AS r
    JOIN v2.run_station_progress AS s
      ON s.facility_id = r.facility_id AND s.run_id = r.id
    WHERE r.status = 'running'
      AND s.next_due_at IS NOT NULL
      AND s.next_due_at <= clock_timestamp()
      AND COALESCE((s.inputs->>'autoTrackRatePerMinute')::numeric, 0) > 0
    ORDER BY s.next_due_at, r.facility_id, r.id, s.station_key
    LIMIT p_limit;
END
$$;

CREATE OR REPLACE FUNCTION v2.run_snapshot(p_facility_id uuid, p_run_id uuid)
RETURNS jsonb
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, v2
AS $$
  SELECT jsonb_build_object(
    'id', r.id,
    'status', r.status,
    'revision', r.revision,
    'createdAt', to_char(r.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'updatedAt', to_char(r.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'serverNow', to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'startedAt', CASE WHEN r.started_at IS NULL THEN NULL
      ELSE to_char(r.started_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END,
    'pausedAt', CASE WHEN r.paused_at IS NULL THEN NULL
      ELSE to_char(r.paused_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END,
    'resumedAt', CASE WHEN r.resumed_at IS NULL THEN NULL
      ELSE to_char(r.resumed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END,
    'completedAt', CASE WHEN r.completed_at IS NULL THEN NULL
      ELSE to_char(r.completed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END,
    'setupSnapshot', r.setup_snapshot,
    'pauseIntervals', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'startedAt', to_char(p.paused_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
          'endedAt', CASE WHEN p.resumed_at IS NULL THEN NULL
            ELSE to_char(p.resumed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END
        )
        ORDER BY p.pause_number
      )
      FROM v2.run_pause_intervals AS p
      WHERE p.facility_id = p_facility_id AND p.run_id = p_run_id
    ), '[]'::jsonb),
    'stationProgress', COALESCE((
      SELECT jsonb_object_agg(
        s.station_key,
        jsonb_build_object(
          'status', s.status,
          'revision', s.revision,
          'inputs', s.inputs,
          'progress', s.progress,
          'startedAt', CASE WHEN s.started_at IS NULL THEN NULL
            ELSE to_char(s.started_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END,
          'pausedAt', CASE WHEN s.paused_at IS NULL THEN NULL
            ELSE to_char(s.paused_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END,
          'completedAt', CASE WHEN s.completed_at IS NULL THEN NULL
            ELSE to_char(s.completed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END,
          'nextDueAt', CASE WHEN s.next_due_at IS NULL THEN NULL
            ELSE to_char(s.next_due_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END,
          'updatedAt', to_char(s.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
        )
        ORDER BY s.station_key
      )
      FROM v2.run_station_progress AS s
      WHERE s.facility_id = p_facility_id AND s.run_id = p_run_id
    ), '{}'::jsonb)
  )
  FROM v2.runs AS r
  WHERE r.facility_id = p_facility_id AND r.id = p_run_id
$$;

CREATE FUNCTION v2.apply_station_command(
  p_facility_id uuid,
  p_run_id uuid,
  p_actor_id uuid,
  p_command_id text,
  p_request_hash text,
  p_expected_revision bigint,
  p_station_key text,
  p_mode text,
  p_inputs_patch jsonb,
  p_progress_patch jsonb,
  p_auto_track_field text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, v2
AS $$
DECLARE
  v_run v2.runs%ROWTYPE;
  v_station v2.run_station_progress%ROWTYPE;
  v_existing_hash text;
  v_existing_response jsonb;
  v_now timestamptz;
  v_station_exists boolean;
  v_allowed_inputs text[];
  v_allowed_progress text[];
  v_integer_fields text[];
  v_field text;
  v_inputs jsonb;
  v_progress jsonb;
  v_rate numeric;
  v_target numeric;
  v_current numeric;
  v_last timestamptz;
  v_active_seconds numeric;
  v_pause_ms numeric;
  v_remainder numeric;
  v_total numeric;
  v_increment numeric;
  v_elapsed_ms numeric;
  v_timer_status text;
  v_response jsonb;
  v_event_type text;
  v_revision bigint;
BEGIN
  IF p_facility_id IS NULL OR p_run_id IS NULL OR p_actor_id IS NULL
     OR p_command_id IS NULL OR length(btrim(p_command_id)) = 0
     OR length(p_command_id) > 200
     OR p_request_hash IS NULL OR p_request_hash !~ '^[0-9a-f]{64}$'
     OR p_expected_revision IS NULL OR p_expected_revision < 0
     OR p_station_key IS NULL OR p_station_key NOT IN
       ('line', 'dough', 'cheese', 'pepperoni', 'sauce', 'frontline', 'packaging')
     OR p_mode IS NULL OR p_mode NOT IN
       ('manual', 'auto_track', 'timer_start', 'timer_pause', 'timer_resume', 'timer_reset')
     OR p_inputs_patch IS NULL OR jsonb_typeof(p_inputs_patch) <> 'object'
     OR p_progress_patch IS NULL OR jsonb_typeof(p_progress_patch) <> 'object'
     OR p_auto_track_field IS NULL OR length(p_auto_track_field) NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'Invalid station command' USING ERRCODE = '22023';
  END IF;

  v_allowed_inputs := ARRAY['autoTrackRatePerMinute', 'timerDurationSeconds'];
  v_allowed_progress := ARRAY[]::text[];
  v_integer_fields := ARRAY['timerDurationSeconds'];
  CASE p_station_key
    WHEN 'line' THEN
      v_allowed_inputs := v_allowed_inputs || ARRAY['casesPerSkid'];
      v_allowed_progress := ARRAY['casesProduced', 'casesOnLine', 'casesInFreezer'];
      v_integer_fields := v_integer_fields || ARRAY['casesPerSkid', 'casesProduced', 'casesOnLine', 'casesInFreezer'];
    WHEN 'dough' THEN
      v_allowed_inputs := v_allowed_inputs || ARRAY['casesPerBatch', 'traysPerBatch'];
      v_allowed_progress := ARRAY['casesProduced', 'traysOnLine', 'batchesReady', 'batchesMade'];
      v_integer_fields := v_integer_fields || ARRAY['traysPerBatch', 'casesProduced', 'traysOnLine', 'batchesReady', 'batchesMade'];
    WHEN 'cheese' THEN
      v_allowed_inputs := v_allowed_inputs || ARRAY['pizzasPerCase', 'ozPerPizza', 'batchLbs'];
      v_allowed_progress := ARRAY['casesCompleted', 'batchesMade', 'stockOnLineLbs'];
      v_integer_fields := v_integer_fields || ARRAY['pizzasPerCase', 'casesCompleted', 'batchesMade'];
    WHEN 'pepperoni' THEN
      v_allowed_inputs := v_allowed_inputs || ARRAY['pizzasPerCase', 'ozPerPizza', 'batchLbs'];
      v_allowed_progress := ARRAY['casesCompleted', 'batchesMade', 'stockOnLineLbs'];
      v_integer_fields := v_integer_fields || ARRAY['pizzasPerCase', 'casesCompleted', 'batchesMade'];
    WHEN 'sauce' THEN
      v_allowed_inputs := v_allowed_inputs || ARRAY['pizzasPerCase', 'ozPerPizza', 'barrelLbs'];
      v_allowed_progress := ARRAY['barrelsMade', 'stockBarrels'];
      v_integer_fields := v_integer_fields || ARRAY['pizzasPerCase', 'barrelsMade'];
    WHEN 'frontline' THEN
      v_allowed_inputs := v_allowed_inputs || ARRAY['pizzasPerCase', 'ozPerPizza', 'batchLbs'];
      v_allowed_progress := ARRAY['batchesMade', 'stockOnLineLbs', 'stockConsumedLbs'];
      v_integer_fields := v_integer_fields || ARRAY['pizzasPerCase', 'batchesMade'];
    WHEN 'packaging' THEN
      v_allowed_inputs := v_allowed_inputs || ARRAY['casesPerSkid'];
      v_allowed_progress := ARRAY['casesPacked'];
      v_integer_fields := v_integer_fields || ARRAY['casesPerSkid', 'casesPacked'];
  END CASE;

  IF p_auto_track_field <> (CASE p_station_key
    WHEN 'line' THEN 'casesProduced'
    WHEN 'dough' THEN 'casesProduced'
    WHEN 'cheese' THEN 'casesCompleted'
    WHEN 'pepperoni' THEN 'casesCompleted'
    WHEN 'sauce' THEN 'barrelsMade'
    WHEN 'frontline' THEN 'batchesMade'
    WHEN 'packaging' THEN 'casesPacked'
  END) THEN
    RAISE EXCEPTION 'Invalid station auto-track field' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1 FROM jsonb_object_keys(p_inputs_patch) AS key
    WHERE NOT key = ANY(v_allowed_inputs)
  ) OR EXISTS (
    SELECT 1 FROM jsonb_object_keys(p_progress_patch) AS key
    WHERE NOT key = ANY(v_allowed_progress)
  ) THEN
    RAISE EXCEPTION 'Unsupported station value' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_each(p_inputs_patch) AS item(key, value)
    WHERE jsonb_typeof(value) <> 'number' OR (value #>> '{}')::numeric < 0
      OR (value #>> '{}')::numeric > 1000000
  ) OR EXISTS (
    SELECT 1 FROM jsonb_each(p_progress_patch) AS item(key, value)
    WHERE jsonb_typeof(value) <> 'number' OR (value #>> '{}')::numeric < 0
      OR (value #>> '{}')::numeric > 1000000
  ) THEN
    RAISE EXCEPTION 'Station values must be finite non-negative numbers' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_each(p_inputs_patch) AS item(key, value)
    WHERE key = ANY(v_integer_fields) AND (value #>> '{}')::numeric <> TRUNC((value #>> '{}')::numeric)
  ) OR EXISTS (
    SELECT 1 FROM jsonb_each(p_progress_patch) AS item(key, value)
    WHERE key = ANY(v_integer_fields) AND (value #>> '{}')::numeric <> TRUNC((value #>> '{}')::numeric)
  ) THEN
    RAISE EXCEPTION 'Station case and batch counts must be whole numbers' USING ERRCODE = '22023';
  END IF;

  IF p_mode <> 'manual' AND (p_inputs_patch <> '{}'::jsonb OR p_progress_patch <> '{}'::jsonb) THEN
    RAISE EXCEPTION 'Non-manual station commands cannot include client values' USING ERRCODE = '22023';
  END IF;
  IF p_mode = 'manual' AND p_inputs_patch = '{}'::jsonb AND p_progress_patch = '{}'::jsonb THEN
    RAISE EXCEPTION 'Station edits must contain at least one value' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_facility_id::text || ':' || p_actor_id::text || ':' || p_command_id, 0)
  );
  SELECT request_hash, response
    INTO v_existing_hash, v_existing_response
    FROM v2.command_receipts
    WHERE facility_id = p_facility_id AND actor_id = p_actor_id AND command_id = p_command_id;
  IF FOUND THEN
    IF v_existing_hash <> p_request_hash THEN
      RAISE EXCEPTION 'Station command ID was reused with different details' USING ERRCODE = '22023';
    END IF;
    RETURN v_existing_response || jsonb_build_object('replayed', true);
  END IF;

  SELECT * INTO v_run FROM v2.runs
    WHERE facility_id = p_facility_id AND id = p_run_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Run not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_run.revision <> p_expected_revision THEN
    RETURN jsonb_build_object(
      'outcome', 'conflict',
      'expectedRevision', p_expected_revision,
      'currentRun', v2.run_snapshot(p_facility_id, p_run_id)
    );
  END IF;
  IF v_run.status = 'completed' THEN
    RETURN jsonb_build_object(
      'outcome', 'invalid_transition',
      'currentRun', v2.run_snapshot(p_facility_id, p_run_id)
    );
  END IF;

  SELECT * INTO v_station FROM v2.run_station_progress
    WHERE facility_id = p_facility_id AND run_id = p_run_id AND station_key = p_station_key
    FOR UPDATE;
  v_station_exists := FOUND;
  IF NOT v_station_exists THEN
    v_station.inputs := '{}'::jsonb;
    v_station.progress := '{}'::jsonb;
    v_station.status := 'not_started';
    v_station.revision := 0;
    v_station.started_at := NULL;
    v_station.paused_at := NULL;
    v_station.completed_at := NULL;
    v_station.next_due_at := NULL;
  END IF;

  v_now := clock_timestamp();
  v_inputs := v_station.inputs || p_inputs_patch;
  v_progress := v_station.progress || p_progress_patch;

  IF p_mode = 'manual' THEN
    v_rate := COALESCE((v_inputs->>'autoTrackRatePerMinute')::numeric, 0);
    IF v_rate > 600 THEN
      RAISE EXCEPTION 'Automatic tracking rate is out of range' USING ERRCODE = '22023';
    END IF;
    IF p_progress_patch ? p_auto_track_field OR p_inputs_patch ? 'autoTrackRatePerMinute' THEN
      v_progress := v_progress || jsonb_build_object(
        'autoTrackLastAt', to_char(v_now AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'autoTrackRemainder', 0
      );
    END IF;
    IF p_inputs_patch ? 'autoTrackRatePerMinute' THEN
      v_progress := v_progress || jsonb_build_object(
        'autoTrackLastAt', to_char(v_now AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'autoTrackRemainder', 0
      );
    END IF;
  ELSIF p_mode = 'auto_track' THEN
    IF v_run.status <> 'running' THEN
      RETURN jsonb_build_object('outcome', 'invalid_transition',
        'currentRun', v2.run_snapshot(p_facility_id, p_run_id));
    END IF;
    v_rate := COALESCE((v_inputs->>'autoTrackRatePerMinute')::numeric, 0);
    IF v_rate <= 0 THEN
      RETURN jsonb_build_object('outcome', 'not_enabled',
        'currentRun', v2.run_snapshot(p_facility_id, p_run_id));
    END IF;

    v_last := NULLIF(v_progress->>'autoTrackLastAt', '')::timestamptz;
    IF v_last IS NULL THEN
      v_last := v_now;
      v_progress := v_progress || jsonb_build_object(
        'autoTrackLastAt', to_char(v_now AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'autoTrackRemainder', 0
      );
      RETURN jsonb_build_object('outcome', 'not_due',
        'currentRun', v2.run_snapshot(p_facility_id, p_run_id));
    END IF;
    SELECT COALESCE(SUM(
      GREATEST(
        0,
        EXTRACT(EPOCH FROM (LEAST(COALESCE(p.resumed_at, v_now), v_now)
          - GREATEST(p.paused_at, v_last))) * 1000
      )
    ), 0)
      INTO v_pause_ms
      FROM v2.run_pause_intervals AS p
      WHERE p.facility_id = p_facility_id AND p.run_id = p_run_id
        AND p.paused_at < v_now AND COALESCE(p.resumed_at, v_now) > v_last;
    v_active_seconds := GREATEST(
      0,
      EXTRACT(EPOCH FROM (v_now - v_last)) - (v_pause_ms / 1000)
    );
    v_remainder := COALESCE((v_progress->>'autoTrackRemainder')::numeric, 0);
    v_total := v_remainder + (v_active_seconds * v_rate / 60);
    v_increment := FLOOR(v_total);
    IF v_increment < 1 THEN
      RETURN jsonb_build_object('outcome', 'not_due',
        'currentRun', v2.run_snapshot(p_facility_id, p_run_id));
    END IF;
    v_target := CASE p_station_key
      WHEN 'sauce' THEN CASE
        WHEN COALESCE((v_inputs->>'pizzasPerCase')::numeric, 0) > 0
          AND COALESCE((v_inputs->>'ozPerPizza')::numeric, 0) > 0
          AND COALESCE((v_inputs->>'barrelLbs')::numeric, 0) > 0
        THEN CEIL(((v_run.setup_snapshot->>'targetCases')::numeric
          * (v_inputs->>'pizzasPerCase')::numeric * (v_inputs->>'ozPerPizza')::numeric / 16 + 30)
          / (v_inputs->>'barrelLbs')::numeric)
        ELSE 0 END
      WHEN 'frontline' THEN CASE
        WHEN COALESCE((v_inputs->>'pizzasPerCase')::numeric, 0) > 0
          AND COALESCE((v_inputs->>'ozPerPizza')::numeric, 0) > 0
          AND COALESCE((v_inputs->>'batchLbs')::numeric, 0) > 0
        THEN CEIL(((v_run.setup_snapshot->>'targetCases')::numeric
          * (v_inputs->>'pizzasPerCase')::numeric * (v_inputs->>'ozPerPizza')::numeric / 16 + 20)
          / (v_inputs->>'batchLbs')::numeric)
        ELSE 0 END
      ELSE COALESCE((v_run.setup_snapshot->>'targetCases')::numeric, 0)
    END;
    v_current := COALESCE((v_progress->>p_auto_track_field)::numeric, 0);
    v_increment := LEAST(v_increment, GREATEST(0, v_target - v_current));
    IF v_increment < 1 THEN
      v_progress := v_progress || jsonb_build_object(
        'autoTrackLastAt', to_char(v_now AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'autoTrackRemainder', 0
      );
      RETURN jsonb_build_object('outcome', 'not_due',
        'currentRun', v2.run_snapshot(p_facility_id, p_run_id));
    END IF;
    v_progress := v_progress || jsonb_build_object(
      p_auto_track_field, v_current + v_increment,
      'autoTrackLastAt', to_char(v_now AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'autoTrackRemainder', CASE WHEN v_current + v_increment >= v_target THEN 0
        ELSE v_total - FLOOR(v_total) END
    );
  ELSIF p_mode IN ('timer_start', 'timer_resume') THEN
    IF v_run.status <> 'running' THEN
      RETURN jsonb_build_object('outcome', 'invalid_transition',
        'currentRun', v2.run_snapshot(p_facility_id, p_run_id));
    END IF;
    IF COALESCE((v_inputs->>'timerDurationSeconds')::numeric, 0) <= 0 THEN
      RAISE EXCEPTION 'Set a timer duration before starting this station timer'
        USING ERRCODE = '22023';
    END IF;
    IF p_mode = 'timer_start' AND COALESCE(v_progress->>'timerStatus', 'idle') IN ('running', 'paused') THEN
      RETURN jsonb_build_object('outcome', 'invalid_transition',
        'currentRun', v2.run_snapshot(p_facility_id, p_run_id));
    END IF;
    IF p_mode = 'timer_resume' AND v_progress->>'timerStatus' <> 'paused' THEN
      RETURN jsonb_build_object('outcome', 'invalid_transition',
        'currentRun', v2.run_snapshot(p_facility_id, p_run_id));
    END IF;
    v_progress := v_progress || jsonb_build_object(
      'timerStatus', 'running',
      'timerStartedAt', to_char(v_now AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'timerPausedAt', NULL,
      'timerElapsedMs', CASE WHEN p_mode = 'timer_start' THEN 0
        ELSE COALESCE((v_progress->>'timerElapsedMs')::numeric, 0) END
    );
    v_station.status := 'running';
    v_station.started_at := COALESCE(v_station.started_at, v_now);
    v_station.paused_at := NULL;
  ELSIF p_mode = 'timer_pause' THEN
    IF v_progress->>'timerStatus' <> 'running' THEN
      RETURN jsonb_build_object('outcome', 'invalid_transition',
        'currentRun', v2.run_snapshot(p_facility_id, p_run_id));
    END IF;
    v_last := NULLIF(v_progress->>'timerStartedAt', '')::timestamptz;
    IF v_last IS NULL THEN
      RAISE EXCEPTION 'Station timer start is missing' USING ERRCODE = '23514';
    END IF;
    SELECT COALESCE(SUM(
      GREATEST(
        0,
        EXTRACT(EPOCH FROM (LEAST(COALESCE(p.resumed_at, v_now), v_now)
          - GREATEST(p.paused_at, v_last))) * 1000
      )
    ), 0)
      INTO v_pause_ms
      FROM v2.run_pause_intervals AS p
      WHERE p.facility_id = p_facility_id AND p.run_id = p_run_id
        AND p.paused_at < v_now AND COALESCE(p.resumed_at, v_now) > v_last;
    v_elapsed_ms := GREATEST(
      0,
      EXTRACT(EPOCH FROM (v_now - v_last)) * 1000 - v_pause_ms
    );
    v_progress := v_progress || jsonb_build_object(
      'timerStatus', 'paused',
      'timerStartedAt', NULL,
      'timerPausedAt', to_char(v_now AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'timerElapsedMs', COALESCE((v_progress->>'timerElapsedMs')::numeric, 0) + v_elapsed_ms
    );
    v_station.status := 'paused';
    v_station.paused_at := v_now;
  ELSIF p_mode = 'timer_reset' THEN
    v_progress := v_progress || jsonb_build_object(
      'timerStatus', 'idle',
      'timerStartedAt', NULL,
      'timerPausedAt', NULL,
      'timerElapsedMs', 0
    );
    v_station.status := 'not_started';
    v_station.started_at := NULL;
    v_station.paused_at := NULL;
    v_station.completed_at := NULL;
  END IF;

  IF p_mode = 'manual'
     AND (p_inputs_patch ? 'autoTrackRatePerMinute' OR p_progress_patch ? p_auto_track_field) THEN
    v_rate := COALESCE((v_inputs->>'autoTrackRatePerMinute')::numeric, 0);
    v_target := CASE p_station_key
      WHEN 'sauce' THEN CASE
        WHEN COALESCE((v_inputs->>'pizzasPerCase')::numeric, 0) > 0
          AND COALESCE((v_inputs->>'ozPerPizza')::numeric, 0) > 0
          AND COALESCE((v_inputs->>'barrelLbs')::numeric, 0) > 0
        THEN CEIL(((v_run.setup_snapshot->>'targetCases')::numeric
          * (v_inputs->>'pizzasPerCase')::numeric * (v_inputs->>'ozPerPizza')::numeric / 16 + 30)
          / (v_inputs->>'barrelLbs')::numeric)
        ELSE 0 END
      WHEN 'frontline' THEN CASE
        WHEN COALESCE((v_inputs->>'pizzasPerCase')::numeric, 0) > 0
          AND COALESCE((v_inputs->>'ozPerPizza')::numeric, 0) > 0
          AND COALESCE((v_inputs->>'batchLbs')::numeric, 0) > 0
        THEN CEIL(((v_run.setup_snapshot->>'targetCases')::numeric
          * (v_inputs->>'pizzasPerCase')::numeric * (v_inputs->>'ozPerPizza')::numeric / 16 + 20)
          / (v_inputs->>'batchLbs')::numeric)
        ELSE 0 END
      ELSE COALESCE((v_run.setup_snapshot->>'targetCases')::numeric, 0)
    END;
    v_current := COALESCE((v_progress->>p_auto_track_field)::numeric, 0);
    IF v_rate > 0 AND v_current < v_target THEN
      v_station.next_due_at := v_now + make_interval(secs => 60.0 / v_rate);
    ELSE
      v_station.next_due_at := NULL;
    END IF;
  ELSIF p_mode = 'auto_track' THEN
    v_rate := COALESCE((v_inputs->>'autoTrackRatePerMinute')::numeric, 0);
    v_current := COALESCE((v_progress->>p_auto_track_field)::numeric, 0);
    v_station.next_due_at := CASE WHEN v_current >= v_target THEN NULL
      ELSE v_now + make_interval(secs => 60.0 / v_rate) END;
  END IF;

  IF v_station_exists THEN
    UPDATE v2.run_station_progress
      SET status = v_station.status,
          revision = revision + 1,
          inputs = v_inputs,
          progress = v_progress,
          started_at = v_station.started_at,
          paused_at = v_station.paused_at,
          completed_at = v_station.completed_at,
          next_due_at = v_station.next_due_at,
          updated_at = v_now
      WHERE facility_id = p_facility_id AND run_id = p_run_id AND station_key = p_station_key
      RETURNING * INTO v_station;
  ELSE
    INSERT INTO v2.run_station_progress (
      facility_id, run_id, station_key, status, revision, inputs, progress,
      started_at, paused_at, completed_at, next_due_at, updated_at
    ) VALUES (
      p_facility_id, p_run_id, p_station_key, v_station.status, 1, v_inputs, v_progress,
      v_station.started_at, v_station.paused_at, v_station.completed_at, v_station.next_due_at, v_now
    ) RETURNING * INTO v_station;
  END IF;

  UPDATE v2.runs
    SET revision = revision + 1, updated_at = v_now
    WHERE facility_id = p_facility_id AND id = p_run_id
    RETURNING revision INTO v_revision;

  v_event_type := CASE p_mode
    WHEN 'auto_track' THEN 'station.auto_tracked'
    WHEN 'timer_start' THEN 'station.timer_started'
    WHEN 'timer_pause' THEN 'station.timer_paused'
    WHEN 'timer_resume' THEN 'station.timer_resumed'
    WHEN 'timer_reset' THEN 'station.timer_reset'
    ELSE 'station.updated'
  END;
  v_response := jsonb_build_object(
    'outcome', 'accepted',
    'replayed', false,
    'commandId', p_command_id,
    'stationKey', p_station_key,
    'run', v2.run_snapshot(p_facility_id, p_run_id)
  );
  INSERT INTO v2.run_events (
    facility_id, run_id, revision, actor_id, event_type, occurred_at, payload
  ) VALUES (p_facility_id, p_run_id, v_revision, p_actor_id, v_event_type, v_now, v_response);
  INSERT INTO v2.outbox_events (
    event_id, facility_id, run_id, revision, event_type, payload, created_at
  ) VALUES (gen_random_uuid(), p_facility_id, p_run_id, v_revision, v_event_type, v_response, v_now);
  INSERT INTO v2.command_receipts (
    facility_id, actor_id, command_id, request_hash, response, created_at
  ) VALUES (p_facility_id, p_actor_id, p_command_id, p_request_hash, v_response, v_now);
  RETURN v_response;
END
$$;

REVOKE ALL ON FUNCTION v2.apply_station_command(
  uuid, uuid, uuid, text, text, bigint, text, text, jsonb, jsonb, text
) FROM PUBLIC;
REVOKE ALL ON FUNCTION v2.claim_worker_lease(text, uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION v2.heartbeat_worker_lease(text, uuid, bigint, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION v2.release_worker_lease(text, uuid, bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION v2.list_due_station_auto_track(integer) FROM PUBLIC;

COMMENT ON FUNCTION v2.apply_station_command(
  uuid, uuid, uuid, text, text, bigint, text, text, jsonb, jsonb, text
) IS 'Backend-only station state boundary. Server-validated station commands update canonical run revision, station progress, receipt, event, and outbox atomically.';

COMMIT;
