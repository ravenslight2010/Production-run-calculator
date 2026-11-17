BEGIN;

DO $$
DECLARE
  v_facility uuid;
  v_manager uuid;
  v_operator uuid;
  v_disabled_staff uuid;
  v_runs_before bigint;
  v_balances_before bigint;
  v_movements_before bigint;
  v_import_products uuid;
  v_import_recipes uuid;
  v_import_setups uuid;
  v_response jsonb;
  v_replay jsonb;
  v_outcome text;
  v_session_revoked boolean;
  v_session_active boolean;
  v_role text;
  v_disabled boolean;
  v_link_count integer;
BEGIN
  SELECT facility_id INTO v_facility
  FROM v2.facility_scope
  WHERE singleton;
  IF v_facility IS NULL THEN
    RAISE EXCEPTION 'Expected the isolated V2 facility in the disposable database';
  END IF;
  SELECT count(*) INTO v_runs_before FROM v2.runs WHERE facility_id = v_facility;
  SELECT count(*) INTO v_balances_before FROM v2.inventory_balances WHERE facility_id = v_facility;
  SELECT count(*) INTO v_movements_before FROM v2.inventory_movements WHERE facility_id = v_facility;

  SELECT u.id INTO v_manager
  FROM v2.staff_accounts AS u
  JOIN v2.user_roles AS ur ON ur.user_id = u.id
  WHERE ur.role_name = 'manager' AND u.disabled = false
  ORDER BY u.created_at, u.id
  LIMIT 1;
  IF v_manager IS NULL THEN
    IF NOT v2.bootstrap_first_manager(
      'CutoverRehearsalManager',
      'argon2id$v=19$m=19456,t=2,p=1$c2FsdA==$aGFzaA=='
    ) THEN
      RAISE EXCEPTION 'Could not establish the synthetic V2 manager fixture';
    END IF;
    SELECT staff_id INTO v_manager
    FROM v2.find_staff_for_sign_in('cutoverrehearsalmanager');
  END IF;
  IF v_manager IS NULL THEN
    RAISE EXCEPTION 'No enabled V2 manager exists in the disposable test database';
  END IF;

  -- Only the allowlisted identity, disabled flag, and reviewed role are in this
  -- synthetic projection. There is no V1 ID, password hash, session, or reset
  -- token in the fixture.
  v_outcome := v2.create_staff_account(
    v_manager,
    'CutoverRehearsalOperator',
    'argon2id$v=19$m=19456,t=2,p=1$c2FsdA==$aGFzaA==',
    'operator'
  );
  IF v_outcome <> 'created' THEN
    RAISE EXCEPTION 'Expected a new V2 operator account, got %', v_outcome;
  END IF;
  SELECT staff_id INTO v_operator
  FROM v2.find_staff_for_sign_in('cutoverrehearsaloperator');
  SELECT role_name, disabled INTO v_role, v_disabled
  FROM v2.list_staff_accounts(v_manager)
  WHERE staff_id = v_operator;
  IF v_role <> 'operator' OR v_disabled IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'Synthetic staff identity or role mapping was not preserved';
  END IF;

  v_outcome := v2.create_staff_account(
    v_manager,
    'cutoverrehearsaloperator',
    'argon2id$v=19$m=19456,t=2,p=1$c2FsdA==$aGFzaA==',
    'operator'
  );
  IF v_outcome <> 'duplicate' THEN
    RAISE EXCEPTION 'Case-insensitive duplicate staff identity was not held for review';
  END IF;

  v_outcome := v2.create_staff_account(
    v_manager,
    'CutoverRehearsalDisabled',
    'argon2id$v=19$m=19456,t=2,p=1$c2FsdA==$aGFzaA==',
    'operator'
  );
  IF v_outcome <> 'created' THEN
    RAISE EXCEPTION 'Could not create the synthetic disabled-account fixture';
  END IF;
  SELECT staff_id INTO v_disabled_staff
  FROM v2.find_staff_for_sign_in('cutoverrehearsaldisabled');
  v_outcome := v2.update_staff_account(v_manager, v_disabled_staff, true, NULL);
  SELECT disabled INTO v_disabled
  FROM v2.find_staff_for_sign_in('cutoverrehearsaldisabled');
  IF v_outcome <> 'updated' OR v_disabled IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Disabled staff state did not remain disabled in V2';
  END IF;
  IF v2.open_staff_session(
    v_disabled_staff, repeat('c', 64), repeat('d', 64),
    clock_timestamp() + interval '1 day'
  ) THEN
    RAISE EXCEPTION 'Disabled synthetic staff unexpectedly opened a V2 session';
  END IF;

  IF NOT v2.open_staff_session(
    v_operator, repeat('a', 64), repeat('b', 64),
    clock_timestamp() + interval '1 day'
  ) THEN
    RAISE EXCEPTION 'Enabled synthetic staff could not open a fresh V2 session';
  END IF;
  SELECT role_name INTO v_role
  FROM v2.resolve_staff_session(repeat('a', 64));
  IF v_role IS DISTINCT FROM 'operator' THEN
    RAISE EXCEPTION 'Fresh V2 session did not resolve the mapped operator role';
  END IF;
  SELECT v2.revoke_staff_session(repeat('a', 64)) INTO v_session_revoked;
  SELECT EXISTS (SELECT 1 FROM v2.resolve_staff_session(repeat('a', 64)))
    INTO v_session_active;
  IF v_session_revoked IS DISTINCT FROM true OR v_session_active IS DISTINCT FROM false THEN
    RAISE EXCEPTION
      'Fresh V2 session rollback failed (revoked=%, active=%)',
      v_session_revoked, v_session_active;
  END IF;

  -- Synthetic setup payload follows only the currently supported V2 CSV
  -- import contract. Source-specific identifiers and stock quantities are not
  -- present.
  v_response := v2.stage_setup_import(
    v_facility, v_manager, 'cutover-rehearsal-products', repeat('1', 64), 'products',
    '[
      {"code":"CUT-PIZZA","name":"Synthetic Pizza","unit":"case"},
      {"code":"CUT-FLOUR","name":"Synthetic Flour","unit":"lb"},
      {"code":"CUT-BOX","name":"Synthetic Carton","unit":"each"}
    ]'::jsonb
  );
  v_import_products := (v_response->>'importId')::uuid;
  IF v_response->>'outcome' <> 'staged' OR v_response->>'rowCount' <> '3' THEN
    RAISE EXCEPTION 'Synthetic product projection did not stage three rows';
  END IF;
  v_replay := v2.stage_setup_import(
    v_facility, v_manager, 'cutover-rehearsal-products', repeat('1', 64), 'products',
    '[
      {"code":"CUT-PIZZA","name":"Synthetic Pizza","unit":"case"},
      {"code":"CUT-FLOUR","name":"Synthetic Flour","unit":"lb"},
      {"code":"CUT-BOX","name":"Synthetic Carton","unit":"each"}
    ]'::jsonb
  );
  IF v_replay->>'importId' <> v_import_products::text
     OR v_replay->>'replayed' <> 'true' THEN
    RAISE EXCEPTION 'Retrying the same product stage did not return its original batch';
  END IF;

  BEGIN
    PERFORM v2.stage_setup_import(
      v_facility, v_manager, 'cutover-rehearsal-duplicate-codes', repeat('2', 64), 'products',
      '[
        {"code":"CUT-DUP","name":"Synthetic duplicate one","unit":"each"},
        {"code":"cut-dup","name":"Synthetic duplicate two","unit":"each"}
      ]'::jsonb
    );
    RAISE EXCEPTION 'Case-insensitive duplicate product codes were accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN
    NULL;
  END;

  v_response := v2.apply_setup_import(v_facility, v_manager, v_import_products);
  IF v_response->>'outcome' <> 'applied' THEN
    RAISE EXCEPTION 'Synthetic product batch did not apply';
  END IF;
  v_replay := v2.apply_setup_import(v_facility, v_manager, v_import_products);
  IF v_replay->>'replayed' <> 'true'
     OR (SELECT count(*) FROM v2.products
         WHERE facility_id = v_facility AND code LIKE 'CUT-%') <> 3 THEN
    RAISE EXCEPTION 'Retrying product Apply duplicated or changed records';
  END IF;

  v_response := v2.stage_setup_import(
    v_facility, v_manager, 'cutover-rehearsal-recipes', repeat('3', 64), 'recipes',
    '[{
      "code":"CUT-DOUGH",
      "name":"Synthetic Dough",
      "productCode":"CUT-PIZZA",
      "data":{
        "station_key":"dough",
        "ingredients":[{"product_code":"CUT-FLOUR","quantity":12,"unit":"lb"}]
      }
    }]'::jsonb
  );
  v_import_recipes := (v_response->>'importId')::uuid;
  PERFORM v2.apply_setup_import(v_facility, v_manager, v_import_recipes);

  v_response := v2.stage_setup_import(
    v_facility, v_manager, 'cutover-rehearsal-setups', repeat('4', 64), 'production-setups',
    '[{
      "code":"CUT-LINE",
      "name":"Synthetic Line",
      "productCode":"CUT-PIZZA",
      "data":{
        "recipe_codes":["CUT-DOUGH"],
        "packaging_per_case":[{"product_code":"CUT-BOX","quantity":1,"unit":"each"}]
      }
    }]'::jsonb
  );
  v_import_setups := (v_response->>'importId')::uuid;
  PERFORM v2.apply_setup_import(v_facility, v_manager, v_import_setups);

  SELECT count(*) INTO v_link_count
  FROM v2.master_records AS setup
  JOIN v2.products AS product
    ON product.facility_id = setup.facility_id
   AND lower(product.code) = lower(setup.product_code)
  CROSS JOIN LATERAL jsonb_array_elements_text(setup.data->'recipe_codes') AS recipe_code(code)
  JOIN v2.master_records AS recipe
    ON recipe.facility_id = setup.facility_id
   AND recipe.kind = 'recipes'
   AND lower(recipe.code) = lower(recipe_code.code)
  WHERE setup.facility_id = v_facility
    AND setup.kind = 'production-setups'
    AND setup.code = 'CUT-LINE'
    AND EXISTS (
      SELECT 1
      FROM jsonb_array_elements(recipe.data->'ingredients') AS ingredient(line)
      JOIN v2.products AS ingredient_product
        ON ingredient_product.facility_id = recipe.facility_id
       AND lower(ingredient_product.code) = lower(ingredient.line->>'product_code')
      WHERE ingredient.line->>'unit' = ingredient_product.base_unit
    )
    AND EXISTS (
      SELECT 1
      FROM jsonb_array_elements(setup.data->'packaging_per_case') AS packaging(line)
      JOIN v2.products AS packaging_product
        ON packaging_product.facility_id = setup.facility_id
       AND lower(packaging_product.code) = lower(packaging.line->>'product_code')
      WHERE packaging.line->>'unit' = packaging_product.base_unit
    );
  IF v_link_count <> 1 THEN
    RAISE EXCEPTION 'Synthetic setup-to-recipe-to-product links did not resolve exactly once';
  END IF;

  IF (SELECT count(*) FROM v2.runs WHERE facility_id = v_facility) <> v_runs_before
     OR (SELECT count(*) FROM v2.inventory_balances WHERE facility_id = v_facility) <> v_balances_before
     OR (SELECT count(*) FROM v2.inventory_movements WHERE facility_id = v_facility) <> v_movements_before THEN
    RAISE EXCEPTION 'The cutover rehearsal changed run or inventory history';
  END IF;

  -- Undo in reverse dependency order; repeating Undo is an idempotent replay.
  PERFORM v2.undo_setup_import(v_facility, v_manager, v_import_setups);
  PERFORM v2.undo_setup_import(v_facility, v_manager, v_import_recipes);
  v_replay := v2.undo_setup_import(v_facility, v_manager, v_import_products);
  IF v_replay->>'outcome' <> 'undone'
     OR (SELECT count(*) FROM v2.master_records WHERE facility_id = v_facility
         AND code IN ('CUT-DOUGH', 'CUT-LINE')) <> 0
     OR (SELECT count(*) FROM v2.products WHERE facility_id = v_facility
         AND code LIKE 'CUT-%') <> 0 THEN
    RAISE EXCEPTION 'Reverse-order synthetic setup rollback did not clear its records';
  END IF;
  v_replay := v2.undo_setup_import(v_facility, v_manager, v_import_products);
  IF v_replay->>'replayed' <> 'true' THEN
    RAISE EXCEPTION 'Retrying setup Undo did not return its original outcome';
  END IF;

  v_outcome := v2.update_staff_account(v_manager, v_operator, true, NULL);
  IF v_outcome <> 'updated'
     OR EXISTS (SELECT 1 FROM v2.resolve_staff_session(repeat('a', 64))) THEN
    RAISE EXCEPTION 'Synthetic staff rollback did not disable and revoke the V2 account';
  END IF;

  RAISE NOTICE 'Synthetic V1-to-V2 setup and staff transfer rehearsal passed';
END
$$;

ROLLBACK;
