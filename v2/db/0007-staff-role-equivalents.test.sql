BEGIN;

INSERT INTO v2.staff_accounts (id, username, password_hash, disabled)
VALUES (
  '77000000-0000-4000-8000-000000000001',
  'V2RoleManager',
  'argon2id$v=19$m=19456,t=2,p=1$c2FsdA==$aGFzaA==',
  false
);
INSERT INTO v2.user_roles (user_id, role_name)
VALUES ('77000000-0000-4000-8000-000000000001', 'manager');

DO $$
DECLARE
  v_outcome text;
  v_capabilities jsonb;
  v_facility uuid;
  v_role text;
  v_opened boolean;
  v_warehouse_id uuid;
  v_qc_manager_id uuid;
  v_role_count integer;
BEGIN
  SELECT count(*) INTO v_role_count
  FROM v2.list_staff_roles('77000000-0000-4000-8000-000000000001');
  IF v_role_count <> 4 THEN
    RAISE EXCEPTION 'V2 staff directory does not expose the two reviewed role equivalents';
  END IF;

  SELECT v2.create_staff_account(
    '77000000-0000-4000-8000-000000000001',
    'V2WarehouseRoleTest',
    'argon2id$v=19$m=19456,t=2,p=1$c2FsdA==$aGFzaA==',
    'warehouse'
  ) INTO v_outcome;
  IF v_outcome IS DISTINCT FROM 'created' THEN
    RAISE EXCEPTION 'Manager could not assign the reviewed warehouse role';
  END IF;
  SELECT id INTO v_warehouse_id
  FROM v2.staff_accounts
  WHERE username = 'V2WarehouseRoleTest';

  SELECT v2.create_staff_account(
    '77000000-0000-4000-8000-000000000001',
    'V2QcManagerRoleTest',
    'argon2id$v=19$m=19456,t=2,p=1$c2FsdA==$aGFzaA==',
    'qc-manager'
  ) INTO v_outcome;
  IF v_outcome IS DISTINCT FROM 'created' THEN
    RAISE EXCEPTION 'Manager could not assign the reviewed qc-manager role';
  END IF;
  SELECT id INTO v_qc_manager_id
  FROM v2.staff_accounts
  WHERE username = 'V2QcManagerRoleTest';

  SELECT v2.open_staff_session(
    v_warehouse_id,
    repeat('a', 64),
    repeat('b', 64),
    clock_timestamp() + interval '1 day'
  ) INTO v_opened;
  IF v_opened IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Warehouse account could not open a V2 session';
  END IF;
  SELECT facility_id, role_name, capabilities
    INTO v_facility, v_role, v_capabilities
  FROM v2.resolve_staff_session(repeat('a', 64));
  IF v_facility IS NULL OR v_role IS DISTINCT FROM 'warehouse'
     OR v_capabilities IS DISTINCT FROM '["manage-inventory"]'::jsonb
     OR v2.actor_can_manage_staff(v_warehouse_id) THEN
    RAISE EXCEPTION 'Warehouse session did not resolve with only its reviewed capability';
  END IF;

  SELECT v2.open_staff_session(
    v_qc_manager_id,
    repeat('c', 64),
    repeat('d', 64),
    clock_timestamp() + interval '1 day'
  ) INTO v_opened;
  IF v_opened IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'QC manager account could not open a V2 session';
  END IF;
  SELECT facility_id, role_name, capabilities
    INTO v_facility, v_role, v_capabilities
  FROM v2.resolve_staff_session(repeat('c', 64));
  IF v_facility IS NULL OR v_role IS DISTINCT FROM 'qc-manager'
     OR v_capabilities IS DISTINCT FROM
       '["use-ai-tools","review-incidents","manage-allergens","record-qc","manage-qc"]'::jsonb
     OR v2.actor_can_manage_staff(v_qc_manager_id) THEN
    RAISE EXCEPTION 'QC manager session did not resolve with only its reviewed capabilities';
  END IF;
END
$$;

ROLLBACK;
