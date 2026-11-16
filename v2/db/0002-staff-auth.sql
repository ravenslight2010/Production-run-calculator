BEGIN;

CREATE TABLE v2.facility_scope (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  facility_id uuid NOT NULL UNIQUE DEFAULT gen_random_uuid()
);

INSERT INTO v2.facility_scope (singleton)
VALUES (true)
ON CONFLICT (singleton) DO NOTHING;

CREATE TABLE v2.staff_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username text NOT NULL CHECK (
    length(btrim(username)) BETWEEN 3 AND 40
    AND username = btrim(username)
    AND username !~ '[[:cntrl:]]'
  ),
  password_hash text NOT NULL CHECK (
    length(password_hash) BETWEEN 20 AND 256
    AND password_hash LIKE 'argon2id$v=19$m=19456,t=2,p=1$%$%'
  ),
  disabled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE UNIQUE INDEX staff_accounts_username_casefolded
  ON v2.staff_accounts (lower(username));

CREATE TABLE v2.roles (
  name text PRIMARY KEY CHECK (length(btrim(name)) BETWEEN 1 AND 80),
  capabilities jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(capabilities) = 'array'),
  builtin boolean NOT NULL DEFAULT false
);

INSERT INTO v2.roles (name, capabilities, builtin)
VALUES
  ('manager', '["manage-staff","manage-inventory","edit-production-rules","approve-password-resets","review-incidents","use-ai-tools","manage-factory-settings","manage-profiles","manage-allergens","record-qc","manage-qc"]'::jsonb, true),
  ('operator', '[]'::jsonb, true)
ON CONFLICT (name) DO UPDATE
  SET capabilities = EXCLUDED.capabilities,
      builtin = EXCLUDED.builtin
  WHERE v2.roles.builtin;

CREATE TABLE v2.user_roles (
  user_id uuid PRIMARY KEY REFERENCES v2.staff_accounts (id) ON DELETE CASCADE,
  role_name text NOT NULL REFERENCES v2.roles (name) ON DELETE RESTRICT,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE v2.staff_sessions (
  token_hash text PRIMARY KEY CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  csrf_hash text NOT NULL CHECK (csrf_hash ~ '^[0-9a-f]{64}$'),
  user_id uuid NOT NULL REFERENCES v2.staff_accounts (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  CHECK (expires_at > created_at),
  CHECK (revoked_at IS NULL OR revoked_at >= created_at)
);

CREATE INDEX staff_sessions_user_expiry
  ON v2.staff_sessions (user_id, expires_at);

CREATE TABLE v2.staff_bootstrap_marker (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  completed_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

INSERT INTO v2.staff_bootstrap_marker (singleton)
SELECT true
WHERE EXISTS (SELECT 1 FROM v2.staff_accounts)
ON CONFLICT (singleton) DO NOTHING;

CREATE FUNCTION v2.find_staff_for_sign_in(p_username text)
RETURNS TABLE (staff_id uuid, password_hash text, disabled boolean)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, v2
AS $$
BEGIN
  IF p_username IS NULL OR length(btrim(p_username)) NOT BETWEEN 3 AND 40 THEN
    RAISE EXCEPTION 'Invalid sign-in identifier'
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
    SELECT u.id, u.password_hash, u.disabled
    FROM v2.staff_accounts AS u
    WHERE lower(u.username) = lower(btrim(p_username))
    LIMIT 1;
END
$$;

CREATE FUNCTION v2.open_staff_session(
  p_staff_id uuid,
  p_token_hash text,
  p_csrf_hash text,
  p_expires_at timestamptz
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, v2
AS $$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_rows integer;
BEGIN
  IF p_staff_id IS NULL
     OR p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$'
     OR p_csrf_hash IS NULL OR p_csrf_hash !~ '^[0-9a-f]{64}$'
     OR p_expires_at IS NULL
     OR p_expires_at <= v_now
     OR p_expires_at > v_now + interval '90 days' THEN
    RAISE EXCEPTION 'Invalid session request'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO v2.staff_sessions (token_hash, csrf_hash, user_id, created_at, expires_at)
    SELECT p_token_hash, p_csrf_hash, u.id, v_now, p_expires_at
    FROM v2.staff_accounts AS u
    WHERE u.id = p_staff_id AND u.disabled = false
    ON CONFLICT (token_hash) DO NOTHING;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows = 1;
END
$$;

CREATE FUNCTION v2.resolve_staff_session(p_token_hash text)
RETURNS TABLE (
  actor_id uuid,
  facility_id uuid,
  username text,
  role_name text,
  capabilities jsonb,
  csrf_hash text,
  expires_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, v2
AS $$
  SELECT u.id, f.facility_id, u.username, r.name, r.capabilities,
         s.csrf_hash, s.expires_at
  FROM v2.staff_sessions AS s
  JOIN v2.staff_accounts AS u ON u.id = s.user_id
  JOIN v2.user_roles AS ur ON ur.user_id = u.id
  JOIN v2.roles AS r ON r.name = ur.role_name
  CROSS JOIN v2.facility_scope AS f
  WHERE s.token_hash = p_token_hash
    AND s.revoked_at IS NULL
    AND s.expires_at > clock_timestamp()
    AND u.disabled = false
    AND f.singleton = true
$$;

CREATE FUNCTION v2.revoke_staff_session(p_token_hash text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, v2
AS $$
DECLARE
  v_rows integer;
BEGIN
  IF p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$' THEN
    RETURN false;
  END IF;

  UPDATE v2.staff_sessions
    SET revoked_at = clock_timestamp()
    WHERE token_hash = p_token_hash AND revoked_at IS NULL;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows = 1;
END
$$;

CREATE FUNCTION v2.staff_bootstrap_open()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, v2
AS $$
  SELECT NOT EXISTS (SELECT 1 FROM v2.staff_bootstrap_marker)
     AND NOT EXISTS (SELECT 1 FROM v2.staff_accounts)
$$;

CREATE FUNCTION v2.actor_can_manage_staff(p_actor_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, v2
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM v2.staff_accounts AS u
    JOIN v2.user_roles AS ur ON ur.user_id = u.id
    JOIN v2.roles AS r ON r.name = ur.role_name
    WHERE u.id = p_actor_id
      AND u.disabled = false
      AND r.capabilities ? 'manage-staff'
  )
$$;

CREATE FUNCTION v2.bootstrap_first_manager(
  p_username text,
  p_password_hash text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, v2
AS $$
DECLARE
  v_user_id uuid;
BEGIN
  IF p_username IS NULL
     OR length(btrim(p_username)) NOT BETWEEN 3 AND 40
     OR p_username <> btrim(p_username)
     OR p_username ~ '[[:cntrl:]]'
     OR p_password_hash IS NULL
     OR length(p_password_hash) NOT BETWEEN 20 AND 256
     OR p_password_hash NOT LIKE 'argon2id$v=19$m=19456,t=2,p=1$%$%' THEN
    RAISE EXCEPTION 'Invalid first-manager request'
      USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(20855409, 1);
  IF EXISTS (SELECT 1 FROM v2.staff_bootstrap_marker)
     OR EXISTS (SELECT 1 FROM v2.staff_accounts) THEN
    RETURN false;
  END IF;

  INSERT INTO v2.staff_accounts (username, password_hash)
    VALUES (p_username, p_password_hash)
    RETURNING id INTO v_user_id;
  INSERT INTO v2.user_roles (user_id, role_name)
    VALUES (v_user_id, 'manager');
  INSERT INTO v2.staff_bootstrap_marker (singleton) VALUES (true);
  RETURN true;
END
$$;

CREATE FUNCTION v2.list_staff_accounts(p_actor_id uuid)
RETURNS TABLE (
  staff_id uuid,
  username text,
  role_name text,
  disabled boolean,
  created_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, v2
AS $$
BEGIN
  IF NOT v2.actor_can_manage_staff(p_actor_id) THEN
    RAISE EXCEPTION 'Staff management is not authorized'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
    SELECT u.id, u.username, r.name, u.disabled, u.created_at
    FROM v2.staff_accounts AS u
    JOIN v2.user_roles AS ur ON ur.user_id = u.id
    JOIN v2.roles AS r ON r.name = ur.role_name
    ORDER BY lower(u.username), u.id
    LIMIT 200;
END
$$;

CREATE FUNCTION v2.list_staff_roles(p_actor_id uuid)
RETURNS TABLE (role_name text, capabilities jsonb)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, v2
AS $$
BEGIN
  IF NOT v2.actor_can_manage_staff(p_actor_id) THEN
    RAISE EXCEPTION 'Staff management is not authorized'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
    SELECT r.name, r.capabilities
    FROM v2.roles AS r
    ORDER BY r.name
    LIMIT 100;
END
$$;

CREATE FUNCTION v2.create_staff_account(
  p_actor_id uuid,
  p_username text,
  p_password_hash text,
  p_role_name text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, v2
AS $$
DECLARE
  v_user_id uuid;
BEGIN
  IF p_username IS NULL
     OR length(btrim(p_username)) NOT BETWEEN 3 AND 40
     OR p_username <> btrim(p_username)
     OR p_username ~ '[[:cntrl:]]'
     OR p_password_hash IS NULL
     OR length(p_password_hash) NOT BETWEEN 20 AND 256
     OR p_password_hash NOT LIKE 'argon2id$v=19$m=19456,t=2,p=1$%$%' THEN
    RAISE EXCEPTION 'Invalid staff account request'
      USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(20855409, 1);
  IF NOT v2.actor_can_manage_staff(p_actor_id) THEN
    RAISE EXCEPTION 'Staff management is not authorized'
      USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM v2.roles WHERE name = p_role_name) THEN
    RETURN 'invalid_role';
  END IF;

  INSERT INTO v2.staff_accounts (username, password_hash)
    VALUES (p_username, p_password_hash)
    RETURNING id INTO v_user_id;
  INSERT INTO v2.user_roles (user_id, role_name)
    VALUES (v_user_id, p_role_name);
  RETURN 'created';
EXCEPTION
  WHEN unique_violation THEN
    RETURN 'duplicate';
END
$$;

CREATE FUNCTION v2.update_staff_account(
  p_actor_id uuid,
  p_staff_id uuid,
  p_disabled boolean,
  p_role_name text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, v2
AS $$
DECLARE
  v_current_disabled boolean;
  v_current_role text;
  v_next_disabled boolean;
  v_next_role text;
BEGIN
  IF p_staff_id IS NULL OR (p_disabled IS NULL AND p_role_name IS NULL) THEN
    RAISE EXCEPTION 'Invalid staff account update'
      USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(20855409, 1);
  IF NOT v2.actor_can_manage_staff(p_actor_id) THEN
    RAISE EXCEPTION 'Staff management is not authorized'
      USING ERRCODE = '42501';
  END IF;
  IF p_role_name IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM v2.roles WHERE name = p_role_name) THEN
    RETURN 'invalid_role';
  END IF;

  SELECT u.disabled, r.name
    INTO v_current_disabled, v_current_role
    FROM v2.staff_accounts AS u
    JOIN v2.user_roles AS ur ON ur.user_id = u.id
    JOIN v2.roles AS r ON r.name = ur.role_name
    WHERE u.id = p_staff_id
    FOR UPDATE OF u, ur;
  IF NOT FOUND THEN
    RETURN 'not_found';
  END IF;

  v_next_disabled := coalesce(p_disabled, v_current_disabled);
  v_next_role := coalesce(p_role_name, v_current_role);

  IF v_current_disabled = false
     AND v_current_role = 'manager'
     AND (v_next_disabled OR v_next_role <> 'manager')
     AND (
       SELECT count(*)
       FROM v2.staff_accounts AS u
       JOIN v2.user_roles AS ur ON ur.user_id = u.id
       WHERE u.disabled = false AND ur.role_name = 'manager'
     ) <= 1 THEN
    RETURN 'last_manager';
  END IF;
  IF p_actor_id = p_staff_id THEN
    RETURN 'self_change';
  END IF;

  IF v_current_disabled = v_next_disabled AND v_current_role = v_next_role THEN
    RETURN 'unchanged';
  END IF;

  UPDATE v2.staff_accounts
    SET disabled = v_next_disabled
    WHERE id = p_staff_id;
  UPDATE v2.user_roles
    SET role_name = v_next_role,
        updated_at = clock_timestamp()
    WHERE user_id = p_staff_id;
  UPDATE v2.staff_sessions
    SET revoked_at = clock_timestamp()
    WHERE user_id = p_staff_id AND revoked_at IS NULL;
  RETURN 'updated';
END
$$;

REVOKE ALL ON SCHEMA v2 FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA v2 FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA v2 FROM PUBLIC;

COMMENT ON TABLE v2.staff_accounts IS
  'V2-owned staff accounts. Never populate from V1 without a separately approved, audited cutover.';
COMMENT ON TABLE v2.staff_sessions IS
  'V2-only opaque sessions; stores token and CSRF hashes, never browser tokens.';
COMMENT ON FUNCTION v2.resolve_staff_session(text) IS
  'Resolves current V2 account, role, capability, facility, and CSRF state from an opaque token hash.';
COMMENT ON FUNCTION v2.bootstrap_first_manager(text, text) IS
  'Creates exactly one initial V2 manager under a transaction-scoped advisory lock.';
COMMENT ON FUNCTION v2.update_staff_account(uuid, uuid, boolean, text) IS
  'Manager-only account changes are serialized, preserve one enabled manager, and revoke affected sessions.';

COMMIT;
