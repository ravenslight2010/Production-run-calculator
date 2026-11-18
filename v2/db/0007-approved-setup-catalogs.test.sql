BEGIN;

DO $$
DECLARE
  v_facility uuid;
  v_other uuid := '99000000-0000-4000-8000-000000000099';
  v_actor uuid := '99000000-0000-4000-8000-000000000098';
  v_result jsonb;
  v_import uuid;
  v_ingredient_import uuid;
  v_update uuid;
  v_rollback uuid;
  v_die_import uuid;
  v_default_import uuid;
  v_pull_import uuid;
  v_flavor_list_import uuid;
  v_source_import uuid;
  v_source_update uuid;
  v_source_summary jsonb;
  v_failed boolean;
  v_count integer;
BEGIN
  SELECT facility_id INTO STRICT v_facility FROM v2.facility_scope WHERE singleton;

  v_result := v2.stage_setup_catalog_import(
    v_facility, v_actor, 'catalog-ingredient-1', repeat('a', 64), 'ingredients',
    '[{"code":"ING-BASE","name":"Base Flour","data":{"categories":["dough"],"allergens":[],"allergensReviewed":true,"mergedIntoCode":null,"enabled":true}}]'::jsonb
  );
  v_import := (v_result->>'importId')::uuid;
  v_ingredient_import := v_import;
  PERFORM v2.apply_setup_catalog_import(v_facility, v_actor, v_import);
  v_result := v2.apply_setup_catalog_import(v_facility, v_actor, v_import);
  IF v_result->>'replayed' <> 'true' THEN RAISE EXCEPTION 'Catalog apply retry was not idempotent'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM v2.setup_ingredient_records
    WHERE facility_id = v_facility AND code = 'ING-BASE'
      AND data->'allergens' = '[]'::jsonb AND data->>'allergensReviewed' = 'true'
  ) THEN RAISE EXCEPTION 'Ingredient identity or reviewed-empty allergen fact was not preserved'; END IF;

  v_result := v2.stage_setup_catalog_import(
    v_facility, v_actor, 'catalog-ingredient-1', repeat('a', 64), 'ingredients',
    '[{"code":"ING-BASE","name":"Base Flour","data":{"categories":["dough"],"allergens":[],"allergensReviewed":true,"mergedIntoCode":null,"enabled":true}}]'::jsonb
  );
  IF v_result->>'replayed' <> 'true' THEN RAISE EXCEPTION 'Catalog stage retry was not idempotent'; END IF;

  v_result := v2.stage_setup_catalog_import(
    v_facility, v_actor, 'catalog-mix-1', repeat('b', 64), 'mixes',
    '[{"code":"MIX-BASE","name":"Base Mix","data":{"brand":"Example","flavor":"Plain","batchSizeLbs":25,"daysEarly":2,"notes":"","isPrep":false,"enabled":true,"components":[{"ingredientName":"Base Flour","ingredientCode":"ING-BASE","perPizzaOz":0.5,"perBatchLbs":25},{"ingredientName":"Unresolved Spice","ingredientCode":null,"perPizzaOz":0.1,"perBatchLbs":null}]}}]'::jsonb
  );
  v_import := (v_result->>'importId')::uuid;
  PERFORM v2.apply_setup_catalog_import(v_facility, v_actor, v_import);
  IF NOT EXISTS (
    SELECT 1 FROM v2.setup_mix_records
    WHERE facility_id = v_facility AND code = 'MIX-BASE'
      AND data->'components'->0->>'ingredientCode' = 'ING-BASE'
      AND data->'components'->1->>'ingredientName' = 'Unresolved Spice'
      AND data->'components'->1->'ingredientCode' = 'null'::jsonb
      AND data->>'batchSizeLbs' = '25'
  ) THEN RAISE EXCEPTION 'Mix ingredient links, unresolved names, or pound units were not preserved'; END IF;
  IF (SELECT count(*) FROM v2.setup_mix_component_links
      WHERE facility_id = v_facility AND mix_code = 'MIX-BASE'
        AND ingredient_code = 'ING-BASE') <> 1 THEN
    RAISE EXCEPTION 'Resolved mix ingredient reference was not stored as a facility-scoped link';
  END IF;
  v_failed := false;
  BEGIN
    PERFORM v2.undo_setup_catalog_import(v_facility, v_actor, v_ingredient_import);
  EXCEPTION WHEN SQLSTATE '40001' THEN v_failed := true;
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'Undo removed an ingredient referenced by a mix'; END IF;

  v_result := v2.stage_setup_catalog_import(
    v_facility, v_actor, 'catalog-pull-1', repeat('f', 64), 'freezer-pull-items',
    '[{"code":"PULL-BASE","name":"Base Flour","data":{"ingredientName":"Base Flour","ingredientCode":"ING-BASE","daysEarly":2,"enabled":true}}]'::jsonb
  );
  v_pull_import := (v_result->>'importId')::uuid;
  PERFORM v2.apply_setup_catalog_import(v_facility, v_actor, v_pull_import);
  IF NOT EXISTS (
    SELECT 1 FROM v2.setup_freezer_pull_records
    WHERE facility_id = v_facility AND code = 'PULL-BASE' AND ingredient_code = 'ING-BASE'
  ) THEN RAISE EXCEPTION 'Freezer-pull ingredient foreign key was not stored'; END IF;

  v_result := v2.stage_setup_catalog_import(
    v_facility, v_actor, 'catalog-die-type-1', repeat('1', 64), 'die-types',
    '[{"code":"DIE-BASE","name":"Base Die","data":{}}]'::jsonb
  );
  v_die_import := (v_result->>'importId')::uuid;
  PERFORM v2.apply_setup_catalog_import(v_facility, v_actor, v_die_import);
  v_result := v2.stage_setup_catalog_import(
    v_facility, v_actor, 'catalog-die-default-1', repeat('2', 64), 'die-line-defaults',
    '[{"code":"DIE-BASE","name":"DIE-BASE","data":{"crusts_per_cycle":10,"cycle_speed":1.5,"speed_adjustment":1,"freezer_time":20,"cases_per_layer":5,"pre_tunnel_min":null,"post_tunnel_min":null,"press_oven_min":0,"frontline_min":null}}]'::jsonb
  );
  v_default_import := (v_result->>'importId')::uuid;
  PERFORM v2.apply_setup_catalog_import(v_facility, v_actor, v_default_import);
  IF NOT EXISTS (
    SELECT 1 FROM v2.setup_die_default_records
    WHERE facility_id = v_facility AND code = 'DIE-BASE'
      AND data->>'cycle_speed' = '1.5'
      AND data->'pre_tunnel_min' = 'null'::jsonb
  ) THEN RAISE EXCEPTION 'Die default link or explicit missing timing values were not preserved'; END IF;

  v_result := v2.stage_setup_catalog_import(
    v_facility, v_actor, 'catalog-unscoped-flavors', repeat('4', 64), 'manager-lists',
    '[{"code":"run-calc-flavors","name":"run-calc-flavors","data":{"key":"run-calc-flavors","value":["Plain","Spicy"]}}]'::jsonb
  );
  v_flavor_list_import := (v_result->>'importId')::uuid;
  PERFORM v2.apply_setup_catalog_import(v_facility, v_actor, v_flavor_list_import);
  IF NOT EXISTS (
    SELECT 1 FROM v2.setup_manager_list_records
    WHERE facility_id = v_facility AND code = 'run-calc-flavors'
      AND data->'value' = '["Plain","Spicy"]'::jsonb
  ) THEN RAISE EXCEPTION 'Owner-approved unscoped flavors were not retained as an unscoped list'; END IF;

  v_result := v2.stage_setup_catalog_import(
    v_facility, v_actor, 'catalog-missing-ingredient-link', repeat('3', 64), 'mixes',
    '[{"code":"MIX-MISSING","name":"Missing link","data":{"brand":"","flavor":"","batchSizeLbs":1,"daysEarly":0,"notes":"","isPrep":false,"enabled":true,"components":[{"ingredientName":"Unknown","ingredientCode":"ING-NOT-THERE","perBatchLbs":1}]}}]'::jsonb
  );
  v_rollback := (v_result->>'importId')::uuid;
  v_failed := false;
  BEGIN
    PERFORM v2.apply_setup_catalog_import(v_facility, v_actor, v_rollback);
  EXCEPTION WHEN SQLSTATE '23503' THEN v_failed := true;
  END;
  IF NOT v_failed OR EXISTS (
    SELECT 1 FROM v2.setup_mix_records WHERE facility_id = v_facility AND code = 'MIX-MISSING'
  ) THEN RAISE EXCEPTION 'Unknown ingredient link did not quarantine the staged mix by blocking apply'; END IF;
  v_result := v2.list_setup_catalog_imports(v_facility, 50);
  IF jsonb_array_length(v_result) < 2 OR NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_result) AS entry(value)
    WHERE entry.value->>'id' = v_import::text AND entry.value->>'rowCount' = '1'
  ) THEN RAISE EXCEPTION 'Catalog import history did not account for all rows'; END IF;
  v_result := v2.get_setup_catalog_import(v_facility, v_import);
  IF v_result->>'status' <> 'applied' OR jsonb_array_length(v_result->'records') <> 1 THEN
    RAISE EXCEPTION 'Applied setup import could not be reopened for review'; END IF;

  v_result := v2.stage_setup_catalog_import(
    v_facility, v_actor, 'catalog-ingredient-update', repeat('c', 64), 'ingredients',
    '[{"code":"ing-base","name":"Base Flour Revised","data":{"categories":["dough","mix"],"allergens":[],"allergensReviewed":false,"mergedIntoCode":null,"enabled":true}}]'::jsonb
  );
  v_update := (v_result->>'importId')::uuid;
  PERFORM v2.apply_setup_catalog_import(v_facility, v_actor, v_update);
  v_result := v2.undo_setup_catalog_import(v_facility, v_actor, v_update);
  IF v_result->>'outcome' <> 'undone' OR NOT EXISTS (
    SELECT 1 FROM v2.setup_ingredient_records
    WHERE facility_id = v_facility AND code = 'ING-BASE'
      AND name = 'Base Flour'
      AND data->'categories' = '["dough"]'::jsonb
      AND data->>'allergensReviewed' = 'true'
  ) THEN RAISE EXCEPTION 'Catalog undo did not restore the prior record'; END IF;
  v_result := v2.undo_setup_catalog_import(v_facility, v_actor, v_update);
  IF v_result->>'replayed' <> 'true' THEN RAISE EXCEPTION 'Catalog undo retry was not idempotent'; END IF;

  v_source_summary := jsonb_build_object(
    'sourceFamily', 'sauce-guides', 'sourceSha256', repeat('a', 64),
    'parserVersion', 'v1-source-import/1', 'sourceRows', 1,
    'importedRows', 1, 'skippedRows', 2, 'unresolvedRows', 1
  );
  v_result := v2.stage_setup_catalog_import(
    v_facility, v_actor, 'v1-sauce-source-1', repeat('9', 64), 'run-templates',
    '[{"code":"V1-SAUCE-ACME-CLASSIC","name":"Acme Classic Sauce","data":{"brand":"Acme","flavor":"Classic","values":{"frontlineRecipeName":"House Red","sauceOzPerPizza":3.5}}}]'::jsonb,
    v_source_summary
  );
  v_source_import := (v_result->>'importId')::uuid;
  IF v_result->'sourceSummary' <> v_source_summary THEN
    RAISE EXCEPTION 'Source family and row outcome were not retained when staged';
  END IF;
  v_result := v2.stage_setup_catalog_import(
    v_facility, v_actor, 'v1-sauce-source-1', repeat('9', 64), 'run-templates',
    '[{"code":"V1-SAUCE-ACME-CLASSIC","name":"Acme Classic Sauce","data":{"brand":"Acme","flavor":"Classic","values":{"frontlineRecipeName":"House Red","sauceOzPerPizza":3.5}}}]'::jsonb,
    v_source_summary
  );
  IF v_result->>'replayed' <> 'true' OR v_result->'sourceSummary' <> v_source_summary THEN
    RAISE EXCEPTION 'Exact source import stage retry was not idempotent';
  END IF;
  v_result := v2.apply_setup_catalog_import(v_facility, v_actor, v_source_import);
  IF v_result->>'createdCount' <> '1' OR v_result->>'updatedCount' <> '0'
     OR v_result->'sourceSummary' <> v_source_summary THEN
    RAISE EXCEPTION 'Source import Apply did not retain counts and source summary';
  END IF;
  v_result := v2.apply_setup_catalog_import(v_facility, v_actor, v_source_import);
  IF v_result->>'replayed' <> 'true' OR v_result->>'createdCount' <> '1'
     OR v_result->>'updatedCount' <> '0' OR v_result->'sourceSummary' <> v_source_summary THEN
    RAISE EXCEPTION 'Lost source Apply response could not be retried exactly';
  END IF;
  v_result := v2.get_setup_catalog_import(v_facility, v_source_import);
  IF v_result->>'status' <> 'applied' OR v_result->>'createdCount' <> '1'
     OR v_result->'sourceSummary' <> v_source_summary
     OR jsonb_array_length(v_result->'records') <> 1 THEN
    RAISE EXCEPTION 'Source import history did not reopen its exact result';
  END IF;

  v_source_summary := jsonb_set(v_source_summary, '{sourceSha256}', to_jsonb(repeat('b', 64)));
  v_result := v2.stage_setup_catalog_import(
    v_facility, v_actor, 'v1-sauce-source-2', repeat('8', 64), 'run-templates',
    '[{"code":"v1-sauce-acme-classic","name":"Acme Classic Sauce","data":{"brand":"Acme","flavor":"Classic","values":{"frontlineRecipeName":"House Red","sauceOzPerPizza":4}}}]'::jsonb,
    v_source_summary
  );
  v_source_update := (v_result->>'importId')::uuid;
  v_result := v2.apply_setup_catalog_import(v_facility, v_actor, v_source_update);
  IF v_result->>'createdCount' <> '0' OR v_result->>'updatedCount' <> '1' THEN
    RAISE EXCEPTION 'Source re-import did not update the same stable target identity';
  END IF;
  v_result := v2.undo_setup_catalog_import(v_facility, v_actor, v_source_update);
  IF v_result->>'outcome' <> 'undone' OR v_result->>'updatedCount' <> '1'
     OR NOT EXISTS (
       SELECT 1 FROM v2.setup_run_template_records
       WHERE facility_id = v_facility AND lower(code) = lower('V1-SAUCE-ACME-CLASSIC')
         AND data->'values'->>'sauceOzPerPizza' = '3.5'
     ) THEN
    RAISE EXCEPTION 'Source re-import undo did not restore the prior template';
  END IF;

  v_result := v2.stage_setup_catalog_import(
    v_facility, v_actor, 'catalog-invalid-die-default', repeat('d', 64), 'die-line-defaults',
    '[{"code":"MISSING-DIE","name":"MISSING-DIE","data":{"crusts_per_cycle":10,"cycle_speed":1,"speed_adjustment":1,"freezer_time":0,"cases_per_layer":0,"pre_tunnel_min":null,"post_tunnel_min":null,"press_oven_min":null,"frontline_min":null}}]'::jsonb
  );
  v_rollback := (v_result->>'importId')::uuid;
  v_failed := false;
  BEGIN
    PERFORM v2.apply_setup_catalog_import(v_facility, v_actor, v_rollback);
  EXCEPTION WHEN SQLSTATE '23503' THEN v_failed := true;
  END;
  SELECT count(*) INTO v_count FROM v2.setup_die_default_records
  WHERE facility_id = v_facility AND code = 'MISSING-DIE';
  IF NOT v_failed OR v_count <> 0 THEN RAISE EXCEPTION 'Failed setup apply did not roll back atomically'; END IF;

  v_failed := false;
  BEGIN
    PERFORM v2.stage_setup_catalog_import(
      v_facility, v_actor, 'catalog-duplicate', repeat('e', 64), 'die-types',
      '[{"code":"DIE-A","name":"First","data":{}},{"code":"die-a","name":"Second","data":{}}]'::jsonb
    );
  EXCEPTION WHEN SQLSTATE '22023' THEN v_failed := true;
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'Case-folded duplicate setup identities were accepted'; END IF;

  v_failed := false;
  BEGIN
    PERFORM v2.list_setup_catalog_imports(v_other, 10);
  EXCEPTION WHEN SQLSTATE '42501' THEN v_failed := true;
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'Cross-facility setup catalog access was accepted'; END IF;

  v_failed := false;
  BEGIN
    INSERT INTO v2.setup_die_type_records(facility_id, code, name, data, source_import_id)
    VALUES (v_other, 'NOPE', 'Nope', '{}'::jsonb, v_import);
  EXCEPTION WHEN foreign_key_violation THEN v_failed := true;
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'Setup family table accepted a cross-facility row'; END IF;

  RAISE NOTICE 'V2 approved setup catalog lifecycle checks passed';
END
$$;

ROLLBACK;

SELECT 'V2 approved setup catalog checks passed.';
