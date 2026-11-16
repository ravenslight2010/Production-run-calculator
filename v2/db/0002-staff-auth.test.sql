BEGIN;

INSERT INTO v2.staff_accounts (id, username, password_hash, disabled)
VALUES
  ('71000000-0000-4000-8000-000000000001', 'V2TestManager', 'argon2id$v=19$m=19456,t=2,p=1$c2FsdA==$aGFzaA==', false),
  ('71000000-0000-4000-8000-000000000002', 'V2Disabled', 'argon2id$v=19$m=19456,t=2,p=1$c2FsdA==$aGFzaA==', true);

INSERT INTO v2.user_roles (user_id, role_name)
VALUES
  ('71000000-0000-4000-8000-000000000001', 'manager'),
  ('71000000-0000-4000-8000-000000000002', 'operator');

DO $$
DECLARE
  v_id uuid;
  v_disabled boolean;
  v_opened boolean;
  v_facility uuid;
  v_role text;
  v_capabilities jsonb;
  v_revoked boolean;
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
END
$$;

ROLLBACK;
