BEGIN;

INSERT INTO v2.staff_accounts (id, username, password_hash, disabled)
VALUES
  ('71000000-0000-4000-8000-000000000001', 'V2TestManager', 'argon2id$v=19$m=19456,t=2,p=1$c2FsdA==$aGFzaA==', false),
  ('71000000-0000-4000-8000-000000000002', 'V2Disabled', 'argon2id$v=19$m=19456,t=2,p=1$c2FsdA==$aGFzaA==', true),
  ('71000000-0000-4000-8000-000000000003', 'V2Operator', 'argon2id$v=19$m=19456,t=2,p=1$c2FsdA==$aGFzaA==', false);

INSERT INTO v2.user_roles (user_id, role_name)
VALUES
  ('71000000-0000-4000-8000-000000000001', 'manager'),
  ('71000000-0000-4000-8000-000000000002', 'operator'),
  ('71000000-0000-4000-8000-000000000003', 'operator');

DO $$
DECLARE
  v_id uuid;
  v_disabled boolean;
  v_opened boolean;
  v_facility uuid;
  v_role text;
  v_capabilities jsonb;
  v_revoked boolean;
  v_outcome text;
  v_disabled_staff uuid := '71000000-0000-4000-8000-000000000003';
  v_staff_count integer;
  v_role_count integer;
  v_staff_role text;
BEGIN
  SELECT staff_id, disabled INTO v_id, v_disabled
    FROM v2.find_staff_for_sign_in('v2testmanager');
  IF v_id IS DISTINCT FROM '71000000-0000-4000-8000-000000000001'::uuid
     OR v_disabled IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'case-insensitive V2 sign-in lookup failed';
  END IF;

  SELECT v2.open_staff_session(
    v_id,
    repeat('a', 64),
    repeat('b', 64),
    clock_timestamp() + interval '1 day'
  ) INTO v_opened;
  IF v_opened IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'enabled V2 account could not open a session';
  END IF;

  SELECT facility_id, role_name, capabilities
    INTO v_facility, v_role, v_capabilities
    FROM v2.resolve_staff_session(repeat('a', 64));
  IF v_facility IS NULL OR v_role IS DISTINCT FROM 'manager'
     OR NOT (v_capabilities ? 'manage-staff') THEN
    RAISE EXCEPTION 'V2 session did not resolve current facility and role';
  END IF;

  SELECT v2.open_staff_session(
    '71000000-0000-4000-8000-000000000002',
    repeat('c', 64),
    repeat('d', 64),
    clock_timestamp() + interval '1 day'
  ) INTO v_opened;
  IF v_opened IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'disabled V2 account unexpectedly opened a session';
  END IF;

  SELECT v2.revoke_staff_session(repeat('a', 64)) INTO v_revoked;
  IF v_revoked IS DISTINCT FROM true
     OR EXISTS (SELECT 1 FROM v2.resolve_staff_session(repeat('a', 64))) THEN
    RAISE EXCEPTION 'revoked V2 session remained usable';
  END IF;

  IF EXISTS (SELECT 1 FROM v2.resolve_staff_session(repeat('c', 64))) THEN
    RAISE EXCEPTION 'disabled V2 account received a resolvable session';
  END IF;

  SELECT count(*) INTO v_staff_count
    FROM v2.list_staff_accounts('71000000-0000-4000-8000-000000000001');
  SELECT count(*) INTO v_role_count
    FROM v2.list_staff_roles('71000000-0000-4000-8000-000000000001');
  IF v_staff_count <> 3 OR v_role_count <> 2 THEN
    RAISE EXCEPTION 'manager staff directory returned unexpected bounded results';
  END IF;

  SELECT v2.open_staff_session(
    v_disabled_staff,
    repeat('e', 64),
    repeat('f', 64),
    clock_timestamp() + interval '1 day'
  ) INTO v_opened;
  IF v_opened IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'enabled staff account could not open a session';
  END IF;

  SELECT v2.update_staff_account(
    '71000000-0000-4000-8000-000000000001',
    v_disabled_staff,
    NULL,
    'manager'
  ) INTO v_outcome;
  IF v_outcome IS DISTINCT FROM 'updated'
     OR EXISTS (SELECT 1 FROM v2.resolve_staff_session(repeat('e', 64))) THEN
    RAISE EXCEPTION 'role change did not revoke the affected staff session';
  END IF;
  SELECT role_name INTO v_staff_role
    FROM v2.list_staff_accounts('71000000-0000-4000-8000-000000000001')
    WHERE staff_id = v_disabled_staff;
  IF v_staff_role IS DISTINCT FROM 'manager' THEN
    RAISE EXCEPTION 'role change did not update the assigned staff role';
  END IF;

  SELECT v2.open_staff_session(
    v_disabled_staff,
    repeat('1', 64),
    repeat('2', 64),
    clock_timestamp() + interval '1 day'
  ) INTO v_opened;
  SELECT v2.update_staff_account(
    '71000000-0000-4000-8000-000000000001',
    v_disabled_staff,
    true,
    NULL
  ) INTO v_outcome;
  IF v_outcome IS DISTINCT FROM 'updated'
     OR EXISTS (SELECT 1 FROM v2.resolve_staff_session(repeat('1', 64))) THEN
    RAISE EXCEPTION 'disabling an account did not revoke its sessions';
  END IF;
  SELECT disabled INTO v_disabled
    FROM v2.find_staff_for_sign_in('v2operator');
  IF v_disabled IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'disabled staff account remained eligible for sign-in';
  END IF;

  SELECT v2.update_staff_account(
    '71000000-0000-4000-8000-000000000001',
    '71000000-0000-4000-8000-000000000001',
    true,
    NULL
  ) INTO v_outcome;
  IF v_outcome IS DISTINCT FROM 'last_manager' THEN
    RAISE EXCEPTION 'the last enabled manager could be disabled';
  END IF;
END
$$;

ROLLBACK;
