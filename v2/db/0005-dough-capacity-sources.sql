BEGIN;

CREATE FUNCTION v2.dough_capacity_snapshot(p_facility_id uuid, p_product_code text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, v2
AS $$
  WITH selected_product AS (
    SELECT p.code
    FROM v2.products AS p
    WHERE p.facility_id = p_facility_id
      AND p.code = p_product_code
      AND p.active
  ),
  dough AS (
    SELECT
      count(*) AS row_count,
      CASE WHEN count(*) = 1 THEN min(
        CASE
          WHEN jsonb_typeof(m.data->'doughballYield') = 'number'
            AND m.data->>'doughballYield' ~ '^[0-9]+(\.[0-9]{1,6})?$'
          THEN (m.data->>'doughballYield')::numeric
          ELSE NULL
        END
      ) END AS doughball_yield
    FROM v2.master_records AS m
    JOIN selected_product AS p ON p.code = m.product_code
    WHERE m.facility_id = p_facility_id
      AND m.kind = 'recipes'
      AND m.data->>'sourceFamily' = 'dough-procedure'
  ),
  shipping AS (
    SELECT
      count(*) AS row_count,
      CASE WHEN count(*) = 1 THEN min(
        CASE
          WHEN jsonb_typeof(m.data->'pizzasPerCase') = 'number'
            AND m.data->>'pizzasPerCase' ~ '^[1-9][0-9]*$'
          THEN (m.data->>'pizzasPerCase')::integer
          ELSE NULL
        END
      ) END AS pizzas_per_case
    FROM v2.master_records AS m
    JOIN selected_product AS p ON p.code = m.product_code
    WHERE m.facility_id = p_facility_id
      AND m.kind = 'production-setups'
      AND m.data->>'sourceFamily' = 'shipping-guide'
  ),
  status AS (
    SELECT
      EXISTS (SELECT 1 FROM selected_product) AS product_found,
      dough.row_count AS dough_count,
      dough.doughball_yield,
      shipping.row_count AS shipping_count,
      shipping.pizzas_per_case
    FROM dough CROSS JOIN shipping
  )
  SELECT jsonb_build_object(
    'status', CASE
      WHEN product_found
        AND dough_count = 1
        AND shipping_count = 1
        AND doughball_yield BETWEEN 0.000001 AND 1000000
        AND pizzas_per_case BETWEEN 1 AND 100
        AND round(doughball_yield / pizzas_per_case, 4) > 0
      THEN 'available'
      ELSE 'unavailable'
    END,
    'reasons', to_jsonb(array_remove(ARRAY[
      CASE WHEN NOT product_found THEN 'product_not_selected' END,
      CASE WHEN product_found AND dough_count = 0 THEN 'dough_source_missing' END,
      CASE WHEN product_found AND dough_count > 1 THEN 'dough_source_ambiguous' END,
      CASE WHEN product_found AND dough_count = 1
        AND (doughball_yield IS NULL OR doughball_yield NOT BETWEEN 0.000001 AND 1000000
          OR (pizzas_per_case BETWEEN 1 AND 100 AND round(doughball_yield / pizzas_per_case, 4) <= 0))
        THEN 'dough_yield_invalid' END,
      CASE WHEN product_found AND shipping_count = 0 THEN 'shipping_source_missing' END,
      CASE WHEN product_found AND shipping_count > 1 THEN 'shipping_source_ambiguous' END,
      CASE WHEN product_found AND shipping_count = 1
        AND (pizzas_per_case IS NULL OR pizzas_per_case NOT BETWEEN 1 AND 100)
        THEN 'pizzas_per_case_invalid' END
    ], NULL)),
    'doughballYield', CASE
      WHEN dough_count = 1 AND doughball_yield BETWEEN 0.000001 AND 1000000
        AND pizzas_per_case BETWEEN 1 AND 100
        AND round(doughball_yield / pizzas_per_case, 4) > 0
      THEN doughball_yield ELSE NULL END,
    'pizzasPerCase', CASE
      WHEN shipping_count = 1 AND pizzas_per_case BETWEEN 1 AND 100
      THEN pizzas_per_case ELSE NULL END
  )
  FROM status
$$;

CREATE FUNCTION v2.list_run_products(p_facility_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, v2
AS $$
BEGIN
  IF p_facility_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM v2.facility_scope
    WHERE singleton AND facility_id = p_facility_id
  ) THEN
    RAISE EXCEPTION 'Invalid facility scope' USING ERRCODE = '42501';
  END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'code', p.code,
      'name', p.name,
      'doughCapacity', v2.dough_capacity_snapshot(p_facility_id, p.code)
    ) ORDER BY lower(p.name), p.code)
    FROM v2.products AS p
    WHERE p.facility_id = p_facility_id AND p.active
  ), '[]'::jsonb);
END
$$;

CREATE FUNCTION v2.list_workbook_source_links(p_facility_id uuid, p_source_family text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, v2
AS $$
BEGIN
  IF p_facility_id IS NULL OR p_source_family NOT IN ('dough-procedure', 'shipping-guide')
     OR NOT EXISTS (
       SELECT 1 FROM v2.facility_scope
       WHERE singleton AND facility_id = p_facility_id
     ) THEN
    RAISE EXCEPTION 'Invalid workbook source scope' USING ERRCODE = '42501';
  END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'sourceKey', m.data->>'sourceKey',
      'productCode', p.code
    ) ORDER BY m.data->>'sourceKey')
    FROM v2.master_records AS m
    JOIN v2.products AS p
      ON p.facility_id = m.facility_id
      AND p.code = m.product_code
      AND p.active
    WHERE m.facility_id = p_facility_id
      AND m.data->>'sourceFamily' = p_source_family
      AND m.data->>'sourceKey' ~ '^[0-9a-f]{64}$'
  ), '[]'::jsonb);
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
    'doughCapacity', v2.dough_capacity_snapshot(p_facility_id, r.setup_snapshot->>'productCode'),
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

CREATE OR REPLACE FUNCTION v2.create_planned_run(
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
  v_product_code text;
BEGIN
  IF p_facility_id IS NULL OR p_actor_id IS NULL
     OR p_request_id IS NULL OR length(btrim(p_request_id)) = 0
     OR length(p_request_id) > 200
     OR p_request_hash IS NULL OR p_request_hash !~ '^[0-9a-f]{64}$'
     OR p_setup_snapshot IS NULL OR jsonb_typeof(p_setup_snapshot) <> 'object'
     OR (p_setup_snapshot - ARRAY['label', 'targetCases', 'productCode']) <> '{}'::jsonb
     OR jsonb_typeof(p_setup_snapshot->'label') IS DISTINCT FROM 'string'
     OR jsonb_typeof(p_setup_snapshot->'targetCases') IS DISTINCT FROM 'number'
     OR (p_setup_snapshot ? 'productCode'
       AND (jsonb_typeof(p_setup_snapshot->'productCode') IS DISTINCT FROM 'string'
         OR p_setup_snapshot->>'productCode' !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$')) THEN
    RAISE EXCEPTION 'Invalid run creation request'
      USING ERRCODE = '22023';
  END IF;

  IF length(btrim(p_setup_snapshot->>'label')) NOT BETWEEN 1 AND 120
     OR (p_setup_snapshot->>'targetCases') !~ '^[1-9][0-9]*$'
     OR (p_setup_snapshot->>'targetCases')::numeric > 9007199254740991 THEN
    RAISE EXCEPTION 'Invalid run setup snapshot'
      USING ERRCODE = '22023';
  END IF;

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

  IF NOT (p_setup_snapshot ? 'productCode') THEN
    RAISE EXCEPTION 'An active imported product is required for a new run'
      USING ERRCODE = '22023';
  END IF;

  SELECT p.code INTO v_product_code
  FROM v2.products AS p
  WHERE p.facility_id = p_facility_id
    AND p.code = p_setup_snapshot->>'productCode'
    AND p.active;
  IF v_product_code IS NULL THEN
    RAISE EXCEPTION 'The selected product is not active'
      USING ERRCODE = '22023';
  END IF;

  v_setup := jsonb_build_object(
    'label', btrim(p_setup_snapshot->>'label'),
    'targetCases', (p_setup_snapshot->>'targetCases')::bigint,
    'productCode', v_product_code
  );

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

REVOKE ALL ON FUNCTION v2.dough_capacity_snapshot(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION v2.list_run_products(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION v2.list_workbook_source_links(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION v2.run_snapshot(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION v2.create_planned_run(uuid, uuid, text, text, jsonb) FROM PUBLIC;

COMMENT ON FUNCTION v2.dough_capacity_snapshot(uuid, text) IS
  'Returns an explicit unavailable state unless exactly one valid dough yield and one valid shipping case size exist for the active product.';
COMMENT ON FUNCTION v2.list_run_products(uuid) IS
  'Lists active V2 products with current facility-scoped dough and shipping source availability.';
COMMENT ON FUNCTION v2.list_workbook_source_links(uuid, text) IS
  'Returns confirmed workbook source-to-product links for active facility products, keyed by stable source identity.';

COMMIT;
