DO $$
DECLARE
  v_facility uuid;
  v_actor uuid := '99000000-0000-4000-8000-000000000006';
  v_product_import uuid;
  v_recipe_import uuid;
  v_setup_import uuid;
  v_revision_import uuid;
  v_warehouse uuid;
  v_count uuid;
  v_run uuid;
  v_second_run uuid;
  v_result jsonb;
  v_replay jsonb;
  v_stock numeric;
  v_movement_count integer;
  v_flour_line jsonb;
  v_box_line jsonb;
BEGIN
  SELECT facility_id INTO v_facility FROM v2.facility_scope WHERE singleton;
  IF v_facility IS NULL THEN
    RAISE EXCEPTION 'Expected an isolated facility scope for V2 inventory linkage tests';
  END IF;

  v_product_import := (v2.stage_setup_import(
    v_facility, v_actor, 'r6-products', repeat('1', 64), 'products',
    '[
      {"code":"R6-PIZZA","name":"Run inventory test pizza","unit":"case"},
      {"code":"R6-FLOUR","name":"Run inventory test flour","unit":"lb"},
      {"code":"R6-BOX","name":"Run inventory test carton","unit":"each"}
    ]'::jsonb
  )->>'importId')::uuid;
  PERFORM v2.apply_setup_import(v_facility, v_actor, v_product_import);

  v_recipe_import := (v2.stage_setup_import(
    v_facility, v_actor, 'r6-recipe', repeat('2', 64), 'recipes',
    '[{
      "code":"R6-DOUGH",
      "name":"Run inventory test dough",
      "productCode":"R6-PIZZA",
      "data":{
        "station_key":"dough",
        "ingredients":[{"product_code":"R6-FLOUR","quantity":10,"unit":"lb"}]
      }
    }]'::jsonb
  )->>'importId')::uuid;
  PERFORM v2.apply_setup_import(v_facility, v_actor, v_recipe_import);

  v_setup_import := (v2.stage_setup_import(
    v_facility, v_actor, 'r6-setup', repeat('3', 64), 'production-setups',
    '[{
      "code":"R6-LINE",
      "name":"Run inventory test line",
      "productCode":"R6-PIZZA",
      "data":{
        "recipe_codes":["R6-DOUGH"],
        "packaging_per_case":[{"product_code":"R6-BOX","quantity":2,"unit":"each"}]
      }
    }]'::jsonb
  )->>'importId')::uuid;
  PERFORM v2.apply_setup_import(v_facility, v_actor, v_setup_import);

  v_warehouse := (v2.create_inventory_warehouse(
    v_facility, v_actor, 'r6-warehouse', repeat('4', 64), 'Run inventory production'
  )->'warehouse'->>'id')::uuid;
  v_count := (v2.stage_opening_count(
    v_facility, v_actor, 'r6-opening-count', repeat('5', 64), v_warehouse,
    (
      SELECT jsonb_agg(jsonb_build_object(
        'productCode', p.code,
        'quantity', CASE p.code
          WHEN 'R6-FLOUR' THEN '100'
          WHEN 'R6-BOX' THEN '5'
          ELSE '0'
        END
      ) ORDER BY p.code)
      FROM v2.products AS p
      WHERE p.facility_id = v_facility AND p.active
    )
  )->>'countId')::uuid;
  PERFORM v2.review_opening_count(v_facility, v_actor, v_count);
  PERFORM v2.apply_opening_count(v_facility, v_actor, v_count);

  PERFORM v2.set_production_warehouse(
    v_facility, v_actor, 'r6-set-production-warehouse', repeat('6', 64), v_warehouse
  );
  IF NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(v2.list_inventory_warehouses(v_facility)) AS item(value)
    WHERE (item.value->>'id')::uuid = v_warehouse
      AND item.value->>'isProduction' = 'true'
      AND item.value->>'openingCountApplied' = 'true'
  ) THEN
    RAISE EXCEPTION 'A counted warehouse could not be designated for production';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM jsonb_array_elements(v2.list_run_products(v_facility)->'products') AS item(value)
    CROSS JOIN LATERAL jsonb_array_elements(item.value->'productionSetups') AS setup(value)
    WHERE item.value->>'code' = 'R6-PIZZA'
      AND setup.value->>'code' = 'R6-LINE'
  ) THEN
    RAISE EXCEPTION 'Run setup catalog did not expose the linked production setup';
  END IF;

  v_run := ((v2.create_planned_run(
    v_facility, v_actor, 'r6-create-run', repeat('7', 64),
    '{"label":"Snapshot test","targetCases":10,"productCode":"R6-PIZZA","productionSetupCode":"R6-LINE"}'::jsonb
  )->'run'->>'id')::uuid);
  IF (SELECT setup_snapshot->'productionPlan'->'recipes'->0->'ingredients'->0->>'quantity'
      FROM v2.runs WHERE facility_id = v_facility AND id = v_run) <> '10' THEN
    RAISE EXCEPTION 'Run did not retain the imported recipe snapshot';
  END IF;

  v_revision_import := (v2.stage_setup_import(
    v_facility, v_actor, 'r6-recipe-revision', repeat('8', 64), 'recipes',
    '[{
      "code":"R6-DOUGH",
      "name":"Updated run inventory test dough",
      "productCode":"R6-PIZZA",
      "data":{
        "station_key":"dough",
        "ingredients":[{"product_code":"R6-FLOUR","quantity":99,"unit":"lb"}]
      }
    }]'::jsonb
  )->>'importId')::uuid;
  PERFORM v2.apply_setup_import(v_facility, v_actor, v_revision_import);

  INSERT INTO v2.run_station_progress (
    facility_id, run_id, station_key, status, progress, updated_at
  ) VALUES
    (v_facility, v_run, 'dough', 'not_started', '{"batchesMade":3}'::jsonb, clock_timestamp()),
    (v_facility, v_run, 'packaging', 'not_started', '{"casesPacked":2}'::jsonb, clock_timestamp());

  PERFORM v2.apply_run_lifecycle_command(
    v_facility, v_run, v_actor, 'r6-start-run', repeat('9', 64), 'start', 0
  );
  v_result := v2.complete_run_with_inventory(
    v_facility, v_run, v_actor, 'r6-complete-run', repeat('a', 64), 'complete', 1
  );
  SELECT value INTO v_flour_line
    FROM jsonb_array_elements(v_result->'run'->'inventoryConsumption'->'lines')
    WHERE value->>'productCode' = 'R6-FLOUR';
  SELECT value INTO v_box_line
    FROM jsonb_array_elements(v_result->'run'->'inventoryConsumption'->'lines')
    WHERE value->>'productCode' = 'R6-BOX';
  IF v_result->>'outcome' <> 'accepted'
     OR v_result->'run'->>'status' <> 'completed'
     OR v_result->'run'->'inventoryConsumption'->>'status' <> 'completed'
     OR (v_flour_line->>'required')::numeric <> 30
     OR (v_flour_line->>'deducted')::numeric <> 30
     OR (v_box_line->>'required')::numeric <> 4
     OR (v_box_line->>'deducted')::numeric <> 4 THEN
    RAISE EXCEPTION 'Run completion did not calculate exact per-batch and per-case usage: %', v_result;
  END IF;
  SELECT b.quantity INTO v_stock
    FROM v2.inventory_balances AS b
    JOIN v2.products AS p ON p.facility_id = b.facility_id AND p.id = b.product_id
    WHERE b.facility_id = v_facility AND b.warehouse_id = v_warehouse AND p.code = 'R6-FLOUR';
  IF v_stock <> 70 THEN
    RAISE EXCEPTION 'Run completion did not deduct flour from the production warehouse';
  END IF;
  SELECT count(*) INTO v_movement_count
    FROM v2.inventory_movements WHERE facility_id = v_facility AND run_id = v_run;
  IF v_movement_count <> 2 THEN
    RAISE EXCEPTION 'Expected exactly one movement for each consumed stock product, got %', v_movement_count;
  END IF;

  v_replay := v2.complete_run_with_inventory(
    v_facility, v_run, v_actor, 'r6-complete-run', repeat('a', 64), 'complete', 1
  );
  SELECT count(*) INTO v_movement_count
    FROM v2.inventory_movements WHERE facility_id = v_facility AND run_id = v_run;
  IF v_replay->>'replayed' <> 'true' OR v_movement_count <> 2 THEN
    RAISE EXCEPTION 'Retrying completion duplicated inventory movements';
  END IF;

  PERFORM v2.record_inventory_movement(
    v_facility, v_actor, 'r6-zero-flour', repeat('b', 64), v_warehouse,
    'R6-FLOUR', 'adjustment', -70, 'Test stock cleared'
  );
  PERFORM v2.record_inventory_movement(
    v_facility, v_actor, 'r6-zero-box', repeat('c', 64), v_warehouse,
    'R6-BOX', 'adjustment', -1, 'Test stock cleared'
  );
  v_second_run := ((v2.create_planned_run(
    v_facility, v_actor, 'r6-create-short-run', repeat('d', 64),
    '{"label":"Short stock test","targetCases":10,"productCode":"R6-PIZZA","productionSetupCode":"R6-LINE"}'::jsonb
  )->'run'->>'id')::uuid);
  INSERT INTO v2.run_station_progress (
    facility_id, run_id, station_key, status, progress, updated_at
  ) VALUES
    (v_facility, v_second_run, 'dough', 'not_started', '{"batchesMade":3}'::jsonb, clock_timestamp()),
    (v_facility, v_second_run, 'packaging', 'not_started', '{"casesPacked":2}'::jsonb, clock_timestamp());
  PERFORM v2.apply_run_lifecycle_command(
    v_facility, v_second_run, v_actor, 'r6-start-short-run', repeat('e', 64), 'start', 0
  );
  v_result := v2.complete_run_with_inventory(
    v_facility, v_second_run, v_actor, 'r6-complete-short-run', repeat('f', 64), 'complete', 1
  );
  SELECT value INTO v_flour_line
    FROM jsonb_array_elements(v_result->'run'->'inventoryConsumption'->'lines')
    WHERE value->>'productCode' = 'R6-FLOUR';
  SELECT value INTO v_box_line
    FROM jsonb_array_elements(v_result->'run'->'inventoryConsumption'->'lines')
    WHERE value->>'productCode' = 'R6-BOX';
  IF v_result->'run'->>'status' <> 'completed'
     OR (v_flour_line->>'deducted')::numeric <> 0
     OR (v_flour_line->>'shortfall')::numeric <> 297
     OR (v_box_line->>'deducted')::numeric <> 0
     OR (v_box_line->>'shortfall')::numeric <> 4 THEN
    RAISE EXCEPTION 'Short stock should be recorded without blocking run completion: %', v_result;
  END IF;
  IF EXISTS (
    SELECT 1 FROM v2.inventory_balances AS b
    WHERE b.facility_id = v_facility AND b.warehouse_id = v_warehouse AND b.quantity < 0
  ) THEN
    RAISE EXCEPTION 'Run consumption made inventory negative';
  END IF;

  RAISE NOTICE 'V2 run-to-inventory linkage checks passed';
END
$$;
