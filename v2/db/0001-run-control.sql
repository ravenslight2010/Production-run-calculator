BEGIN;

CREATE SCHEMA IF NOT EXISTS v2;

CREATE TABLE v2.runs (
  facility_id uuid NOT NULL,
  id uuid NOT NULL,
  status text NOT NULL CHECK (status IN ('planned', 'running', 'paused', 'completed')),
  revision bigint NOT NULL DEFAULT 0 CHECK (revision BETWEEN 0 AND 9007199254740991),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  started_at timestamptz,
  paused_at timestamptz,
  resumed_at timestamptz,
  completed_at timestamptz,
  setup_snapshot jsonb NOT NULL,
  PRIMARY KEY (facility_id, id),
  CHECK (updated_at >= created_at),
  CHECK (started_at IS NULL OR started_at >= created_at),
  CHECK (started_at IS NULL OR updated_at >= started_at),
  CHECK (paused_at IS NULL OR started_at IS NOT NULL),
  CHECK (paused_at IS NULL OR paused_at >= started_at),
  CHECK (resumed_at IS NULL OR started_at IS NOT NULL),
  CHECK (resumed_at IS NULL OR resumed_at >= started_at),
  CHECK (completed_at IS NULL OR started_at IS NOT NULL),
  CHECK (completed_at IS NULL OR completed_at >= started_at),
  CHECK (completed_at IS NULL OR completed_at <= updated_at),
  CHECK (status <> 'planned' OR updated_at = created_at),
  CHECK (status <> 'planned' OR (started_at IS NULL AND paused_at IS NULL AND resumed_at IS NULL AND completed_at IS NULL)),
  CHECK (status <> 'running' OR (started_at IS NOT NULL AND paused_at IS NULL AND completed_at IS NULL)),
  CHECK (status <> 'paused' OR (started_at IS NOT NULL AND paused_at IS NOT NULL AND completed_at IS NULL)),
  CHECK (status <> 'completed' OR (started_at IS NOT NULL AND paused_at IS NULL AND completed_at IS NOT NULL))
);

CREATE TABLE v2.run_pause_intervals (
  facility_id uuid NOT NULL,
  run_id uuid NOT NULL,
  pause_number integer NOT NULL CHECK (pause_number > 0),
  paused_at timestamptz NOT NULL,
  resumed_at timestamptz,
  PRIMARY KEY (facility_id, run_id, pause_number),
  FOREIGN KEY (facility_id, run_id) REFERENCES v2.runs (facility_id, id) ON DELETE RESTRICT,
  CHECK (resumed_at IS NULL OR resumed_at >= paused_at)
);

CREATE UNIQUE INDEX run_pause_intervals_one_open_per_run
  ON v2.run_pause_intervals (facility_id, run_id)
  WHERE resumed_at IS NULL;

CREATE TABLE v2.run_station_progress (
  facility_id uuid NOT NULL,
  run_id uuid NOT NULL,
  station_key text NOT NULL CHECK (length(station_key) BETWEEN 1 AND 100),
  status text NOT NULL CHECK (status IN ('not_started', 'running', 'paused', 'completed')),
  revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0),
  inputs jsonb NOT NULL DEFAULT '{}'::jsonb,
  progress jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_at timestamptz,
  paused_at timestamptz,
  completed_at timestamptz,
  next_due_at timestamptz,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (facility_id, run_id, station_key),
  FOREIGN KEY (facility_id, run_id) REFERENCES v2.runs (facility_id, id) ON DELETE RESTRICT,
  CHECK (paused_at IS NULL OR started_at IS NOT NULL),
  CHECK (paused_at IS NULL OR paused_at >= started_at),
  CHECK (completed_at IS NULL OR started_at IS NOT NULL),
  CHECK (completed_at IS NULL OR completed_at >= started_at),
  CHECK (completed_at IS NULL OR completed_at <= updated_at),
  CHECK (status <> 'not_started' OR (started_at IS NULL AND paused_at IS NULL AND completed_at IS NULL)),
  CHECK (status <> 'running' OR (started_at IS NOT NULL AND paused_at IS NULL AND completed_at IS NULL)),
  CHECK (status <> 'paused' OR (started_at IS NOT NULL AND paused_at IS NOT NULL AND completed_at IS NULL)),
  CHECK (status <> 'completed' OR (started_at IS NOT NULL AND paused_at IS NULL AND completed_at IS NOT NULL))
);

CREATE TABLE v2.command_receipts (
  facility_id uuid NOT NULL,
  actor_id uuid NOT NULL,
  command_id text NOT NULL CHECK (length(command_id) BETWEEN 1 AND 200),
  request_hash char(64) NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  response jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (facility_id, actor_id, command_id)
);

CREATE TABLE v2.run_events (
  facility_id uuid NOT NULL,
  run_id uuid NOT NULL,
  revision bigint NOT NULL CHECK (revision BETWEEN 0 AND 9007199254740991),
  actor_id uuid,
  event_type text NOT NULL CHECK (length(event_type) BETWEEN 1 AND 100),
  occurred_at timestamptz NOT NULL,
  payload jsonb NOT NULL,
  PRIMARY KEY (facility_id, run_id, revision),
  FOREIGN KEY (facility_id, run_id) REFERENCES v2.runs (facility_id, id) ON DELETE RESTRICT
);

CREATE TABLE v2.outbox_events (
  sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_id uuid NOT NULL UNIQUE,
  facility_id uuid NOT NULL,
  run_id uuid NOT NULL,
  revision bigint NOT NULL CHECK (revision BETWEEN 0 AND 9007199254740991),
  event_type text NOT NULL CHECK (length(event_type) BETWEEN 1 AND 100),
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  delivered_at timestamptz,
  UNIQUE (facility_id, run_id, revision),
  FOREIGN KEY (facility_id, run_id) REFERENCES v2.runs (facility_id, id) ON DELETE RESTRICT,
  CHECK (delivered_at IS NULL OR delivered_at >= created_at)
);

CREATE INDEX outbox_events_pending_sequence
  ON v2.outbox_events (sequence)
  WHERE delivered_at IS NULL;

CREATE TABLE v2.worker_leases (
  lease_name text PRIMARY KEY CHECK (length(lease_name) BETWEEN 1 AND 100),
  owner_id uuid,
  generation bigint NOT NULL DEFAULT 0 CHECK (generation >= 0),
  heartbeat_at timestamptz,
  expires_at timestamptz,
  CHECK ((owner_id IS NULL) = (expires_at IS NULL)),
  CHECK ((owner_id IS NULL) = (heartbeat_at IS NULL)),
  CHECK (owner_id IS NULL OR generation > 0),
  CHECK (expires_at IS NULL OR expires_at >= heartbeat_at)
);

CREATE FUNCTION v2.reject_immutable_row_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Rows in %.% are append-only', TG_TABLE_SCHEMA, TG_TABLE_NAME
    USING ERRCODE = '55000';
END
$$;

CREATE TRIGGER command_receipts_append_only
  BEFORE UPDATE OR DELETE ON v2.command_receipts
  FOR EACH ROW EXECUTE FUNCTION v2.reject_immutable_row_mutation();

CREATE TRIGGER run_events_append_only
  BEFORE UPDATE OR DELETE ON v2.run_events
  FOR EACH ROW EXECUTE FUNCTION v2.reject_immutable_row_mutation();

CREATE FUNCTION v2.guard_outbox_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Outbox events cannot be deleted'
      USING ERRCODE = '55000';
  END IF;

  IF ROW(
    NEW.event_id, NEW.facility_id, NEW.run_id, NEW.revision,
    NEW.event_type, NEW.payload, NEW.created_at
  ) IS DISTINCT FROM ROW(
    OLD.event_id, OLD.facility_id, OLD.run_id, OLD.revision,
    OLD.event_type, OLD.payload, OLD.created_at
  ) THEN
    RAISE EXCEPTION 'Outbox event content is immutable'
      USING ERRCODE = '55000';
  END IF;

  IF OLD.delivered_at IS NOT NULL AND NEW.delivered_at IS DISTINCT FROM OLD.delivered_at THEN
    RAISE EXCEPTION 'Outbox delivery cannot be reset or rewritten'
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END
$$;

CREATE TRIGGER outbox_events_immutable_content
  BEFORE UPDATE OR DELETE ON v2.outbox_events
  FOR EACH ROW EXECUTE FUNCTION v2.guard_outbox_event_mutation();

CREATE FUNCTION v2.run_snapshot(p_facility_id uuid, p_run_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, v2
AS $$
  SELECT jsonb_build_object(
    'id', r.id,
    'status', r.status,
    'revision', r.revision,
    'createdAt', to_char(r.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'updatedAt', to_char(r.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
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
    ), '[]'::jsonb)
  )
  FROM v2.runs AS r
  WHERE r.facility_id = p_facility_id AND r.id = p_run_id
$$;

CREATE FUNCTION v2.create_planned_run(
  p_facility_id uuid,
  p_actor_id uuid,
  p_request_id text,
  p_request_hash text,
  p_setup_snapshot jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, v2
AS $$
DECLARE
  v_existing_hash text;
  v_existing_response jsonb;
  v_run_id uuid;
  v_now timestamptz;
  v_setup jsonb;
  v_response jsonb;
BEGIN
  IF p_facility_id IS NULL OR p_actor_id IS NULL
     OR p_request_id IS NULL OR length(btrim(p_request_id)) = 0
     OR length(p_request_id) > 200
     OR p_request_hash IS NULL OR p_request_hash !~ '^[0-9a-f]{64}$'
     OR p_setup_snapshot IS NULL OR jsonb_typeof(p_setup_snapshot) <> 'object'
     OR (p_setup_snapshot - ARRAY['label', 'targetCases']) <> '{}'::jsonb
     OR jsonb_typeof(p_setup_snapshot->'label') IS DISTINCT FROM 'string'
     OR jsonb_typeof(p_setup_snapshot->'targetCases') IS DISTINCT FROM 'number' THEN
    RAISE EXCEPTION 'Invalid run creation request'
      USING ERRCODE = '22023';
  END IF;

  IF length(btrim(p_setup_snapshot->>'label')) NOT BETWEEN 1 AND 120
     OR (p_setup_snapshot->>'targetCases') !~ '^[1-9][0-9]*$'
     OR (p_setup_snapshot->>'targetCases')::numeric > 9007199254740991 THEN
    RAISE EXCEPTION 'Invalid run setup snapshot'
      USING ERRCODE = '22023';
  END IF;

  v_setup := jsonb_build_object(
    'label', btrim(p_setup_snapshot->>'label'),
    'targetCases', (p_setup_snapshot->>'targetCases')::bigint
  );

  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_facility_id::text || ':' || p_actor_id::text || ':' || p_request_id, 0)
  );

  SELECT request_hash, response
    INTO v_existing_hash, v_existing_response
    FROM v2.command_receipts
    WHERE facility_id = p_facility_id
      AND actor_id = p_actor_id
      AND command_id = p_request_id;

  IF FOUND THEN
    IF v_existing_hash <> p_request_hash THEN
      RAISE EXCEPTION 'Run creation request ID was reused with different details'
        USING ERRCODE = '22023';
    END IF;
    RETURN v_existing_response || jsonb_build_object('replayed', true);
  END IF;

  v_now := clock_timestamp();
  v_run_id := gen_random_uuid();

  INSERT INTO v2.runs (
    facility_id, id, status, revision, created_at, updated_at, setup_snapshot
  ) VALUES (
    p_facility_id, v_run_id, 'planned', 0, v_now, v_now, v_setup
  );

  v_response := jsonb_build_object(
    'outcome', 'created',
    'replayed', false,
    'run', v2.run_snapshot(p_facility_id, v_run_id)
  );

  INSERT INTO v2.run_events (
    facility_id, run_id, revision, actor_id, event_type, occurred_at, payload
  ) VALUES (
    p_facility_id, v_run_id, 0, p_actor_id, 'run.created', v_now, v_response
  );

  INSERT INTO v2.outbox_events (
    event_id, facility_id, run_id, revision, event_type, payload, created_at
  ) VALUES (
    gen_random_uuid(), p_facility_id, v_run_id, 0, 'run.created', v_response, v_now
  );

  INSERT INTO v2.command_receipts (
    facility_id, actor_id, command_id, request_hash, response, created_at
  ) VALUES (
    p_facility_id, p_actor_id, p_request_id, p_request_hash, v_response, v_now
  );

  RETURN v_response;
END
$$;

CREATE FUNCTION v2.get_run(p_facility_id uuid, p_run_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, v2
AS $$
  SELECT v2.run_snapshot(p_facility_id, p_run_id)
$$;

CREATE FUNCTION v2.list_runs(p_facility_id uuid, p_limit integer)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, v2
AS $$
DECLARE
  v_runs jsonb;
BEGIN
  IF p_facility_id IS NULL OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'Invalid run list request'
      USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(
    jsonb_agg(v2.run_snapshot(p_facility_id, selected.id) ORDER BY selected.created_at DESC, selected.id DESC),
    '[]'::jsonb
  )
    INTO v_runs
    FROM (
      SELECT r.id, r.created_at
      FROM v2.runs AS r
      WHERE r.facility_id = p_facility_id
      ORDER BY r.created_at DESC, r.id DESC
      LIMIT p_limit
    ) AS selected;

  RETURN v_runs;
END
$$;

CREATE FUNCTION v2.apply_run_lifecycle_command(
  p_facility_id uuid,
  p_run_id uuid,
  p_actor_id uuid,
  p_command_id text,
  p_request_hash text,
  p_command_type text,
  p_expected_revision bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, v2
AS $$
DECLARE
  v_run v2.runs%ROWTYPE;
  v_existing_hash text;
  v_existing_response jsonb;
  v_now timestamptz;
  v_next_revision bigint;
  v_event_type text;
  v_response jsonb;
  v_pause_number integer;
  v_open_pause_count integer;
BEGIN
  IF p_facility_id IS NULL OR p_run_id IS NULL OR p_actor_id IS NULL
     OR p_command_id IS NULL OR length(btrim(p_command_id)) = 0
     OR length(p_command_id) > 200
     OR p_request_hash IS NULL OR p_request_hash !~ '^[0-9a-f]{64}$'
     OR p_command_type IS NULL OR p_command_type NOT IN ('start', 'pause', 'resume', 'complete')
     OR p_expected_revision IS NULL OR p_expected_revision < 0 THEN
    RAISE EXCEPTION 'Invalid run command'
      USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_facility_id::text || ':' || p_actor_id::text || ':' || p_command_id, 0)
  );

  SELECT request_hash, response
    INTO v_existing_hash, v_existing_response
    FROM v2.command_receipts
    WHERE facility_id = p_facility_id
      AND actor_id = p_actor_id
      AND command_id = p_command_id;

  IF FOUND THEN
    IF v_existing_hash <> p_request_hash THEN
      RAISE EXCEPTION 'Idempotency key was reused with a different request'
        USING ERRCODE = '22023';
    END IF;
    RETURN v_existing_response || jsonb_build_object('replayed', true);
  END IF;

  SELECT *
    INTO v_run
    FROM v2.runs
    WHERE facility_id = p_facility_id
      AND id = p_run_id
    FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Run not found'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_run.revision <> p_expected_revision THEN
    RETURN jsonb_build_object(
      'outcome', 'conflict',
      'expectedRevision', p_expected_revision,
      'currentRun', v2.run_snapshot(p_facility_id, p_run_id)
    );
  END IF;

  IF v_run.revision = 9007199254740991 THEN
    RAISE EXCEPTION 'Run revision is exhausted'
      USING ERRCODE = '22003';
  END IF;

  v_now := clock_timestamp();
  IF v_now < v_run.updated_at THEN
    RAISE EXCEPTION 'Database clock precedes the current run state'
      USING ERRCODE = '22008';
  END IF;

  CASE p_command_type
    WHEN 'start' THEN
      IF v_run.status <> 'planned' THEN
        RETURN jsonb_build_object('outcome', 'invalid_transition', 'currentStatus', v_run.status);
      END IF;
      UPDATE v2.runs
        SET status = 'running', started_at = v_now,
            updated_at = v_now, revision = revision + 1
        WHERE facility_id = p_facility_id AND id = p_run_id
        RETURNING * INTO v_run;

    WHEN 'pause' THEN
      IF v_run.status <> 'running' THEN
        RETURN jsonb_build_object('outcome', 'invalid_transition', 'currentStatus', v_run.status);
      END IF;
      SELECT COALESCE(MAX(pause_number), 0) + 1
        INTO v_pause_number
        FROM v2.run_pause_intervals
        WHERE facility_id = p_facility_id AND run_id = p_run_id;
      INSERT INTO v2.run_pause_intervals (
        facility_id, run_id, pause_number, paused_at
      ) VALUES (p_facility_id, p_run_id, v_pause_number, v_now);
      UPDATE v2.runs
        SET status = 'paused', paused_at = v_now,
            updated_at = v_now, revision = revision + 1
        WHERE facility_id = p_facility_id AND id = p_run_id
        RETURNING * INTO v_run;

    WHEN 'resume' THEN
      IF v_run.status <> 'paused' THEN
        RETURN jsonb_build_object('outcome', 'invalid_transition', 'currentStatus', v_run.status);
      END IF;
      UPDATE v2.run_pause_intervals
        SET resumed_at = v_now
        WHERE facility_id = p_facility_id
          AND run_id = p_run_id
          AND resumed_at IS NULL;
      GET DIAGNOSTICS v_open_pause_count = ROW_COUNT;
      IF v_open_pause_count <> 1 THEN
        RAISE EXCEPTION 'Paused run does not have exactly one open pause interval'
          USING ERRCODE = '23514';
      END IF;
      UPDATE v2.runs
        SET status = 'running', paused_at = NULL, resumed_at = v_now,
            updated_at = v_now, revision = revision + 1
        WHERE facility_id = p_facility_id AND id = p_run_id
        RETURNING * INTO v_run;

    WHEN 'complete' THEN
      IF v_run.status NOT IN ('running', 'paused') THEN
        RETURN jsonb_build_object('outcome', 'invalid_transition', 'currentStatus', v_run.status);
      END IF;
      IF v_run.status = 'paused' THEN
        UPDATE v2.run_pause_intervals
          SET resumed_at = v_now
          WHERE facility_id = p_facility_id
            AND run_id = p_run_id
            AND resumed_at IS NULL;
        GET DIAGNOSTICS v_open_pause_count = ROW_COUNT;
        IF v_open_pause_count <> 1 THEN
          RAISE EXCEPTION 'Paused run does not have exactly one open pause interval'
            USING ERRCODE = '23514';
        END IF;
      END IF;
      UPDATE v2.runs
        SET status = 'completed', paused_at = NULL, completed_at = v_now,
            updated_at = v_now, revision = revision + 1
        WHERE facility_id = p_facility_id AND id = p_run_id
        RETURNING * INTO v_run;
  END CASE;

  v_next_revision := v_run.revision;
  v_event_type := 'run.' || CASE p_command_type
    WHEN 'start' THEN 'started'
    WHEN 'pause' THEN 'paused'
    WHEN 'resume' THEN 'resumed'
    WHEN 'complete' THEN 'completed'
  END;

  v_response := jsonb_build_object(
    'outcome', 'accepted',
    'replayed', false,
    'commandId', p_command_id,
    'run', v2.run_snapshot(p_facility_id, p_run_id)
  );

  INSERT INTO v2.run_events (
    facility_id, run_id, revision, actor_id, event_type, occurred_at, payload
  ) VALUES (
    p_facility_id, p_run_id, v_next_revision, p_actor_id, v_event_type, v_now, v_response
  );

  INSERT INTO v2.outbox_events (
    event_id, facility_id, run_id, revision, event_type, payload, created_at
  ) VALUES (
    gen_random_uuid(), p_facility_id, p_run_id, v_next_revision,
    v_event_type, v_response, v_now
  );

  INSERT INTO v2.command_receipts (
    facility_id, actor_id, command_id, request_hash, response, created_at
  ) VALUES (
    p_facility_id, p_actor_id, p_command_id, p_request_hash, v_response, v_now
  );

  RETURN v_response;
END
$$;

COMMENT ON FUNCTION v2.apply_run_lifecycle_command(uuid, uuid, uuid, text, text, text, bigint)
  IS 'Backend-only security-definer command boundary. Grant EXECUTE only to the trusted API role; facility and actor must come from verified server authorization; request_hash must be a server-computed SHA-256 of the canonical command.';

REVOKE ALL ON SCHEMA v2 FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA v2 FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA v2 FROM PUBLIC;

COMMENT ON FUNCTION v2.create_planned_run(uuid, uuid, text, text, jsonb)
  IS 'Backend-only security-definer run creation boundary. The API supplies verified facility and actor identity, a server-computed request hash, and a validated setup snapshot.';
COMMENT ON FUNCTION v2.get_run(uuid, uuid)
  IS 'Facility-scoped backend-only run read. Grant EXECUTE only to the trusted API role.';
COMMENT ON FUNCTION v2.list_runs(uuid, integer)
  IS 'Bounded facility-scoped backend-only run list. Grant EXECUTE only to the trusted API role.';

COMMIT;
