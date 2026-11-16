BEGIN;

DO $$
DECLARE
  v_facility uuid;
  v_other_facility uuid := '99000000-0000-4000-8000-000000000001';
  v_actor uuid := '99000000-0000-4000-8000-000000000002';
  v_product_import uuid;
  v_recipe_import uuid;
  v_product_id uuid;
  v_main uuid;
  v_prep uuid;
  v_opening uuid;
  v_count_id uuid;
  v_result jsonb;
  v_cursor jsonb;
  v_failed boolean;
  v_quantity numeric;
BEGIN
  SELECT facility_id INTO STRICT v_facility FROM v2.facility_scope WHERE singleton;

  v_result := v2.stage_setup_import(
    v_facility, v_actor, 'inventory-products-1', repeat('a', 64), 'products',
    '[{"code":"FLOUR","name":"Bread Flour","unit":"lb"}]'::jsonb
  );
  v_product_import := (v_result->>'importId')::uuid;
  IF v_result->>'outcome' <> 'staged' OR v_result->>'replayed' <> 'false' THEN
    RAISE EXCEPTION 'Product import did not stage';
  END IF;
  v_result := v2.apply_setup_import(v_facility, v_actor, v_product_import);
  IF v_result->>'outcome' <> 'applied' OR v_result->>'replayed' <> 'false' THEN
    RAISE EXCEPTION 'Product import did not apply';
  END IF;
  v_result := v2.apply_setup_import(v_facility, v_actor, v_product_import);
  IF v_result->>'replayed' <> 'true' THEN RAISE EXCEPTION 'Product apply was not idempotent'; END IF;
  SELECT id INTO STRICT v_product_id FROM v2.products
  WHERE facility_id = v_facility AND code = 'FLOUR';

  v_result := v2.stage_setup_import(
    v_facility, v_actor, 'inventory-recipe-1', repeat('b', 64), 'recipes',
    '[{"code":"DOUGH","name":"Basic Dough","productCode":"FLOUR","data":{"hydration":0.62}}]'::jsonb
  );
  v_recipe_import := (v_result->>'importId')::uuid;
  PERFORM v2.apply_setup_import(v_facility, v_actor, v_recipe_import);
  v_result := v2.undo_setup_import(v_facility, v_actor, v_recipe_import);
  IF v_result->>'outcome' <> 'undone' OR EXISTS (
    SELECT 1 FROM v2.master_records
    WHERE facility_id = v_facility AND kind = 'recipes' AND code = 'DOUGH'
  ) THEN RAISE EXCEPTION 'Recipe import undo did not restore the prior state'; END IF;
  v_result := v2.undo_setup_import(v_facility, v_actor, v_recipe_import);
  IF v_result->>'replayed' <> 'true' THEN RAISE EXCEPTION 'Undo replay was not idempotent'; END IF;

  v_result := v2.create_inventory_warehouse(
    v_facility, v_actor, 'warehouse-main', repeat('c', 64), 'Main'
  );
  v_main := (v_result->'warehouse'->>'id')::uuid;
  v_result := v2.create_inventory_warehouse(
    v_facility, v_actor, 'warehouse-prep', repeat('d', 64), 'Prep'
  );
  v_prep := (v_result->'warehouse'->>'id')::uuid;
  v_result := v2.create_inventory_warehouse(
    v_facility, v_actor, 'warehouse-opening', repeat('e', 64), 'Opening'
  );
  v_opening := (v_result->'warehouse'->>'id')::uuid;
  v_result := v2.create_inventory_warehouse(
    v_facility, v_actor, 'warehouse-main', repeat('c', 64), 'Main'
  );
  IF v_result->>'replayed' <> 'true' THEN RAISE EXCEPTION 'Warehouse create replay was not idempotent'; END IF;

  v_failed := false;
  BEGIN
    PERFORM v2.record_inventory_movement(
      v_facility, v_actor, 'before-count', repeat('f', 64), v_opening, 'FLOUR',
      'receipt', 1, 'Must count first'
    );
  EXCEPTION WHEN SQLSTATE '55000' THEN v_failed := true;
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'Stock movement was accepted before opening count'; END IF;

  v_result := v2.stage_opening_count(
    v_facility, v_actor, 'opening-main-zero', repeat('6', 64), v_main,
    '[{"productCode":"FLOUR","quantity":"0"}]'::jsonb
  );
  v_count_id := (v_result->>'countId')::uuid;
  PERFORM v2.review_opening_count(v_facility, v_actor, v_count_id);
  PERFORM v2.apply_opening_count(v_facility, v_actor, v_count_id);
  v_result := v2.stage_opening_count(
    v_facility, v_actor, 'opening-prep-zero', repeat('7', 64), v_prep,
    '[{"productCode":"FLOUR","quantity":"0"}]'::jsonb
  );
  v_count_id := (v_result->>'countId')::uuid;
  PERFORM v2.review_opening_count(v_facility, v_actor, v_count_id);
  PERFORM v2.apply_opening_count(v_facility, v_actor, v_count_id);

  v_result := v2.record_inventory_movement(
    v_facility, v_actor, 'receipt-main', repeat('1', 64), v_main, 'FLOUR',
    'receipt', 10.5, 'Received delivery'
  );
  IF v_result->>'quantity' <> '10.500000' THEN RAISE EXCEPTION 'Unexpected receipt total: %', v_result; END IF;
  v_result := v2.record_inventory_movement(
    v_facility, v_actor, 'receipt-main', repeat('1', 64), v_main, 'FLOUR',
    'receipt', 10.5, 'Received delivery'
  );
  IF v_result->>'replayed' <> 'true' THEN RAISE EXCEPTION 'Receipt replay was not idempotent'; END IF;
  v_result := v2.transfer_inventory(
    v_facility, v_actor, 'transfer-main-prep', repeat('2', 64), v_main, v_prep,
    'FLOUR', 3, 'Move stock to prep'
  );
  IF v_result->>'sourceQuantity' <> '7.500000' OR v_result->>'targetQuantity' <> '3.000000' THEN
    RAISE EXCEPTION 'Transfer did not update both warehouses: %', v_result;
  END IF;
  PERFORM v2.record_inventory_movement(
    v_facility, v_actor, 'adjust-main', repeat('3', 64), v_main, 'FLOUR',
    'adjustment', -1, 'Damaged bag'
  );
  v_result := v2.list_inventory_movements(v_facility, v_main, 2, NULL, NULL);
  IF jsonb_array_length(v_result->'items') <> 2 OR v_result->'nextCursor' = 'null'::jsonb
    OR (v_result->'items'->0->>'actorId') <> v_actor::text THEN
    RAISE EXCEPTION 'Movement history did not return a bounded audited page';
  END IF;
  v_cursor := v_result->'nextCursor';
  v_result := v2.list_inventory_movements(
    v_facility, v_main, 2, (v_cursor->>'occurredAt')::timestamptz, (v_cursor->>'id')::uuid
  );
  IF jsonb_array_length(v_result->'items') <> 1 OR v_result->'nextCursor' <> 'null'::jsonb
    OR EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_result->'items') AS page(value)
      WHERE page.value->>'id' = v_cursor->>'id'
    ) THEN
    RAISE EXCEPTION 'Movement history cursor skipped, duplicated, or misreported ledger rows';
  END IF;
  v_failed := false;
  BEGIN
    PERFORM v2.record_inventory_movement(
      v_facility, v_actor, 'overspend-main', repeat('4', 64), v_main, 'FLOUR',
      'adjustment', -100, 'Incorrect count'
    );
  EXCEPTION WHEN SQLSTATE '22003' THEN v_failed := true;
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'Negative inventory was accepted'; END IF;

  v_result := v2.stage_opening_count(
    v_facility, v_actor, 'opening-count-1', repeat('5', 64), v_opening,
    '[{"productCode":"FLOUR","quantity":"4.25"}]'::jsonb
  );
  v_count_id := (v_result->>'countId')::uuid;
  v_result := v2.list_opening_counts(v_facility, 50);
  IF NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_result) AS item(value)
    WHERE item.value->>'id' = v_count_id::text
      AND item.value->>'status' = 'staged'
      AND item.value->>'createdBy' = v_actor::text
  ) THEN RAISE EXCEPTION 'Staged count was not discoverable in opening-count history'; END IF;
  v_failed := false;
  BEGIN
    PERFORM v2.stage_opening_count(
      v_facility, v_actor, 'opening-count-duplicate', repeat('9', 64), v_opening,
      '[{"productCode":"FLOUR","quantity":"4.25"}]'::jsonb
    );
  EXCEPTION WHEN SQLSTATE '55000' THEN v_failed := true;
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'A second pending opening count was accepted for one warehouse'; END IF;
  v_failed := false;
  BEGIN
    v_result := v2.apply_opening_count(v_facility, v_actor, v_count_id);
  EXCEPTION WHEN SQLSTATE '55000' THEN v_failed := true;
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'An unreviewed opening count was applied'; END IF;
  v_result := v2.review_opening_count(v_facility, v_actor, v_count_id);
  IF v_result->>'outcome' <> 'reviewed' THEN RAISE EXCEPTION 'Count review was not recorded'; END IF;
  v_result := v2.apply_opening_count(v_facility, v_actor, v_count_id);
  IF v_result->>'outcome' <> 'applied' OR v_result->>'rowCount' <> '1' THEN
    RAISE EXCEPTION 'Reviewed count did not apply: %', v_result;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM v2.opening_counts
    WHERE facility_id = v_facility AND id = v_count_id AND applied_by = v_actor
  ) THEN RAISE EXCEPTION 'Opening count applier was not retained'; END IF;
  v_result := v2.get_opening_count(v_facility, v_count_id);
  IF v_result->>'status' <> 'applied' OR v_result->>'appliedBy' <> v_actor::text THEN
    RAISE EXCEPTION 'Opening count detail omitted its audit identity';
  END IF;
  v_result := v2.apply_opening_count(v_facility, v_actor, v_count_id);
  IF v_result->>'replayed' <> 'true' THEN RAISE EXCEPTION 'Opening count replay was not idempotent'; END IF;

  SELECT quantity INTO STRICT v_quantity FROM v2.inventory_balances
  WHERE facility_id = v_facility AND warehouse_id = v_opening AND product_id = v_product_id;
  IF v_quantity <> 4.25 THEN RAISE EXCEPTION 'Opening count quantity was not persisted'; END IF;
  IF EXISTS (
    SELECT 1 FROM v2.inventory_balances b
    WHERE b.facility_id = v_facility
      AND b.quantity <> COALESCE((
        SELECT sum(m.quantity_delta)
        FROM v2.inventory_movements m
        WHERE m.facility_id = b.facility_id
          AND m.warehouse_id = b.warehouse_id
          AND m.product_id = b.product_id
      ), 0)
  ) THEN RAISE EXCEPTION 'Inventory balances do not reconcile to the movement ledger'; END IF;

  v_failed := false;
  BEGIN
    PERFORM v2.list_inventory_stock(v_other_facility, v_main);
  EXCEPTION WHEN SQLSTATE '42501' THEN v_failed := true;
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'Cross-facility inventory access was accepted'; END IF;

  v_failed := false;
  BEGIN
    PERFORM v2.undo_setup_import(v_facility, v_actor, v_product_import);
  EXCEPTION WHEN SQLSTATE '40001' THEN v_failed := true;
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'Undo deleted a product referenced by stock movements'; END IF;

  v_failed := false;
  BEGIN
    DELETE FROM v2.inventory_movements
    WHERE facility_id = v_facility AND product_id = v_product_id;
  EXCEPTION WHEN SQLSTATE '55000' THEN v_failed := true;
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'Inventory movement ledger allowed deletion'; END IF;
END
$$;

ROLLBACK;

SELECT 'V2 import and inventory database checks passed.';
