BEGIN;

ALTER TABLE v2.inventory_warehouses
  ADD COLUMN is_production boolean NOT NULL DEFAULT false;

CREATE UNIQUE INDEX inventory_warehouses_one_production
  ON v2.inventory_warehouses (facility_id)
  WHERE is_production;

ALTER TABLE v2.inventory_movements
  DROP CONSTRAINT inventory_movements_movement_type_check,
  ADD CONSTRAINT inventory_movements_movement_type_check
    CHECK (movement_type IN (
      'receipt', 'adjustment', 'transfer_out', 'transfer_in', 'opening_count', 'run_consumption'
    )),
  ADD COLUMN run_id uuid,
  ADD CONSTRAINT inventory_movements_run_reference
    FOREIGN KEY (facility_id, run_id)
    REFERENCES v2.runs (facility_id, id) ON DELETE RESTRICT;

CREATE INDEX inventory_movements_run
  ON v2.inventory_movements (facility_id, run_id)
  WHERE run_id IS NOT NULL;

CREATE TABLE v2.run_inventory_consumptions (
  facility_id uuid NOT NULL,
  run_id uuid NOT NULL,
  warehouse_id uuid NOT NULL,
  actor_id uuid NOT NULL,
  details jsonb NOT NULL CHECK (jsonb_typeof(details) = 'object'),
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (facility_id, run_id),
  FOREIGN KEY (facility_id, run_id)
    REFERENCES v2.runs (facility_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (facility_id, warehouse_id)
    REFERENCES v2.inventory_warehouses (facility_id, id) ON DELETE RESTRICT
);

CREATE TRIGGER run_inventory_consumptions_append_only
  BEFORE UPDATE OR DELETE ON v2.run_inventory_consumptions
  FOR EACH ROW EXECUTE FUNCTION v2.reject_immutable_row_mutation();

CREATE FUNCTION v2.validate_inventory_lines(
  p_facility_id uuid,
  p_lines jsonb,
  p_minimum integer
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, v2
AS $$
DECLARE
  v_line jsonb;
  v_product v2.products%ROWTYPE;
  v_count integer;
BEGIN
  IF jsonb_typeof(p_lines) IS DISTINCT FROM 'array'
     OR p_minimum NOT BETWEEN 0 AND 200 THEN
    RETURN false;
  END IF;
  IF jsonb_array_length(p_lines) NOT BETWEEN p_minimum AND 200 THEN
    RETURN false;
  END IF;
  v_count := 0;
  FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines) LOOP
    v_count := v_count + 1;
    IF jsonb_typeof(v_line) IS DISTINCT FROM 'object'
       OR (v_line - ARRAY['product_code', 'quantity', 'unit']) <> '{}'::jsonb
       OR jsonb_typeof(v_line->'product_code') IS DISTINCT FROM 'string'
       OR (v_line->>'product_code') !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$'
       OR jsonb_typeof(v_line->'quantity') IS DISTINCT FROM 'number'
       OR (v_line->>'quantity') !~ '^(0|[1-9][0-9]{0,11})(\.[0-9]{1,6})?$'
       OR (v_line->>'quantity')::numeric <= 0
       OR jsonb_typeof(v_line->'unit') IS DISTINCT FROM 'string'
       OR (v_line->>'unit') !~ '^[A-Za-z][A-Za-z0-9._/-]{0,15}$' THEN
      RETURN false;
    END IF;
    SELECT * INTO v_product
      FROM v2.products AS p
      WHERE p.facility_id = p_facility_id
        AND lower(p.code) = lower(v_line->>'product_code')
        AND p.active;
    IF NOT FOUND OR lower(v_product.base_unit) <> lower(v_line->>'unit') THEN
      RETURN false;
    END IF;
  END LOOP;
  RETURN v_count >= p_minimum;
END
$$;

CREATE FUNCTION v2.validate_run_inventory_master_record()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, v2
AS $$
DECLARE
  v_station_key text;
BEGIN
  IF NEW.data ? 'sourceFamily' THEN
    IF (NEW.kind = 'recipes' AND NEW.data->>'sourceFamily' = 'dough-procedure')
       OR (NEW.kind = 'production-setups' AND NEW.data->>'sourceFamily' = 'shipping-guide') THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Imported source family is not valid for this record kind'
      USING ERRCODE = '22023';
  END IF;

  IF NEW.kind = 'recipes' THEN
    IF NEW.data ? 'station_key'
       OR EXISTS (
         SELECT 1
         FROM v2.master_records AS s
         CROSS JOIN LATERAL jsonb_array_elements_text(s.data->'recipe_codes') AS ref(code)
         WHERE s.facility_id = NEW.facility_id
           AND s.kind = 'production-setups'
           AND s.data->>'sourceFamily' IS NULL
           AND lower(ref.code) = lower(NEW.code)
       ) THEN
      v_station_key := NEW.data->>'station_key';
      IF v_station_key NOT IN ('dough', 'cheese', 'pepperoni', 'sauce', 'frontline')
         OR NOT v2.validate_inventory_lines(NEW.facility_id, NEW.data->'ingredients', 1) THEN
        RAISE EXCEPTION 'Recipe station or inventory lines are invalid'
          USING ERRCODE = '22023';
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.kind <> 'production-setups' THEN
    RAISE EXCEPTION 'Unsupported master record kind' USING ERRCODE = '22023';
  END IF;

  IF (NEW.data - ARRAY['recipe_codes', 'packaging_per_case']) <> '{}'::jsonb
     OR jsonb_typeof(NEW.data->'recipe_codes') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Production setup recipes or packaging lines are invalid'
      USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(NEW.data->'recipe_codes') NOT BETWEEN 1 AND 20
     OR NOT v2.validate_inventory_lines(NEW.facility_id, NEW.data->'packaging_per_case', 1) THEN
    RAISE EXCEPTION 'Production setup recipes or packaging lines are invalid'
      USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(NEW.data->'recipe_codes') AS item(value)
    WHERE jsonb_typeof(item.value) IS DISTINCT FROM 'string'
  ) THEN
    RAISE EXCEPTION 'Production setup recipe codes must be strings'
      USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT lower(value)
    FROM jsonb_array_elements_text(NEW.data->'recipe_codes') AS requested(value)
    GROUP BY lower(value)
    HAVING count(*) > 1
  ) OR EXISTS (
    SELECT 1
    FROM jsonb_array_elements_text(NEW.data->'recipe_codes') AS requested(code)
    WHERE requested.code !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$'
       OR NOT EXISTS (
         SELECT 1 FROM v2.master_records AS r
         WHERE r.facility_id = NEW.facility_id
           AND r.kind = 'recipes'
           AND lower(r.code) = lower(requested.code)
           AND lower(r.product_code) = lower(NEW.product_code)
           AND r.data->>'sourceFamily' IS NULL
           AND r.data->>'station_key' IN ('dough', 'cheese', 'pepperoni', 'sauce', 'frontline')
           AND v2.validate_inventory_lines(NEW.facility_id, r.data->'ingredients', 1)
       )
  ) THEN
    RAISE EXCEPTION 'Production setup references an invalid or mismatched recipe'
      USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER run_inventory_master_record_validation
  BEFORE INSERT OR UPDATE OF product_code, data ON v2.master_records
  FOR EACH ROW EXECUTE FUNCTION v2.validate_run_inventory_master_record();

CREATE OR REPLACE FUNCTION v2.list_inventory_warehouses(p_facility_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, v2
AS $$
BEGIN
  IF p_facility_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM v2.facility_scope WHERE singleton AND facility_id = p_facility_id
  ) THEN
    RAISE EXCEPTION 'Invalid facility scope' USING ERRCODE = '42501';
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', w.id,
      'name', w.name,
      'active', w.active,
      'isProduction', w.is_production,
      'createdAt', w.created_at,
      'openingCountApplied', EXISTS (
        SELECT 1 FROM v2.opening_counts c
        WHERE c.facility_id = w.facility_id
          AND c.warehouse_id = w.id
          AND c.status = 'applied'
      )
    ) ORDER BY lower(w.name), w.id)
    FROM v2.inventory_warehouses w
    WHERE w.facility_id = p_facility_id
  ), '[]'::jsonb);
END
$$;

CREATE FUNCTION v2.set_production_warehouse(
  p_facility_id uuid,
  p_actor_id uuid,
  p_request_id text,
  p_request_hash text,
  p_warehouse_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, v2
AS $$
DECLARE
  v_existing_hash text;
  v_response jsonb;
  v_name text;
  v_now timestamptz;
BEGIN
  IF p_facility_id IS NULL OR p_actor_id IS NULL OR p_warehouse_id IS NULL
     OR NOT EXISTS (SELECT 1 FROM v2.facility_scope WHERE singleton AND facility_id = p_facility_id)
     OR p_request_id IS NULL OR length(btrim(p_request_id)) NOT BETWEEN 1 AND 200
     OR p_request_hash IS NULL OR p_request_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Invalid production warehouse selection'
      USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_facility_id::text || ':' || p_actor_id::text || ':' || p_request_id, 0)
  );
  SELECT request_hash, response INTO v_existing_hash, v_response
    FROM v2.command_receipts
    WHERE facility_id = p_facility_id
      AND actor_id = p_actor_id
      AND command_id = p_request_id;
  IF FOUND THEN
    IF v_existing_hash <> p_request_hash THEN
      RAISE EXCEPTION 'Request ID was reused with different details'
        USING ERRCODE = '22023';
    END IF;
    RETURN v_response || jsonb_build_object('replayed', true);
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_facility_id::text || ':production-warehouse', 0));
  SELECT w.name INTO v_name
    FROM v2.inventory_warehouses AS w
    WHERE w.facility_id = p_facility_id
      AND w.id = p_warehouse_id
      AND w.active
      AND EXISTS (
        SELECT 1 FROM v2.opening_counts AS c
        WHERE c.facility_id = w.facility_id
          AND c.warehouse_id = w.id
          AND c.status = 'applied'
      )
    FOR UPDATE;
  IF v_name IS NULL THEN
    RAISE EXCEPTION 'The production warehouse must be active and have an applied opening count'
      USING ERRCODE = '55000';
  END IF;
  UPDATE v2.inventory_warehouses
    SET is_production = false
    WHERE facility_id = p_facility_id AND is_production;
  UPDATE v2.inventory_warehouses
    SET is_production = true
    WHERE facility_id = p_facility_id AND id = p_warehouse_id;
  v_now := clock_timestamp();
  v_response := jsonb_build_object(
    'outcome', 'accepted',
    'replayed', false,
    'warehouse', jsonb_build_object(
      'id', p_warehouse_id,
      'name', v_name,
      'active', true,
      'isProduction', true,
      'openingCountApplied', true,
      'createdAt', (SELECT created_at FROM v2.inventory_warehouses
        WHERE facility_id = p_facility_id AND id = p_warehouse_id)
    )
  );
  INSERT INTO v2.command_receipts (facility_id, actor_id, command_id, request_hash, response, created_at)
  VALUES (p_facility_id, p_actor_id, p_request_id, p_request_hash, v_response, v_now);
  RETURN v_response;
END
$$;

CREATE OR REPLACE FUNCTION v2.list_run_products(p_facility_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, v2
AS $$
DECLARE
  v_warehouse jsonb;
  v_products jsonb;
BEGIN
  IF p_facility_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM v2.facility_scope
    WHERE singleton AND facility_id = p_facility_id
  ) THEN
    RAISE EXCEPTION 'Invalid facility scope' USING ERRCODE = '42501';
  END IF;
  SELECT jsonb_build_object('id', w.id, 'name', w.name)
    INTO v_warehouse
    FROM v2.inventory_warehouses AS w
    WHERE w.facility_id = p_facility_id
      AND w.active
      AND w.is_production
      AND EXISTS (
        SELECT 1 FROM v2.opening_counts AS c
        WHERE c.facility_id = w.facility_id
          AND c.warehouse_id = w.id
          AND c.status = 'applied'
      );
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'code', p.code,
    'name', p.name,
    'doughCapacity', v2.dough_capacity_snapshot(p_facility_id, p.code),
    'productionSetups', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('code', s.code, 'name', s.name) ORDER BY lower(s.name), s.code)
      FROM v2.master_records AS s
      WHERE s.facility_id = p_facility_id
        AND s.kind = 'production-setups'
        AND lower(s.product_code) = lower(p.code)
        AND s.data->>'sourceFamily' IS NULL
        AND jsonb_typeof(s.data->'recipe_codes') = 'array'
        AND jsonb_typeof(s.data->'packaging_per_case') = 'array'
    ), '[]'::jsonb)
  ) ORDER BY lower(p.name), p.code), '[]'::jsonb)
    INTO v_products
    FROM v2.products AS p
    WHERE p.facility_id = p_facility_id AND p.active;
  RETURN jsonb_build_object('productionWarehouse', v_warehouse, 'products', v_products);
END
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
  v_product v2.products%ROWTYPE;
  v_setup_record v2.master_records%ROWTYPE;
  v_warehouse v2.inventory_warehouses%ROWTYPE;
  v_plan jsonb;
  v_recipes jsonb;
BEGIN
  IF p_facility_id IS NULL OR p_actor_id IS NULL
     OR p_request_id IS NULL OR length(btrim(p_request_id)) = 0
     OR length(p_request_id) > 200
     OR p_request_hash IS NULL OR p_request_hash !~ '^[0-9a-f]{64}$'
     OR p_setup_snapshot IS NULL OR jsonb_typeof(p_setup_snapshot) <> 'object'
     OR (p_setup_snapshot - ARRAY['label', 'targetCases', 'productCode', 'productionSetupCode']) <> '{}'::jsonb
     OR jsonb_typeof(p_setup_snapshot->'label') IS DISTINCT FROM 'string'
     OR jsonb_typeof(p_setup_snapshot->'targetCases') IS DISTINCT FROM 'number'
     OR jsonb_typeof(p_setup_snapshot->'productCode') IS DISTINCT FROM 'string'
     OR p_setup_snapshot->>'productCode' !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$'
     OR jsonb_typeof(p_setup_snapshot->'productionSetupCode') IS DISTINCT FROM 'string'
     OR p_setup_snapshot->>'productionSetupCode' !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$' THEN
    RAISE EXCEPTION 'Invalid run creation request' USING ERRCODE = '22023';
  END IF;
  IF length(btrim(p_setup_snapshot->>'label')) NOT BETWEEN 1 AND 120
     OR (p_setup_snapshot->>'targetCases') !~ '^[1-9][0-9]*$'
     OR (p_setup_snapshot->>'targetCases')::numeric > 9007199254740991 THEN
    RAISE EXCEPTION 'Invalid run setup snapshot' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_facility_id::text || ':' || p_actor_id::text || ':' || p_request_id, 0)
  );
  SELECT request_hash, response INTO v_existing_hash, v_existing_response
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

  SELECT * INTO v_product
    FROM v2.products
    WHERE facility_id = p_facility_id
      AND lower(code) = lower(p_setup_snapshot->>'productCode')
      AND active
    FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The selected product is not active' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_setup_record
    FROM v2.master_records
    WHERE facility_id = p_facility_id
      AND kind = 'production-setups'
      AND lower(product_code) = lower(v_product.code)
      AND lower(code) = lower(p_setup_snapshot->>'productionSetupCode')
      AND data->>'sourceFamily' IS NULL
      AND jsonb_typeof(data->'recipe_codes') = 'array'
      AND jsonb_typeof(data->'packaging_per_case') = 'array'
    FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The selected production setup is not available for this product'
      USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_warehouse
    FROM v2.inventory_warehouses AS w
    WHERE w.facility_id = p_facility_id
      AND w.active
      AND w.is_production
      AND EXISTS (
        SELECT 1 FROM v2.opening_counts AS c
        WHERE c.facility_id = w.facility_id
          AND c.warehouse_id = w.id
          AND c.status = 'applied'
      )
    FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'An active production warehouse with an applied opening count is required'
      USING ERRCODE = '55000';
  END IF;

  SELECT jsonb_agg(jsonb_build_object(
    'code', r.code,
    'name', r.name,
    'stationKey', r.data->>'station_key',
    'ingredients', (
      SELECT jsonb_agg(jsonb_build_object(
        'productId', ingredient_product.id,
        'productCode', ingredient_product.code,
        'productName', ingredient_product.name,
        'quantity', ingredient.value->>'quantity',
        'unit', ingredient.value->>'unit'
      ) ORDER BY ingredient.ordinality)
      FROM jsonb_array_elements(r.data->'ingredients') WITH ORDINALITY AS ingredient(value, ordinality)
      JOIN v2.products AS ingredient_product
        ON ingredient_product.facility_id = p_facility_id
        AND lower(ingredient_product.code) = lower(ingredient.value->>'product_code')
        AND ingredient_product.active
    )
  ) ORDER BY requested.ordinality)
    INTO v_recipes
    FROM jsonb_array_elements_text(v_setup_record.data->'recipe_codes')
      WITH ORDINALITY AS requested(code, ordinality)
    JOIN v2.master_records AS r
      ON r.facility_id = p_facility_id
      AND r.kind = 'recipes'
      AND lower(r.code) = lower(requested.code)
      AND lower(r.product_code) = lower(v_product.code);

  IF jsonb_array_length(COALESCE(v_recipes, '[]'::jsonb))
       <> jsonb_array_length(v_setup_record.data->'recipe_codes') THEN
    RAISE EXCEPTION 'The production setup references unavailable recipe inventory lines'
      USING ERRCODE = '22023';
  END IF;

  SELECT jsonb_agg(jsonb_build_object(
    'productId', packaging_product.id,
    'productCode', packaging_product.code,
    'productName', packaging_product.name,
    'quantity', packaging.value->>'quantity',
    'unit', packaging.value->>'unit'
  ) ORDER BY packaging.ordinality)
    INTO v_plan
    FROM jsonb_array_elements(v_setup_record.data->'packaging_per_case')
      WITH ORDINALITY AS packaging(value, ordinality)
    JOIN v2.products AS packaging_product
      ON packaging_product.facility_id = p_facility_id
      AND lower(packaging_product.code) = lower(packaging.value->>'product_code')
      AND packaging_product.active;

  IF jsonb_array_length(COALESCE(v_plan, '[]'::jsonb))
       <> jsonb_array_length(v_setup_record.data->'packaging_per_case') THEN
    RAISE EXCEPTION 'The production setup references unavailable packaging inventory lines'
      USING ERRCODE = '22023';
  END IF;

  v_plan := jsonb_build_object(
    'code', v_setup_record.code,
    'name', v_setup_record.name,
    'warehouse', jsonb_build_object('id', v_warehouse.id, 'name', v_warehouse.name),
    'recipes', v_recipes,
    'packagingPerCase', v_plan
  );
  v_setup := jsonb_build_object(
    'label', btrim(p_setup_snapshot->>'label'),
    'targetCases', (p_setup_snapshot->>'targetCases')::bigint,
    'productCode', v_product.code,
    'productionSetupCode', v_setup_record.code,
    'productionPlan', v_plan
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
    'inventoryConsumption', (
      SELECT c.details FROM v2.run_inventory_consumptions AS c
      WHERE c.facility_id = p_facility_id AND c.run_id = p_run_id
    ),
    'pauseIntervals', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'startedAt', to_char(p.paused_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'endedAt', CASE WHEN p.resumed_at IS NULL THEN NULL
          ELSE to_char(p.resumed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END
      ) ORDER BY p.pause_number)
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
        ) ORDER BY s.station_key
      )
      FROM v2.run_station_progress AS s
      WHERE s.facility_id = p_facility_id AND s.run_id = p_run_id
    ), '{}'::jsonb)
  )
  FROM v2.runs AS r
  WHERE r.facility_id = p_facility_id AND r.id = p_run_id
$$;

CREATE FUNCTION v2.apply_run_inventory_consumption(
  p_facility_id uuid,
  p_run_id uuid,
  p_actor_id uuid,
  p_plan jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, v2
AS $$
DECLARE
  v_warehouse_id uuid;
  v_warehouse_name text;
  v_balance v2.inventory_balances%ROWTYPE;
  v_demand record;
  v_deducted numeric;
  v_shortfall numeric;
  v_lines jsonb := '[]'::jsonb;
  v_detail jsonb;
  v_now timestamptz := clock_timestamp();
BEGIN
  IF p_facility_id IS NULL OR p_run_id IS NULL OR p_actor_id IS NULL
     OR jsonb_typeof(p_plan) IS DISTINCT FROM 'object'
     OR NOT EXISTS (
       SELECT 1 FROM v2.facility_scope WHERE singleton AND facility_id = p_facility_id
     ) THEN
    RAISE EXCEPTION 'Invalid run inventory scope' USING ERRCODE = '42501';
  END IF;
  BEGIN
    v_warehouse_id := (p_plan->'warehouse'->>'id')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'Invalid run inventory warehouse' USING ERRCODE = '22023';
  END;
  SELECT w.name INTO v_warehouse_name
    FROM v2.inventory_warehouses AS w
    WHERE w.facility_id = p_facility_id
      AND w.id = v_warehouse_id
      AND w.active
      AND EXISTS (
        SELECT 1 FROM v2.opening_counts AS c
        WHERE c.facility_id = w.facility_id
          AND c.warehouse_id = w.id
          AND c.status = 'applied'
      )
    FOR UPDATE;
  IF v_warehouse_name IS NULL THEN
    RAISE EXCEPTION 'The run production warehouse is unavailable'
      USING ERRCODE = '55000';
  END IF;

  FOR v_demand IN
    WITH station_counts AS (
      SELECT s.station_key,
        CASE
          WHEN s.station_key = 'sauce'
            AND s.progress->>'barrelsMade' ~ '^[0-9]+$'
            THEN (s.progress->>'barrelsMade')::numeric
          WHEN s.progress->>'batchesMade' ~ '^[0-9]+$'
            THEN (s.progress->>'batchesMade')::numeric
          ELSE 0::numeric
        END AS quantity
      FROM v2.run_station_progress AS s
      WHERE s.facility_id = p_facility_id AND s.run_id = p_run_id
    ),
    recipe_demand AS (
      SELECT
        (ingredient.value->>'productId')::uuid AS product_id,
        ingredient.value->>'productCode' AS product_code,
        ingredient.value->>'productName' AS product_name,
        ingredient.value->>'unit' AS unit,
        sum((ingredient.value->>'quantity')::numeric * station.quantity) AS required
      FROM jsonb_array_elements(p_plan->'recipes') AS recipe(value)
      JOIN station_counts AS station
        ON station.station_key = recipe.value->>'stationKey'
      CROSS JOIN LATERAL jsonb_array_elements(recipe.value->'ingredients') AS ingredient(value)
      GROUP BY ingredient.value->>'productId',
        ingredient.value->>'productCode', ingredient.value->>'productName',
        ingredient.value->>'unit'
    ),
    packed_cases AS (
      SELECT COALESCE(max(
        CASE WHEN s.progress->>'casesPacked' ~ '^[0-9]+$'
          THEN (s.progress->>'casesPacked')::numeric ELSE 0::numeric END
      ), 0::numeric) AS quantity
      FROM v2.run_station_progress AS s
      WHERE s.facility_id = p_facility_id
        AND s.run_id = p_run_id
        AND s.station_key = 'packaging'
    ),
    packaging_demand AS (
      SELECT
        (line.value->>'productId')::uuid AS product_id,
        line.value->>'productCode' AS product_code,
        line.value->>'productName' AS product_name,
        line.value->>'unit' AS unit,
        sum((line.value->>'quantity')::numeric * packed_cases.quantity) AS required
      FROM jsonb_array_elements(p_plan->'packagingPerCase') AS line(value)
      CROSS JOIN packed_cases
      GROUP BY line.value->>'productId',
        line.value->>'productCode', line.value->>'productName',
        line.value->>'unit'
    ),
    combined AS (
      SELECT * FROM recipe_demand
      UNION ALL
      SELECT * FROM packaging_demand
    )
    SELECT product_id, product_code, product_name, unit, sum(required) AS required
    FROM combined
    WHERE required > 0
    GROUP BY product_id, product_code, product_name, unit
    ORDER BY product_id
  LOOP
    INSERT INTO v2.inventory_balances (facility_id, warehouse_id, product_id)
    VALUES (p_facility_id, v_warehouse_id, v_demand.product_id)
    ON CONFLICT DO NOTHING;
    SELECT * INTO v_balance FROM v2.inventory_balances AS b
      WHERE b.facility_id = p_facility_id
        AND b.warehouse_id = v_warehouse_id
        AND b.product_id = v_demand.product_id
      FOR UPDATE;
    v_deducted := LEAST(v_demand.required, v_balance.quantity);
    v_shortfall := v_demand.required - v_deducted;
    IF v_deducted > 0 THEN
      IF v_balance.revision >= 9007199254740991 THEN
        RAISE EXCEPTION 'Inventory revision is exhausted' USING ERRCODE = '22003';
      END IF;
      UPDATE v2.inventory_balances
        SET quantity = quantity - v_deducted,
            revision = revision + 1,
            updated_at = v_now
        WHERE facility_id = p_facility_id
          AND warehouse_id = v_warehouse_id
          AND product_id = v_demand.product_id;
      INSERT INTO v2.inventory_movements (
        facility_id, warehouse_id, product_id, movement_group_id, movement_type,
        quantity_delta, reason, actor_id, command_id, occurred_at, run_id
      ) VALUES (
        p_facility_id, v_warehouse_id, v_demand.product_id, p_run_id, 'run_consumption',
        -v_deducted, 'Run completion inventory use', p_actor_id,
        'run:' || p_run_id::text || ':' || v_demand.product_id::text,
        v_now, p_run_id
      );
    END IF;
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'productId', v_demand.product_id,
      'productCode', v_demand.product_code,
      'productName', v_demand.product_name,
      'unit', v_demand.unit,
      'required', v_demand.required::text,
      'deducted', v_deducted::text,
      'shortfall', v_shortfall::text
    ));
  END LOOP;

  v_detail := jsonb_build_object(
    'status', 'completed',
    'runId', p_run_id,
    'warehouseId', v_warehouse_id,
    'warehouseName', v_warehouse_name,
    'lines', v_lines,
    'occurredAt', to_char(v_now AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  );
  INSERT INTO v2.run_inventory_consumptions (
    facility_id, run_id, warehouse_id, actor_id, details, occurred_at
  ) VALUES (
    p_facility_id, p_run_id, v_warehouse_id, p_actor_id, v_detail, v_now
  );
  RETURN v_detail;
END
$$;

CREATE FUNCTION v2.consume_run_inventory_before_completion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, v2
AS $$
DECLARE
  v_actor_id uuid;
BEGIN
  IF OLD.status <> 'completed' AND NEW.status = 'completed'
     AND NEW.setup_snapshot ? 'productionPlan' THEN
    BEGIN
      v_actor_id := current_setting('v2.run_completion_actor_id', true)::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      v_actor_id := NULL;
    END;
    IF v_actor_id IS NULL THEN
      RAISE EXCEPTION 'Use the authorized run completion command'
        USING ERRCODE = '42501';
    END IF;
    PERFORM v2.apply_run_inventory_consumption(
      NEW.facility_id, NEW.id, v_actor_id, NEW.setup_snapshot->'productionPlan'
    );
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER run_inventory_consume_before_completion
  BEFORE UPDATE OF status ON v2.runs
  FOR EACH ROW EXECUTE FUNCTION v2.consume_run_inventory_before_completion();

CREATE FUNCTION v2.complete_run_with_inventory(
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
BEGIN
  IF p_actor_id IS NULL OR p_command_type IS DISTINCT FROM 'complete' THEN
    RAISE EXCEPTION 'Verified actor is required' USING ERRCODE = '42501';
  END IF;
  PERFORM set_config('v2.run_completion_actor_id', p_actor_id::text, true);
  RETURN v2.apply_run_lifecycle_command(
    p_facility_id, p_run_id, p_actor_id, p_command_id,
    p_request_hash, p_command_type, p_expected_revision
  );
END
$$;

REVOKE ALL ON FUNCTION v2.validate_inventory_lines(uuid, jsonb, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION v2.validate_run_inventory_master_record() FROM PUBLIC;
REVOKE ALL ON FUNCTION v2.set_production_warehouse(uuid, uuid, text, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION v2.apply_run_inventory_consumption(uuid, uuid, uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION v2.consume_run_inventory_before_completion() FROM PUBLIC;
REVOKE ALL ON FUNCTION v2.complete_run_with_inventory(uuid, uuid, uuid, text, text, text, bigint) FROM PUBLIC;

COMMENT ON FUNCTION v2.complete_run_with_inventory(uuid, uuid, uuid, text, text, text, bigint)
  IS 'Authorized completion boundary; completes a run and records its exact-once inventory receipt and stock movements in the same transaction.';

COMMIT;
