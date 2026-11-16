BEGIN;

CREATE TABLE v2.inventory_warehouses (
  facility_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (
    length(btrim(name)) BETWEEN 1 AND 120
    AND name = btrim(name)
    AND name !~ '[[:cntrl:]]'
  ),
  active boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (facility_id, id)
);

CREATE UNIQUE INDEX inventory_warehouses_name_casefolded
  ON v2.inventory_warehouses (facility_id, lower(name));

CREATE TABLE v2.products (
  facility_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  code text NOT NULL CHECK (code ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$'),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  base_unit text NOT NULL CHECK (base_unit ~ '^[A-Za-z][A-Za-z0-9._/-]{0,15}$'),
  active boolean NOT NULL DEFAULT true,
  source_import_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (facility_id, id),
  UNIQUE (facility_id, code)
);

CREATE UNIQUE INDEX products_code_casefolded
  ON v2.products (facility_id, lower(code));

CREATE TABLE v2.master_records (
  facility_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('recipes', 'production-setups')),
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  code text NOT NULL CHECK (code ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$'),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  product_code text NOT NULL CHECK (product_code ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$'),
  data jsonb NOT NULL CHECK (jsonb_typeof(data) = 'object'),
  source_import_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (facility_id, kind, id)
);

CREATE UNIQUE INDEX master_records_code_casefolded
  ON v2.master_records (facility_id, kind, lower(code));
CREATE INDEX master_records_product_reference
  ON v2.master_records (facility_id, lower(product_code));

CREATE TABLE v2.setup_imports (
  facility_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  actor_id uuid NOT NULL,
  request_id text NOT NULL CHECK (length(btrim(request_id)) BETWEEN 1 AND 200),
  request_hash text NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  kind text NOT NULL CHECK (kind IN ('products', 'recipes', 'production-setups')),
  records jsonb NOT NULL CHECK (
    jsonb_typeof(records) = 'array'
    AND jsonb_array_length(records) BETWEEN 1 AND 2000
  ),
  status text NOT NULL DEFAULT 'staged' CHECK (status IN ('staged', 'applied', 'undone')),
  applied_by uuid,
  undone_by uuid,
  before_snapshot jsonb,
  after_snapshot jsonb,
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  applied_at timestamptz,
  undone_at timestamptz,
  PRIMARY KEY (facility_id, id),
  UNIQUE (facility_id, actor_id, request_id),
  CHECK ((status = 'staged') = (applied_at IS NULL)),
  CHECK ((status = 'undone') = (undone_at IS NOT NULL))
);

CREATE TABLE v2.inventory_balances (
  facility_id uuid NOT NULL,
  warehouse_id uuid NOT NULL,
  product_id uuid NOT NULL,
  quantity numeric(20,6) NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (facility_id, warehouse_id, product_id),
  FOREIGN KEY (facility_id, warehouse_id)
    REFERENCES v2.inventory_warehouses (facility_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (facility_id, product_id)
    REFERENCES v2.products (facility_id, id) ON DELETE RESTRICT
);

CREATE TABLE v2.inventory_movements (
  facility_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  warehouse_id uuid NOT NULL,
  product_id uuid NOT NULL,
  movement_group_id uuid NOT NULL,
  movement_type text NOT NULL CHECK (
    movement_type IN ('receipt', 'adjustment', 'transfer_out', 'transfer_in', 'opening_count')
  ),
  quantity_delta numeric(20,6) NOT NULL CHECK (quantity_delta <> 0),
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 3 AND 500),
  actor_id uuid NOT NULL,
  command_id text NOT NULL CHECK (length(btrim(command_id)) BETWEEN 1 AND 200),
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (facility_id, id),
  FOREIGN KEY (facility_id, warehouse_id)
    REFERENCES v2.inventory_warehouses (facility_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (facility_id, product_id)
    REFERENCES v2.products (facility_id, id) ON DELETE RESTRICT
);

CREATE INDEX inventory_movements_product_time
  ON v2.inventory_movements (facility_id, product_id, occurred_at DESC, id DESC);
CREATE INDEX inventory_movements_warehouse_time
  ON v2.inventory_movements (facility_id, warehouse_id, occurred_at DESC, id DESC);

CREATE TABLE v2.opening_counts (
  facility_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  warehouse_id uuid NOT NULL,
  actor_id uuid NOT NULL,
  request_id text NOT NULL CHECK (length(btrim(request_id)) BETWEEN 1 AND 200),
  request_hash text NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  rows jsonb NOT NULL CHECK (
    jsonb_typeof(rows) = 'array'
    AND jsonb_array_length(rows) BETWEEN 1 AND 2000
  ),
  status text NOT NULL DEFAULT 'staged' CHECK (status IN ('staged', 'reviewed', 'applied')),
  reviewed_by uuid,
  reviewed_at timestamptz,
  applied_by uuid,
  applied_at timestamptz,
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (facility_id, id),
  UNIQUE (facility_id, actor_id, request_id),
  FOREIGN KEY (facility_id, warehouse_id)
    REFERENCES v2.inventory_warehouses (facility_id, id) ON DELETE RESTRICT,
  CHECK ((status = 'staged') = (reviewed_at IS NULL)),
  CHECK ((status = 'applied') = (applied_at IS NOT NULL)),
  CHECK ((applied_at IS NULL) = (applied_by IS NULL)),
  CHECK ((reviewed_at IS NULL) = (reviewed_by IS NULL))
);

CREATE UNIQUE INDEX opening_counts_one_per_warehouse
  ON v2.opening_counts (facility_id, warehouse_id)
  WHERE status = 'applied';

CREATE UNIQUE INDEX opening_counts_one_pending_per_warehouse
  ON v2.opening_counts (facility_id, warehouse_id)
  WHERE status IN ('staged', 'reviewed');

CREATE TRIGGER inventory_movements_append_only
  BEFORE UPDATE OR DELETE ON v2.inventory_movements
  FOR EACH ROW EXECUTE FUNCTION v2.reject_immutable_row_mutation();

CREATE FUNCTION v2.list_inventory_warehouses(p_facility_id uuid)
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

CREATE FUNCTION v2.list_inventory_products(p_facility_id uuid)
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
      'id', p.id,
      'code', p.code,
      'name', p.name,
      'unit', p.base_unit,
      'active', p.active
    ) ORDER BY lower(p.name), p.id)
    FROM v2.products p
    WHERE p.facility_id = p_facility_id AND p.active
  ), '[]'::jsonb);
END
$$;

CREATE FUNCTION v2.list_inventory_stock(p_facility_id uuid, p_warehouse_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, v2
AS $$
BEGIN
  IF p_facility_id IS NULL OR p_warehouse_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM v2.facility_scope WHERE singleton AND facility_id = p_facility_id
  ) THEN
    RAISE EXCEPTION 'Invalid inventory scope' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM v2.inventory_warehouses
    WHERE facility_id = p_facility_id AND id = p_warehouse_id AND active
  ) THEN
    RAISE EXCEPTION 'Warehouse not found' USING ERRCODE = 'P0002';
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'productId', p.id,
      'code', p.code,
      'name', p.name,
      'unit', p.base_unit,
      'quantity', COALESCE(b.quantity, 0)::text,
      'revision', COALESCE(b.revision, 0)
    ) ORDER BY lower(p.name), p.id)
    FROM v2.products p
    LEFT JOIN v2.inventory_balances b
      ON b.facility_id = p.facility_id
      AND b.product_id = p.id
      AND b.warehouse_id = p_warehouse_id
    WHERE p.facility_id = p_facility_id AND p.active
  ), '[]'::jsonb);
END
$$;

CREATE FUNCTION v2.list_inventory_movements(
  p_facility_id uuid,
  p_warehouse_id uuid,
  p_limit integer,
  p_before_at timestamptz,
  p_before_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, v2
AS $$
BEGIN
  IF p_facility_id IS NULL OR p_warehouse_id IS NULL
     OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100
     OR ((p_before_at IS NULL) <> (p_before_id IS NULL))
     OR NOT EXISTS (
       SELECT 1 FROM v2.facility_scope WHERE singleton AND facility_id = p_facility_id
     ) THEN
    RAISE EXCEPTION 'Invalid inventory history request' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM v2.inventory_warehouses
    WHERE facility_id = p_facility_id AND id = p_warehouse_id AND active
  ) THEN RAISE EXCEPTION 'Warehouse not found' USING ERRCODE = 'P0002'; END IF;
  RETURN (
    WITH page AS (
      SELECT
        m.id,
        m.movement_group_id,
        p.code AS product_code,
        p.name AS product_name,
        p.base_unit,
        m.movement_type,
        m.quantity_delta,
        m.reason,
        m.actor_id,
        m.occurred_at,
        row_number() OVER (ORDER BY m.occurred_at DESC, m.id DESC) AS row_num
      FROM v2.inventory_movements m
      JOIN v2.products p ON p.facility_id = m.facility_id AND p.id = m.product_id
      WHERE m.facility_id = p_facility_id AND m.warehouse_id = p_warehouse_id
        AND (p_before_at IS NULL OR (m.occurred_at, m.id) < (p_before_at, p_before_id))
      ORDER BY m.occurred_at DESC, m.id DESC
      LIMIT p_limit + 1
    )
    SELECT jsonb_build_object(
      'items', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', id,
          'movementGroupId', movement_group_id,
          'productCode', product_code,
          'productName', product_name,
          'unit', base_unit,
          'type', movement_type,
          'quantityDelta', quantity_delta::text,
          'reason', reason,
          'actorId', actor_id,
          'occurredAt', occurred_at
        ) ORDER BY row_num)
        FROM page WHERE row_num <= p_limit
      ), '[]'::jsonb),
      'nextCursor', CASE WHEN EXISTS (SELECT 1 FROM page WHERE row_num > p_limit) THEN (
        SELECT jsonb_build_object('occurredAt', occurred_at, 'id', id)
        FROM page WHERE row_num = p_limit
      ) ELSE NULL END
    )
  );
END
$$;

CREATE FUNCTION v2.create_inventory_warehouse(
  p_facility_id uuid,
  p_actor_id uuid,
  p_request_id text,
  p_request_hash text,
  p_name text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, v2
AS $$
DECLARE
  v_existing_hash text;
  v_response jsonb;
  v_warehouse_id uuid;
  v_name text := btrim(p_name);
  v_now timestamptz;
BEGIN
  IF p_facility_id IS NULL OR p_actor_id IS NULL
     OR NOT EXISTS (SELECT 1 FROM v2.facility_scope WHERE singleton AND facility_id = p_facility_id)
     OR p_request_id IS NULL OR length(btrim(p_request_id)) NOT BETWEEN 1 AND 200
     OR p_request_hash IS NULL OR p_request_hash !~ '^[0-9a-f]{64}$'
     OR p_name IS NULL OR length(v_name) NOT BETWEEN 1 AND 120
     OR v_name ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'Invalid warehouse request' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_facility_id::text || ':' || p_actor_id::text || ':' || p_request_id, 0)
  );
  SELECT request_hash, response INTO v_existing_hash, v_response
  FROM v2.command_receipts
  WHERE facility_id = p_facility_id AND actor_id = p_actor_id AND command_id = p_request_id;
  IF FOUND THEN
    IF v_existing_hash <> p_request_hash THEN
      RAISE EXCEPTION 'Request ID was reused with different details' USING ERRCODE = '22023';
    END IF;
    RETURN v_response || jsonb_build_object('replayed', true);
  END IF;
  IF EXISTS (
    SELECT 1 FROM v2.inventory_warehouses
    WHERE facility_id = p_facility_id AND lower(name) = lower(v_name)
  ) THEN
    RAISE EXCEPTION 'Warehouse name already exists' USING ERRCODE = '23505';
  END IF;
  v_now := clock_timestamp();
  INSERT INTO v2.inventory_warehouses (facility_id, name, created_by, created_at)
  VALUES (p_facility_id, v_name, p_actor_id, v_now)
  RETURNING id INTO v_warehouse_id;
  v_response := jsonb_build_object(
    'outcome', 'created',
    'replayed', false,
    'warehouse', jsonb_build_object(
      'id', v_warehouse_id,
      'name', v_name,
      'active', true,
      'createdAt', v_now,
      'openingCountApplied', false
    )
  );
  INSERT INTO v2.command_receipts (facility_id, actor_id, command_id, request_hash, response, created_at)
  VALUES (p_facility_id, p_actor_id, p_request_id, p_request_hash, v_response, v_now);
  RETURN v_response;
END
$$;

CREATE FUNCTION v2.stage_setup_import(
  p_facility_id uuid,
  p_actor_id uuid,
  p_request_id text,
  p_request_hash text,
  p_kind text,
  p_records jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, v2
AS $$
DECLARE
  v_existing v2.setup_imports%ROWTYPE;
  v_id uuid;
  v_now timestamptz;
  v_record jsonb;
BEGIN
  IF p_facility_id IS NULL OR p_actor_id IS NULL
     OR NOT EXISTS (SELECT 1 FROM v2.facility_scope WHERE singleton AND facility_id = p_facility_id)
     OR p_request_id IS NULL OR length(btrim(p_request_id)) NOT BETWEEN 1 AND 200
     OR p_request_hash IS NULL OR p_request_hash !~ '^[0-9a-f]{64}$'
     OR p_kind IS NULL OR p_kind NOT IN ('products', 'recipes', 'production-setups')
     OR jsonb_typeof(p_records) <> 'array'
     OR jsonb_array_length(p_records) NOT BETWEEN 1 AND 2000 THEN
    RAISE EXCEPTION 'Invalid import request' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_facility_id::text || ':' || p_actor_id::text || ':' || p_request_id, 0)
  );
  SELECT * INTO v_existing FROM v2.setup_imports
  WHERE facility_id = p_facility_id AND actor_id = p_actor_id AND request_id = p_request_id
  FOR UPDATE;
  IF FOUND THEN
    IF v_existing.request_hash <> p_request_hash OR v_existing.kind <> p_kind THEN
      RAISE EXCEPTION 'Import request ID was reused with different details' USING ERRCODE = '22023';
    END IF;
    RETURN jsonb_build_object(
      'outcome', v_existing.status,
      'importId', v_existing.id,
      'kind', v_existing.kind,
      'rowCount', jsonb_array_length(v_existing.records),
      'replayed', true,
      'result', v_existing.result
    );
  END IF;
  FOR v_record IN SELECT value FROM jsonb_array_elements(p_records) LOOP
    IF jsonb_typeof(v_record) <> 'object'
       OR jsonb_typeof(v_record->'code') <> 'string'
       OR jsonb_typeof(v_record->'name') <> 'string'
       OR (p_kind = 'products' AND jsonb_typeof(v_record->'unit') <> 'string')
       OR (p_kind <> 'products' AND (
         jsonb_typeof(v_record->'productCode') <> 'string'
         OR jsonb_typeof(v_record->'data') <> 'object'
       )) THEN
      RAISE EXCEPTION 'Import row has an invalid shape' USING ERRCODE = '22023';
    END IF;
  END LOOP;
  IF (
    SELECT count(*) FROM (
      SELECT lower(value->>'code') AS code
      FROM jsonb_array_elements(p_records)
      GROUP BY lower(value->>'code')
    ) duplicates
  ) <> jsonb_array_length(p_records) THEN
    RAISE EXCEPTION 'Import contains duplicate codes' USING ERRCODE = '22023';
  END IF;
  IF p_kind <> 'products' AND EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_records) AS rows(value)
    WHERE NOT EXISTS (
      SELECT 1 FROM v2.products p
      WHERE p.facility_id = p_facility_id
        AND lower(p.code) = lower(rows.value->>'productCode')
        AND p.active
    )
  ) THEN
    RAISE EXCEPTION 'Import references an unknown or inactive product' USING ERRCODE = '23503';
  END IF;
  v_now := clock_timestamp();
  INSERT INTO v2.setup_imports (
    facility_id, actor_id, request_id, request_hash, kind, records, created_at
  ) VALUES (
    p_facility_id, p_actor_id, p_request_id, p_request_hash, p_kind, p_records, v_now
  ) RETURNING id INTO v_id;
  RETURN jsonb_build_object(
    'outcome', 'staged',
    'importId', v_id,
    'kind', p_kind,
    'rowCount', jsonb_array_length(p_records),
    'replayed', false
  );
END
$$;

CREATE FUNCTION v2.apply_setup_import(p_facility_id uuid, p_actor_id uuid, p_import_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, v2
AS $$
DECLARE
  v_import v2.setup_imports%ROWTYPE;
  v_row jsonb;
  v_before jsonb;
  v_after jsonb;
  v_before_rows jsonb := '[]'::jsonb;
  v_after_rows jsonb := '[]'::jsonb;
  v_product v2.products%ROWTYPE;
  v_record v2.master_records%ROWTYPE;
  v_code text;
  v_product_code text;
  v_unit text;
  v_name text;
  v_now timestamptz;
  v_result jsonb;
BEGIN
  IF p_facility_id IS NULL OR p_actor_id IS NULL OR p_import_id IS NULL
     OR NOT EXISTS (SELECT 1 FROM v2.facility_scope WHERE singleton AND facility_id = p_facility_id) THEN
    RAISE EXCEPTION 'Invalid import scope' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_import FROM v2.setup_imports
  WHERE facility_id = p_facility_id AND id = p_import_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Import not found' USING ERRCODE = 'P0002'; END IF;
  IF v_import.status = 'applied' THEN
    RETURN COALESCE(v_import.result, '{}'::jsonb) || jsonb_build_object('replayed', true);
  END IF;
  IF v_import.status <> 'staged' THEN
    RAISE EXCEPTION 'Import cannot be applied in its current state' USING ERRCODE = '55000';
  END IF;
  IF v_import.kind = 'products' THEN
    PERFORM 1 FROM v2.facility_scope
    WHERE singleton AND facility_id = p_facility_id
    FOR UPDATE;
  END IF;
  v_now := clock_timestamp();
  FOR v_row IN SELECT value FROM jsonb_array_elements(v_import.records) LOOP
    v_code := v_row->>'code';
    v_name := v_row->>'name';
    PERFORM pg_advisory_xact_lock(
      hashtextextended(p_facility_id::text || ':' || v_import.kind || ':' || lower(v_code), 0)
    );
    IF v_import.kind = 'products' THEN
      SELECT * INTO v_product FROM v2.products
      WHERE facility_id = p_facility_id AND lower(code) = lower(v_code)
      FOR UPDATE;
      v_before := CASE WHEN FOUND THEN to_jsonb(v_product) ELSE NULL END;
      v_unit := lower(v_row->>'unit');
      IF FOUND AND v_product.base_unit <> v_unit THEN
        RAISE EXCEPTION 'A product base unit cannot change after creation' USING ERRCODE = '22023';
      END IF;
      IF FOUND THEN
        UPDATE v2.products SET name = v_name, source_import_id = p_import_id, updated_at = v_now
        WHERE facility_id = p_facility_id AND id = v_product.id
        RETURNING * INTO v_product;
      ELSE
        INSERT INTO v2.products (facility_id, code, name, base_unit, source_import_id, created_at, updated_at)
        VALUES (p_facility_id, v_code, v_name, v_unit, p_import_id, v_now, v_now)
        RETURNING * INTO v_product;
      END IF;
      v_after := to_jsonb(v_product);
    ELSE
      v_product_code := v_row->>'productCode';
      SELECT * INTO v_product FROM v2.products
      WHERE facility_id = p_facility_id AND lower(code) = lower(v_product_code) AND active
      FOR SHARE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Import references an unknown or inactive product' USING ERRCODE = '23503';
      END IF;
      v_product_code := v_product.code;
      SELECT * INTO v_record FROM v2.master_records
      WHERE facility_id = p_facility_id AND kind = v_import.kind AND lower(code) = lower(v_code)
      FOR UPDATE;
      v_before := CASE WHEN FOUND THEN to_jsonb(v_record) ELSE NULL END;
      IF FOUND THEN
        UPDATE v2.master_records
        SET name = v_name, product_code = v_product_code, data = v_row->'data',
            source_import_id = p_import_id, updated_at = v_now
        WHERE facility_id = p_facility_id AND kind = v_import.kind AND id = v_record.id
        RETURNING * INTO v_record;
      ELSE
        INSERT INTO v2.master_records (
          facility_id, kind, code, name, product_code, data, source_import_id, created_at, updated_at
        ) VALUES (
          p_facility_id, v_import.kind, v_code, v_name, v_product_code,
          v_row->'data', p_import_id, v_now, v_now
        ) RETURNING * INTO v_record;
      END IF;
      v_after := to_jsonb(v_record);
    END IF;
    v_before_rows := v_before_rows || jsonb_build_array(jsonb_build_object('code', v_code, 'data', v_before));
    v_after_rows := v_after_rows || jsonb_build_array(jsonb_build_object('code', v_code, 'data', v_after));
  END LOOP;
  v_result := jsonb_build_object(
    'outcome', 'applied',
    'importId', p_import_id,
    'kind', v_import.kind,
    'rowCount', jsonb_array_length(v_import.records),
    'appliedAt', v_now,
    'replayed', false
  );
  UPDATE v2.setup_imports
  SET status = 'applied', before_snapshot = v_before_rows, after_snapshot = v_after_rows,
      result = v_result, applied_at = v_now, applied_by = p_actor_id
  WHERE facility_id = p_facility_id AND id = p_import_id;
  RETURN v_result;
END
$$;

CREATE FUNCTION v2.undo_setup_import(p_facility_id uuid, p_actor_id uuid, p_import_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, v2
AS $$
DECLARE
  v_import v2.setup_imports%ROWTYPE;
  v_after jsonb;
  v_before jsonb;
  v_record jsonb;
  v_id uuid;
  v_now timestamptz;
  v_result jsonb;
BEGIN
  IF p_facility_id IS NULL OR p_actor_id IS NULL OR p_import_id IS NULL
     OR NOT EXISTS (SELECT 1 FROM v2.facility_scope WHERE singleton AND facility_id = p_facility_id) THEN
    RAISE EXCEPTION 'Invalid import scope' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_import FROM v2.setup_imports
  WHERE facility_id = p_facility_id AND id = p_import_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Import not found' USING ERRCODE = 'P0002'; END IF;
  IF v_import.status = 'undone' THEN
    RETURN COALESCE(v_import.result, '{}'::jsonb) || jsonb_build_object('outcome', 'undone', 'replayed', true);
  END IF;
  IF v_import.status <> 'applied' THEN
    RAISE EXCEPTION 'Only an applied import can be undone' USING ERRCODE = '55000';
  END IF;
  IF v_import.kind = 'products' THEN
    PERFORM 1 FROM v2.facility_scope
    WHERE singleton AND facility_id = p_facility_id
    FOR UPDATE;
  END IF;
  FOR v_after IN SELECT value FROM jsonb_array_elements(v_import.after_snapshot) LOOP
    v_before := (
      SELECT NULLIF(value->'data', 'null'::jsonb)
      FROM jsonb_array_elements(v_import.before_snapshot)
      WHERE lower(value->>'code') = lower(v_after->>'code')
    );
    v_record := v_after->'data';
    IF v_import.kind = 'products' THEN
      SELECT id INTO v_id FROM v2.products
      WHERE facility_id = p_facility_id
        AND id = (v_record->>'id')::uuid
        AND source_import_id = p_import_id
      FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'A product changed after this import; undo is blocked' USING ERRCODE = '40001';
      END IF;
      IF v_before IS NULL THEN
        IF EXISTS (
          SELECT 1 FROM v2.inventory_movements
          WHERE facility_id = p_facility_id AND product_id = v_id
        ) OR EXISTS (
          SELECT 1 FROM v2.master_records
          WHERE facility_id = p_facility_id AND lower(product_code) = lower(v_record->>'code')
        ) THEN
          RAISE EXCEPTION 'A product is now referenced; undo is blocked' USING ERRCODE = '40001';
        END IF;
        DELETE FROM v2.products WHERE facility_id = p_facility_id AND id = v_id;
      ELSE
        UPDATE v2.products
        SET code = v_before->>'code',
            name = v_before->>'name',
            base_unit = v_before->>'base_unit',
            active = (v_before->>'active')::boolean,
            source_import_id = NULLIF(v_before->>'source_import_id', '')::uuid,
            updated_at = (v_before->>'updated_at')::timestamptz
        WHERE facility_id = p_facility_id AND id = v_id;
      END IF;
    ELSE
      SELECT id INTO v_id FROM v2.master_records
      WHERE facility_id = p_facility_id
        AND kind = v_import.kind
        AND id = (v_record->>'id')::uuid
        AND source_import_id = p_import_id
      FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'A setup record changed after this import; undo is blocked' USING ERRCODE = '40001';
      END IF;
      IF v_before IS NULL THEN
        DELETE FROM v2.master_records
        WHERE facility_id = p_facility_id AND kind = v_import.kind AND id = v_id;
      ELSE
        UPDATE v2.master_records
        SET code = v_before->>'code',
            name = v_before->>'name',
            product_code = v_before->>'product_code',
            data = v_before->'data',
            source_import_id = NULLIF(v_before->>'source_import_id', '')::uuid,
            updated_at = (v_before->>'updated_at')::timestamptz
        WHERE facility_id = p_facility_id AND kind = v_import.kind AND id = v_id;
      END IF;
    END IF;
  END LOOP;
  v_now := clock_timestamp();
  v_result := jsonb_build_object(
    'outcome', 'undone',
    'importId', p_import_id,
    'kind', v_import.kind,
    'undoneAt', v_now,
    'replayed', false
  );
  UPDATE v2.setup_imports
  SET status = 'undone', result = v_result, undone_at = v_now, undone_by = p_actor_id
  WHERE facility_id = p_facility_id AND id = p_import_id;
  RETURN v_result;
END
$$;

CREATE FUNCTION v2.list_setup_imports(p_facility_id uuid, p_limit integer)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, v2
AS $$
BEGIN
  IF p_facility_id IS NULL OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100
     OR NOT EXISTS (SELECT 1 FROM v2.facility_scope WHERE singleton AND facility_id = p_facility_id) THEN
    RAISE EXCEPTION 'Invalid import list request' USING ERRCODE = '22023';
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', id,
      'kind', kind,
      'status', status,
      'rowCount', jsonb_array_length(records),
      'createdBy', actor_id,
      'appliedBy', applied_by,
      'undoneBy', undone_by,
      'createdAt', created_at,
      'appliedAt', applied_at,
      'undoneAt', undone_at
    ) ORDER BY created_at DESC, id DESC)
    FROM (
      SELECT id, kind, status, records, actor_id, applied_by, undone_by,
        created_at, applied_at, undone_at
      FROM v2.setup_imports
      WHERE facility_id = p_facility_id
      ORDER BY created_at DESC, id DESC
      LIMIT p_limit
    ) recent
  ), '[]'::jsonb);
END
$$;

CREATE FUNCTION v2.get_setup_import(p_facility_id uuid, p_import_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, v2
AS $$
DECLARE
  v_import v2.setup_imports%ROWTYPE;
BEGIN
  IF p_facility_id IS NULL OR p_import_id IS NULL
     OR NOT EXISTS (SELECT 1 FROM v2.facility_scope WHERE singleton AND facility_id = p_facility_id) THEN
    RAISE EXCEPTION 'Invalid import scope' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_import
  FROM v2.setup_imports
  WHERE facility_id = p_facility_id AND id = p_import_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN jsonb_build_object(
    'id', v_import.id,
    'kind', v_import.kind,
    'status', v_import.status,
    'records', v_import.records,
    'createdBy', v_import.actor_id,
    'appliedBy', v_import.applied_by,
    'undoneBy', v_import.undone_by,
    'createdAt', v_import.created_at,
    'appliedAt', v_import.applied_at,
    'undoneAt', v_import.undone_at
  );
END
$$;

CREATE FUNCTION v2.record_inventory_movement(
  p_facility_id uuid,
  p_actor_id uuid,
  p_command_id text,
  p_request_hash text,
  p_warehouse_id uuid,
  p_product_code text,
  p_movement_type text,
  p_quantity numeric,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, v2
AS $$
DECLARE
  v_existing_hash text;
  v_response jsonb;
  v_product v2.products%ROWTYPE;
  v_balance v2.inventory_balances%ROWTYPE;
  v_now timestamptz;
  v_next numeric(20,6);
  v_group_id uuid;
BEGIN
  IF p_facility_id IS NULL OR p_actor_id IS NULL OR p_warehouse_id IS NULL
     OR NOT EXISTS (SELECT 1 FROM v2.facility_scope WHERE singleton AND facility_id = p_facility_id)
     OR p_command_id IS NULL OR length(btrim(p_command_id)) NOT BETWEEN 1 AND 200
     OR p_request_hash IS NULL OR p_request_hash !~ '^[0-9a-f]{64}$'
     OR p_movement_type IS NULL OR p_movement_type NOT IN ('receipt', 'adjustment')
     OR p_quantity IS NULL OR p_quantity = 0 OR abs(p_quantity) >= 100000000000000
     OR (p_movement_type = 'receipt' AND p_quantity <= 0)
     OR p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 3 AND 500 THEN
    RAISE EXCEPTION 'Invalid inventory movement request' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_facility_id::text || ':' || p_actor_id::text || ':' || p_command_id, 0)
  );
  SELECT request_hash, response INTO v_existing_hash, v_response
  FROM v2.command_receipts
  WHERE facility_id = p_facility_id AND actor_id = p_actor_id AND command_id = p_command_id;
  IF FOUND THEN
    IF v_existing_hash <> p_request_hash THEN
      RAISE EXCEPTION 'Command ID was reused with different details' USING ERRCODE = '22023';
    END IF;
    RETURN v_response || jsonb_build_object('replayed', true);
  END IF;
  PERFORM 1 FROM v2.inventory_warehouses
  WHERE facility_id = p_facility_id AND id = p_warehouse_id AND active
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Warehouse not found' USING ERRCODE = 'P0002'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM v2.opening_counts
    WHERE facility_id = p_facility_id AND warehouse_id = p_warehouse_id AND status = 'applied'
  ) THEN RAISE EXCEPTION 'Review and apply an opening count before recording stock' USING ERRCODE = '55000'; END IF;
  SELECT * INTO v_product FROM v2.products
  WHERE facility_id = p_facility_id AND lower(code) = lower(p_product_code) AND active
  FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Product not found' USING ERRCODE = 'P0002'; END IF;
  INSERT INTO v2.inventory_balances (facility_id, warehouse_id, product_id)
  VALUES (p_facility_id, p_warehouse_id, v_product.id)
  ON CONFLICT DO NOTHING;
  SELECT * INTO v_balance FROM v2.inventory_balances
  WHERE facility_id = p_facility_id AND warehouse_id = p_warehouse_id AND product_id = v_product.id
  FOR UPDATE;
  v_next := v_balance.quantity + p_quantity;
  IF v_next < 0 THEN RAISE EXCEPTION 'Insufficient stock for this adjustment' USING ERRCODE = '22003'; END IF;
  IF v_balance.revision = 9007199254740991 THEN RAISE EXCEPTION 'Inventory revision exhausted' USING ERRCODE = '22003'; END IF;
  v_now := clock_timestamp();
  UPDATE v2.inventory_balances
  SET quantity = v_next, revision = revision + 1, updated_at = v_now
  WHERE facility_id = p_facility_id AND warehouse_id = p_warehouse_id AND product_id = v_product.id;
  v_group_id := gen_random_uuid();
  INSERT INTO v2.inventory_movements (
    facility_id, warehouse_id, product_id, movement_group_id, movement_type,
    quantity_delta, reason, actor_id, command_id, occurred_at
  ) VALUES (
    p_facility_id, p_warehouse_id, v_product.id, v_group_id, p_movement_type,
    p_quantity, btrim(p_reason), p_actor_id, p_command_id, v_now
  );
  v_response := jsonb_build_object(
    'outcome', 'accepted',
    'replayed', false,
    'movementId', v_group_id,
    'warehouseId', p_warehouse_id,
    'productCode', v_product.code,
    'quantity', v_next::text,
    'revision', v_balance.revision + 1
  );
  INSERT INTO v2.command_receipts (facility_id, actor_id, command_id, request_hash, response, created_at)
  VALUES (p_facility_id, p_actor_id, p_command_id, p_request_hash, v_response, v_now);
  RETURN v_response;
END
$$;

CREATE FUNCTION v2.transfer_inventory(
  p_facility_id uuid,
  p_actor_id uuid,
  p_command_id text,
  p_request_hash text,
  p_source_warehouse_id uuid,
  p_target_warehouse_id uuid,
  p_product_code text,
  p_quantity numeric,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, v2
AS $$
DECLARE
  v_existing_hash text;
  v_response jsonb;
  v_product v2.products%ROWTYPE;
  v_balance v2.inventory_balances%ROWTYPE;
  v_source_quantity numeric(20,6);
  v_target_quantity numeric(20,6);
  v_source_revision bigint;
  v_target_revision bigint;
  v_now timestamptz;
  v_group_id uuid;
BEGIN
  IF p_facility_id IS NULL OR p_actor_id IS NULL
     OR NOT EXISTS (SELECT 1 FROM v2.facility_scope WHERE singleton AND facility_id = p_facility_id)
     OR p_command_id IS NULL OR length(btrim(p_command_id)) NOT BETWEEN 1 AND 200
     OR p_request_hash IS NULL OR p_request_hash !~ '^[0-9a-f]{64}$'
     OR p_source_warehouse_id IS NULL OR p_target_warehouse_id IS NULL
     OR p_source_warehouse_id = p_target_warehouse_id
     OR p_quantity IS NULL OR p_quantity <= 0 OR p_quantity >= 100000000000000
     OR p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 3 AND 500 THEN
    RAISE EXCEPTION 'Invalid inventory transfer request' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_facility_id::text || ':' || p_actor_id::text || ':' || p_command_id, 0)
  );
  SELECT request_hash, response INTO v_existing_hash, v_response
  FROM v2.command_receipts
  WHERE facility_id = p_facility_id AND actor_id = p_actor_id AND command_id = p_command_id;
  IF FOUND THEN
    IF v_existing_hash <> p_request_hash THEN
      RAISE EXCEPTION 'Command ID was reused with different details' USING ERRCODE = '22023';
    END IF;
    RETURN v_response || jsonb_build_object('replayed', true);
  END IF;
  PERFORM 1 FROM v2.inventory_warehouses
  WHERE facility_id = p_facility_id AND active
    AND id IN (p_source_warehouse_id, p_target_warehouse_id)
  ORDER BY id
  FOR UPDATE;
  IF (SELECT count(*) FROM v2.inventory_warehouses
      WHERE facility_id = p_facility_id AND active
        AND id IN (p_source_warehouse_id, p_target_warehouse_id)) <> 2 THEN
    RAISE EXCEPTION 'Warehouse not found' USING ERRCODE = 'P0002';
  END IF;
  IF (SELECT count(*) FROM v2.opening_counts
      WHERE facility_id = p_facility_id AND status = 'applied'
        AND warehouse_id IN (p_source_warehouse_id, p_target_warehouse_id)) <> 2 THEN
    RAISE EXCEPTION 'Review and apply opening counts in both warehouses before transferring stock' USING ERRCODE = '55000';
  END IF;
  SELECT * INTO v_product FROM v2.products
  WHERE facility_id = p_facility_id AND lower(code) = lower(p_product_code) AND active
  FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Product not found' USING ERRCODE = 'P0002'; END IF;
  INSERT INTO v2.inventory_balances (facility_id, warehouse_id, product_id)
  VALUES
    (p_facility_id, p_source_warehouse_id, v_product.id),
    (p_facility_id, p_target_warehouse_id, v_product.id)
  ON CONFLICT DO NOTHING;
  FOR v_balance IN
    SELECT * FROM v2.inventory_balances
    WHERE facility_id = p_facility_id
      AND product_id = v_product.id
      AND warehouse_id IN (p_source_warehouse_id, p_target_warehouse_id)
    ORDER BY warehouse_id
    FOR UPDATE
  LOOP
    IF v_balance.warehouse_id = p_source_warehouse_id THEN
      v_source_quantity := v_balance.quantity;
      v_source_revision := v_balance.revision;
    ELSE
      v_target_quantity := v_balance.quantity;
      v_target_revision := v_balance.revision;
    END IF;
  END LOOP;
  IF v_source_quantity < p_quantity THEN RAISE EXCEPTION 'Insufficient stock for this transfer' USING ERRCODE = '22003'; END IF;
  IF v_source_revision = 9007199254740991 OR v_target_revision = 9007199254740991 THEN
    RAISE EXCEPTION 'Inventory revision exhausted' USING ERRCODE = '22003';
  END IF;
  v_now := clock_timestamp();
  UPDATE v2.inventory_balances
  SET quantity = quantity - p_quantity, revision = revision + 1, updated_at = v_now
  WHERE facility_id = p_facility_id AND warehouse_id = p_source_warehouse_id AND product_id = v_product.id;
  UPDATE v2.inventory_balances
  SET quantity = quantity + p_quantity, revision = revision + 1, updated_at = v_now
  WHERE facility_id = p_facility_id AND warehouse_id = p_target_warehouse_id AND product_id = v_product.id;
  v_group_id := gen_random_uuid();
  INSERT INTO v2.inventory_movements (
    facility_id, warehouse_id, product_id, movement_group_id, movement_type,
    quantity_delta, reason, actor_id, command_id, occurred_at
  ) VALUES
    (p_facility_id, p_source_warehouse_id, v_product.id, v_group_id, 'transfer_out',
      -p_quantity, btrim(p_reason), p_actor_id, p_command_id, v_now),
    (p_facility_id, p_target_warehouse_id, v_product.id, v_group_id, 'transfer_in',
      p_quantity, btrim(p_reason), p_actor_id, p_command_id, v_now);
  v_response := jsonb_build_object(
    'outcome', 'accepted',
    'replayed', false,
    'transferId', v_group_id,
    'productCode', v_product.code,
    'quantity', p_quantity::text,
    'sourceWarehouseId', p_source_warehouse_id,
    'sourceQuantity', (v_source_quantity - p_quantity)::text,
    'sourceRevision', v_source_revision + 1,
    'targetWarehouseId', p_target_warehouse_id,
    'targetQuantity', (v_target_quantity + p_quantity)::text,
    'targetRevision', v_target_revision + 1
  );
  INSERT INTO v2.command_receipts (facility_id, actor_id, command_id, request_hash, response, created_at)
  VALUES (p_facility_id, p_actor_id, p_command_id, p_request_hash, v_response, v_now);
  RETURN v_response;
END
$$;

CREATE FUNCTION v2.stage_opening_count(
  p_facility_id uuid,
  p_actor_id uuid,
  p_request_id text,
  p_request_hash text,
  p_warehouse_id uuid,
  p_rows jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, v2
AS $$
DECLARE
  v_existing v2.opening_counts%ROWTYPE;
  v_id uuid;
BEGIN
  IF p_facility_id IS NULL OR p_actor_id IS NULL OR p_warehouse_id IS NULL
     OR NOT EXISTS (SELECT 1 FROM v2.facility_scope WHERE singleton AND facility_id = p_facility_id)
     OR p_request_id IS NULL OR length(btrim(p_request_id)) NOT BETWEEN 1 AND 200
     OR p_request_hash IS NULL OR p_request_hash !~ '^[0-9a-f]{64}$'
     OR jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows) NOT BETWEEN 1 AND 2000 THEN
    RAISE EXCEPTION 'Invalid opening count request' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_facility_id::text || ':' || p_actor_id::text || ':' || p_request_id, 0)
  );
  SELECT * INTO v_existing FROM v2.opening_counts
  WHERE facility_id = p_facility_id AND actor_id = p_actor_id AND request_id = p_request_id
  FOR UPDATE;
  IF FOUND THEN
    IF v_existing.request_hash <> p_request_hash
       OR v_existing.warehouse_id <> p_warehouse_id OR v_existing.rows <> p_rows THEN
      RAISE EXCEPTION 'Count request ID was reused with different details' USING ERRCODE = '22023';
    END IF;
    RETURN jsonb_build_object(
      'outcome', v_existing.status,
      'countId', v_existing.id,
      'warehouseId', v_existing.warehouse_id,
      'rowCount', jsonb_array_length(v_existing.rows),
      'replayed', true
    );
  END IF;
  PERFORM 1 FROM v2.facility_scope
  WHERE singleton AND facility_id = p_facility_id
  FOR UPDATE;
  PERFORM 1 FROM v2.inventory_warehouses
  WHERE facility_id = p_facility_id AND id = p_warehouse_id AND active
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Warehouse not found' USING ERRCODE = 'P0002'; END IF;
  IF EXISTS (
    SELECT 1 FROM v2.opening_counts
    WHERE facility_id = p_facility_id AND warehouse_id = p_warehouse_id
      AND status IN ('staged', 'reviewed')
  ) THEN RAISE EXCEPTION 'A physical count is already waiting for review or application' USING ERRCODE = '55000'; END IF;
  IF EXISTS (
    SELECT 1 FROM v2.inventory_movements
    WHERE facility_id = p_facility_id AND warehouse_id = p_warehouse_id
  ) THEN RAISE EXCEPTION 'Opening count is only available before stock movements begin' USING ERRCODE = '55000'; END IF;
  IF EXISTS (
    SELECT 1 FROM v2.opening_counts
    WHERE facility_id = p_facility_id AND warehouse_id = p_warehouse_id AND status = 'applied'
  ) THEN RAISE EXCEPTION 'An opening count was already applied for this warehouse' USING ERRCODE = '55000'; END IF;
  IF (SELECT count(*) FROM v2.products WHERE facility_id = p_facility_id AND active)
     <> jsonb_array_length(p_rows) THEN
    RAISE EXCEPTION 'Count every active product, including zero quantities' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_rows) AS rows(value)
    WHERE jsonb_typeof(rows.value) <> 'object'
       OR jsonb_typeof(rows.value->'productCode') <> 'string'
       OR jsonb_typeof(rows.value->'quantity') <> 'string'
       OR NOT (rows.value->>'quantity') ~ '^(?:0|[1-9][0-9]{0,11})(?:[.][0-9]{1,6})?$'
       OR NOT EXISTS (
         SELECT 1 FROM v2.products p WHERE p.facility_id = p_facility_id
           AND p.active AND lower(p.code) = lower(rows.value->>'productCode')
       )
  ) THEN RAISE EXCEPTION 'Opening count contains an invalid or unknown product quantity' USING ERRCODE = '22023'; END IF;
  IF (
    SELECT count(*) FROM (
      SELECT lower(value->>'productCode')
      FROM jsonb_array_elements(p_rows)
      GROUP BY lower(value->>'productCode')
    ) unique_rows
  ) <> jsonb_array_length(p_rows) THEN
    RAISE EXCEPTION 'Opening count contains duplicate product codes' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM v2.products p
    WHERE p.facility_id = p_facility_id AND p.active
      AND NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(p_rows) AS rows(value)
        WHERE lower(rows.value->>'productCode') = lower(p.code)
      )
  ) THEN RAISE EXCEPTION 'Count every active product, including zero quantities' USING ERRCODE = '22023'; END IF;
  INSERT INTO v2.opening_counts (
    facility_id, warehouse_id, actor_id, request_id, request_hash, rows
  ) VALUES (
    p_facility_id, p_warehouse_id, p_actor_id, p_request_id, p_request_hash, p_rows
  ) RETURNING id INTO v_id;
  RETURN jsonb_build_object(
    'outcome', 'staged',
    'countId', v_id,
    'warehouseId', p_warehouse_id,
    'rowCount', jsonb_array_length(p_rows),
    'replayed', false
  );
END
$$;

CREATE FUNCTION v2.review_opening_count(p_facility_id uuid, p_actor_id uuid, p_count_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, v2
AS $$
DECLARE
  v_count v2.opening_counts%ROWTYPE;
BEGIN
  IF p_facility_id IS NULL OR p_actor_id IS NULL OR p_count_id IS NULL
     OR NOT EXISTS (SELECT 1 FROM v2.facility_scope WHERE singleton AND facility_id = p_facility_id) THEN
    RAISE EXCEPTION 'Invalid count scope' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_count FROM v2.opening_counts
  WHERE facility_id = p_facility_id AND id = p_count_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Opening count not found' USING ERRCODE = 'P0002'; END IF;
  IF v_count.status = 'staged' THEN
    UPDATE v2.opening_counts SET status = 'reviewed', reviewed_by = p_actor_id,
      reviewed_at = clock_timestamp()
    WHERE facility_id = p_facility_id AND id = p_count_id
    RETURNING * INTO v_count;
  END IF;
  RETURN jsonb_build_object(
    'outcome', v_count.status,
    'countId', v_count.id,
    'warehouseId', v_count.warehouse_id,
    'rowCount', jsonb_array_length(v_count.rows),
    'reviewedAt', v_count.reviewed_at,
    'replayed', v_count.status <> 'reviewed' OR v_count.reviewed_by <> p_actor_id
  );
END
$$;

CREATE FUNCTION v2.apply_opening_count(p_facility_id uuid, p_actor_id uuid, p_count_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, v2
AS $$
DECLARE
  v_count v2.opening_counts%ROWTYPE;
  v_row jsonb;
  v_product v2.products%ROWTYPE;
  v_quantity numeric(20,6);
  v_now timestamptz;
  v_group_id uuid;
  v_applied integer := 0;
  v_result jsonb;
BEGIN
  IF p_facility_id IS NULL OR p_actor_id IS NULL OR p_count_id IS NULL
     OR NOT EXISTS (SELECT 1 FROM v2.facility_scope WHERE singleton AND facility_id = p_facility_id) THEN
    RAISE EXCEPTION 'Invalid count scope' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_count FROM v2.opening_counts
  WHERE facility_id = p_facility_id AND id = p_count_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Opening count not found' USING ERRCODE = 'P0002'; END IF;
  IF v_count.status = 'applied' THEN
    RETURN COALESCE(v_count.result, '{}'::jsonb) || jsonb_build_object('replayed', true);
  END IF;
  IF v_count.status <> 'reviewed' THEN
    RAISE EXCEPTION 'Review the opening count before applying it' USING ERRCODE = '55000';
  END IF;
  PERFORM 1 FROM v2.facility_scope
  WHERE singleton AND facility_id = p_facility_id
  FOR UPDATE;
  PERFORM 1 FROM v2.inventory_warehouses
  WHERE facility_id = p_facility_id AND id = v_count.warehouse_id AND active
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Warehouse not found' USING ERRCODE = 'P0002'; END IF;
  IF EXISTS (
    SELECT 1 FROM v2.inventory_movements
    WHERE facility_id = p_facility_id AND warehouse_id = v_count.warehouse_id
  ) THEN RAISE EXCEPTION 'Stock changed after this count was staged' USING ERRCODE = '40001'; END IF;
  IF EXISTS (
    SELECT 1 FROM v2.opening_counts
    WHERE facility_id = p_facility_id AND warehouse_id = v_count.warehouse_id
      AND status = 'applied' AND id <> p_count_id
  ) THEN RAISE EXCEPTION 'An opening count was already applied for this warehouse' USING ERRCODE = '55000'; END IF;
  IF (SELECT count(*) FROM v2.products WHERE facility_id = p_facility_id AND active)
       <> jsonb_array_length(v_count.rows)
     OR EXISTS (
       SELECT 1 FROM v2.products p
       WHERE p.facility_id = p_facility_id AND p.active
         AND NOT EXISTS (
           SELECT 1 FROM jsonb_array_elements(v_count.rows) AS rows(value)
           WHERE lower(rows.value->>'productCode') = lower(p.code)
         )
     ) THEN
    RAISE EXCEPTION 'Products changed after this count was staged; create a fresh count' USING ERRCODE = '40001';
  END IF;
  v_now := clock_timestamp();
  FOR v_row IN SELECT value FROM jsonb_array_elements(v_count.rows) LOOP
    SELECT * INTO v_product FROM v2.products
    WHERE facility_id = p_facility_id AND active
      AND lower(code) = lower(v_row->>'productCode')
    FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'A counted product is no longer active' USING ERRCODE = '40001'; END IF;
    v_quantity := (v_row->>'quantity')::numeric(20,6);
    INSERT INTO v2.inventory_balances (
      facility_id, warehouse_id, product_id, quantity, revision, updated_at
    ) VALUES (
      p_facility_id, v_count.warehouse_id, v_product.id, v_quantity, 1, v_now
    )
    ON CONFLICT (facility_id, warehouse_id, product_id)
    DO UPDATE SET quantity = EXCLUDED.quantity, revision = v2.inventory_balances.revision + 1,
      updated_at = EXCLUDED.updated_at;
    IF v_quantity > 0 THEN
      v_group_id := gen_random_uuid();
      INSERT INTO v2.inventory_movements (
        facility_id, warehouse_id, product_id, movement_group_id, movement_type,
        quantity_delta, reason, actor_id, command_id, occurred_at
      ) VALUES (
        p_facility_id, v_count.warehouse_id, v_product.id, v_group_id, 'opening_count',
        v_quantity, 'Reviewed physical opening count', p_actor_id,
        v_count.request_id, v_now
      );
    END IF;
    v_applied := v_applied + 1;
  END LOOP;
  v_result := jsonb_build_object(
    'outcome', 'applied',
    'countId', p_count_id,
    'warehouseId', v_count.warehouse_id,
    'rowCount', v_applied,
    'appliedAt', v_now,
    'replayed', false
  );
  UPDATE v2.opening_counts
  SET status = 'applied', applied_by = p_actor_id, applied_at = v_now, result = v_result
  WHERE facility_id = p_facility_id AND id = p_count_id;
  RETURN v_result;
END
$$;

CREATE FUNCTION v2.get_opening_count(p_facility_id uuid, p_count_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, v2
AS $$
DECLARE
  v_count v2.opening_counts%ROWTYPE;
BEGIN
  IF p_facility_id IS NULL OR p_count_id IS NULL
     OR NOT EXISTS (SELECT 1 FROM v2.facility_scope WHERE singleton AND facility_id = p_facility_id) THEN
    RAISE EXCEPTION 'Invalid count scope' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_count FROM v2.opening_counts
  WHERE facility_id = p_facility_id AND id = p_count_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN jsonb_build_object(
    'id', v_count.id,
    'warehouseId', v_count.warehouse_id,
    'status', v_count.status,
    'rows', v_count.rows,
    'createdBy', v_count.actor_id,
    'reviewedBy', v_count.reviewed_by,
    'appliedBy', v_count.applied_by,
    'createdAt', v_count.created_at,
    'reviewedAt', v_count.reviewed_at,
    'appliedAt', v_count.applied_at,
    'result', v_count.result
  );
END
$$;

CREATE FUNCTION v2.list_opening_counts(p_facility_id uuid, p_limit integer)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, v2
AS $$
BEGIN
  IF p_facility_id IS NULL OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100
     OR NOT EXISTS (SELECT 1 FROM v2.facility_scope WHERE singleton AND facility_id = p_facility_id) THEN
    RAISE EXCEPTION 'Invalid opening count list request' USING ERRCODE = '42501';
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', c.id,
      'warehouseId', c.warehouse_id,
      'warehouseName', w.name,
      'status', c.status,
      'rowCount', jsonb_array_length(c.rows),
      'createdBy', c.actor_id,
      'reviewedBy', c.reviewed_by,
      'appliedBy', c.applied_by,
      'createdAt', c.created_at,
      'reviewedAt', c.reviewed_at,
      'appliedAt', c.applied_at
    ) ORDER BY c.created_at DESC, c.id DESC)
    FROM (
      SELECT *
      FROM v2.opening_counts
      WHERE facility_id = p_facility_id
      ORDER BY created_at DESC, id DESC
      LIMIT p_limit
    ) c
    JOIN v2.inventory_warehouses w
      ON w.facility_id = c.facility_id AND w.id = c.warehouse_id
  ), '[]'::jsonb);
END
$$;

REVOKE ALL ON ALL TABLES IN SCHEMA v2 FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA v2 FROM PUBLIC;

COMMENT ON TABLE v2.inventory_movements IS
  'Append-only facility-scoped warehouse ledger. On-hand is a transactionally maintained projection; V1 stock/history is never copied.';
COMMENT ON TABLE v2.setup_imports IS
  'V2-only staged product, recipe, and production-setup imports with before/after snapshots for guarded undo.';
COMMENT ON TABLE v2.opening_counts IS
  'Manager-reviewed physical counts; applied opening values create V2 opening ledger movements, never imported V1 balances.';

COMMIT;
