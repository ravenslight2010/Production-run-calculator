BEGIN;

DO $$
DECLARE
  v_facility uuid;
  v_actor uuid := '99500000-0000-4000-8000-000000000002';
  v_capacity jsonb;
  v_links jsonb;
  v_run_result jsonb;
  v_run_id uuid;
  v_run jsonb;
  v_failed boolean;
BEGIN
  SELECT facility_id INTO STRICT v_facility FROM v2.facility_scope WHERE singleton;

  INSERT INTO v2.products (facility_id, code, name, base_unit, active)
  VALUES (v_facility, 'DOUGH-SYNTH', 'Synthetic Dough Product', 'case', true);

  v_capacity := v2.dough_capacity_snapshot(v_facility, 'DOUGH-SYNTH');
  IF v_capacity->>'status' <> 'unavailable'
    OR NOT (v_capacity->'reasons' @> '["dough_source_missing"]'::jsonb)
    OR NOT (v_capacity->'reasons' @> '["shipping_source_missing"]'::jsonb) THEN
    RAISE EXCEPTION 'Missing workbook inputs were not explicit: %', v_capacity;
  END IF;

  INSERT INTO v2.master_records (facility_id, kind, code, name, product_code, data)
  VALUES (
    v_facility, 'recipes', 'DOUGH-SYNTH-ROW', 'Synthetic Dough Product',
    'DOUGH-SYNTH',
    jsonb_build_object(
      'sourceFamily', 'dough-procedure',
      'sourceKey', repeat('c', 64),
      'doughballYield', 645.19
    )
  );
  v_links := v2.list_workbook_source_links(v_facility, 'dough-procedure');
  IF NOT (v_links @> jsonb_build_array(jsonb_build_object(
    'sourceKey', repeat('c', 64),
    'productCode', 'DOUGH-SYNTH'
  ))) THEN
    RAISE EXCEPTION 'A confirmed workbook link was not retained by stable product code: %', v_links;
  END IF;
  v_capacity := v2.dough_capacity_snapshot(v_facility, 'DOUGH-SYNTH');
  IF v_capacity->>'status' <> 'unavailable'
    OR NOT (v_capacity->'reasons' @> '["shipping_source_missing"]'::jsonb) THEN
    RAISE EXCEPTION 'A missing case size was guessed: %', v_capacity;
  END IF;

  INSERT INTO v2.master_records (facility_id, kind, code, name, product_code, data)
  VALUES (
    v_facility, 'production-setups', 'SHIP-SYNTH-ROW', 'Synthetic Dough Product',
    'DOUGH-SYNTH',
    '{"sourceFamily":"shipping-guide","pizzasPerCase":12}'::jsonb
  );
  v_capacity := v2.dough_capacity_snapshot(v_facility, 'DOUGH-SYNTH');
  IF v_capacity->>'status' <> 'available'
    OR (v_capacity->>'doughballYield')::numeric <> 645.19
    OR (v_capacity->>'pizzasPerCase')::integer <> 12
    OR round((v_capacity->>'doughballYield')::numeric / (v_capacity->>'pizzasPerCase')::numeric, 4) <> 53.7658 THEN
    RAISE EXCEPTION 'Canonical capacity was not derived with four-decimal precision: %', v_capacity;
  END IF;

  v_run_result := v2.create_planned_run(
    v_facility, v_actor, 'dough-capacity-run', repeat('a', 64),
    '{"label":"Capacity regression","targetCases":54,"productCode":"DOUGH-SYNTH"}'::jsonb
  );
  v_run_id := (v_run_result->'run'->>'id')::uuid;
  v_run := v2.get_run(v_facility, v_run_id);
  IF v_run->'doughCapacity'->>'status' <> 'available'
    OR v_run->'setupSnapshot'->>'productCode' <> 'DOUGH-SYNTH' THEN
    RAISE EXCEPTION 'New run did not select product and expose source values: %', v_run;
  END IF;

  UPDATE v2.master_records
  SET data = jsonb_set(data, '{doughballYield}', '648'::jsonb)
  WHERE facility_id = v_facility AND kind = 'recipes' AND code = 'DOUGH-SYNTH-ROW';
  v_run := v2.get_run(v_facility, v_run_id);
  IF (v_run->'doughCapacity'->>'doughballYield')::numeric <> 648
    OR round((v_run->'doughCapacity'->>'doughballYield')::numeric
      / (v_run->'doughCapacity'->>'pizzasPerCase')::numeric, 4) <> 54 THEN
    RAISE EXCEPTION 'Run capacity did not follow the latest canonical source: %', v_run->'doughCapacity';
  END IF;

  UPDATE v2.master_records
  SET data = jsonb_set(data, '{pizzasPerCase}', 'null'::jsonb)
  WHERE facility_id = v_facility AND kind = 'production-setups' AND code = 'SHIP-SYNTH-ROW';
  v_capacity := v2.dough_capacity_snapshot(v_facility, 'DOUGH-SYNTH');
  IF v_capacity->>'status' <> 'unavailable'
    OR NOT (v_capacity->'reasons' @> '["pizzas_per_case_invalid"]'::jsonb)
    OR v_capacity->'pizzasPerCase' <> 'null'::jsonb THEN
    RAISE EXCEPTION 'An invalid shipping value was guessed: %', v_capacity;
  END IF;
  UPDATE v2.master_records
  SET data = jsonb_set(data, '{pizzasPerCase}', '12'::jsonb)
  WHERE facility_id = v_facility AND kind = 'production-setups' AND code = 'SHIP-SYNTH-ROW';

  INSERT INTO v2.master_records (facility_id, kind, code, name, product_code, data)
  VALUES (
    v_facility, 'production-setups', 'SHIP-SYNTH-DUPLICATE', 'Synthetic Dough Product',
    'DOUGH-SYNTH',
    '{"sourceFamily":"shipping-guide","pizzasPerCase":24}'::jsonb
  );
  v_capacity := v2.dough_capacity_snapshot(v_facility, 'DOUGH-SYNTH');
  IF v_capacity->>'status' <> 'unavailable'
    OR NOT (v_capacity->'reasons' @> '["shipping_source_ambiguous"]'::jsonb)
    OR v_capacity->'pizzasPerCase' <> 'null'::jsonb THEN
    RAISE EXCEPTION 'Ambiguous shipping rows produced a case size: %', v_capacity;
  END IF;

  INSERT INTO v2.master_records (facility_id, kind, code, name, product_code, data)
  VALUES (
    v_facility, 'recipes', 'DOUGH-SYNTH-DUPLICATE', 'Synthetic Dough Product',
    'DOUGH-SYNTH',
    '{"sourceFamily":"dough-procedure","doughballYield":700}'::jsonb
  );
  v_capacity := v2.dough_capacity_snapshot(v_facility, 'DOUGH-SYNTH');
  IF v_capacity->>'status' <> 'unavailable'
    OR NOT (v_capacity->'reasons' @> '["dough_source_ambiguous"]'::jsonb)
    OR v_capacity->'doughballYield' <> 'null'::jsonb THEN
    RAISE EXCEPTION 'Ambiguous dough rows produced a capacity: %', v_capacity;
  END IF;

  v_capacity := v2.dough_capacity_snapshot(v_facility, 'NO-SUCH-PRODUCT');
  IF v_capacity->>'status' <> 'unavailable'
    OR NOT (v_capacity->'reasons' @> '["product_not_selected"]'::jsonb) THEN
    RAISE EXCEPTION 'Missing product selection was not explicit: %', v_capacity;
  END IF;

  v_failed := false;
  BEGIN
    PERFORM v2.create_planned_run(
      v_facility, v_actor, 'dough-capacity-no-product', repeat('b', 64),
      '{"label":"Missing product","targetCases":1}'::jsonb
    );
  EXCEPTION WHEN SQLSTATE '22023' THEN v_failed := true;
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'A new run was created without an imported product'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(v2.list_run_products(v_facility)) AS item(value)
    WHERE item.value->>'code' = 'DOUGH-SYNTH'
      AND item.value->'doughCapacity'->>'status' = 'unavailable'
  ) THEN
    RAISE EXCEPTION 'Run product list did not include current source status';
  END IF;
END
$$;

ROLLBACK;

SELECT 'V2 dough capacity source checks passed.';
