-- Audit history is append-only for ordinary application roles.
--
-- The audit_maintenance role is deliberately NOLOGIN. A separately
-- authorized operator must SET ROLE to it before using one of the bounded
-- maintenance functions below.

DO $$
DECLARE
  maintenance_role pg_roles%ROWTYPE;
BEGIN
  SELECT * INTO maintenance_role
  FROM pg_roles
  WHERE rolname = 'audit_maintenance';

  IF NOT FOUND THEN
    CREATE ROLE audit_maintenance
      NOLOGIN
      NOSUPERUSER
      NOCREATEDB
      NOCREATEROLE
      NOINHERIT
      NOREPLICATION;
  ELSIF maintenance_role.rolcanlogin
     OR maintenance_role.rolsuper
     OR maintenance_role.rolcreatedb
     OR maintenance_role.rolcreaterole
     OR maintenance_role.rolreplication
     OR maintenance_role.rolbypassrls THEN
    RAISE EXCEPTION
      'audit_maintenance exists with unsafe role attributes; refusing to install append-only protection';
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION public.audit_logs_append_only_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  IF current_user <> 'audit_maintenance' THEN
    RAISE EXCEPTION
      'audit_logs is append-only; use the separately authorized audit_maintenance role'
      USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS audit_logs_append_only_guard ON public.audit_logs;
CREATE TRIGGER audit_logs_append_only_guard
  BEFORE UPDATE OR DELETE ON public.audit_logs
  FOR EACH ROW
  EXECUTE FUNCTION public.audit_logs_append_only_guard();

CREATE OR REPLACE FUNCTION public.redact_audit_log(
  p_id integer,
  p_changes jsonb
)
RETURNS boolean
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  changed_rows integer;
BEGIN
  IF current_user <> 'audit_maintenance' THEN
    RAISE EXCEPTION
      'redact_audit_log requires the separately authorized audit_maintenance role'
      USING ERRCODE = '42501';
  END IF;
  IF p_changes IS NULL OR jsonb_typeof(p_changes) <> 'object' THEN
    RAISE EXCEPTION 'audit redaction must be a JSON object'
      USING ERRCODE = '22023';
  END IF;
  IF octet_length(p_changes::text) > 8192 THEN
    RAISE EXCEPTION 'audit redaction exceeds the permitted size'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.audit_logs
  SET changes = p_changes
  WHERE id = p_id;
  GET DIAGNOSTICS changed_rows = ROW_COUNT;
  RETURN changed_rows = 1;
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_audit_log(
  p_id integer,
  p_reason text
)
RETURNS boolean
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  target_scope text;
  target_exists boolean;
  deleted_rows integer;
  reason text := btrim(p_reason);
BEGIN
  IF current_user <> 'audit_maintenance' THEN
    RAISE EXCEPTION
      'delete_audit_log requires the separately authorized audit_maintenance role'
      USING ERRCODE = '42501';
  END IF;
  IF reason IS NULL OR length(reason) = 0 OR length(reason) > 200 THEN
    RAISE EXCEPTION 'audit deletion requires a reason of 1 to 200 characters'
      USING ERRCODE = '22023';
  END IF;

  SELECT scope INTO target_scope
  FROM public.audit_logs
  WHERE id = p_id;
  target_exists := FOUND;
  IF NOT target_exists THEN
    RETURN false;
  END IF;

  -- Retain evidence that a separately authorized maintenance deletion took
  -- place before removing the requested historical row.
  INSERT INTO public.audit_logs (scope, actor, action, resource, changes)
  VALUES (
    target_scope,
    current_user,
    'audit_log_deleted',
    'audit_logs:' || p_id::text,
    jsonb_build_object('outcome', 'success', 'targetId', p_id, 'reasonCode', reason)
  );

  DELETE FROM public.audit_logs
  WHERE id = p_id;
  GET DIAGNOSTICS deleted_rows = ROW_COUNT;
  RETURN deleted_rows = 1;
END;
$$;

GRANT USAGE ON SCHEMA public TO audit_maintenance;
GRANT SELECT, INSERT, UPDATE (changes), DELETE ON TABLE public.audit_logs TO audit_maintenance;
GRANT USAGE, SELECT ON SEQUENCE public.audit_logs_id_seq TO audit_maintenance;
REVOKE ALL ON FUNCTION public.redact_audit_log(integer, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.delete_audit_log(integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.redact_audit_log(integer, jsonb) TO audit_maintenance;
GRANT EXECUTE ON FUNCTION public.delete_audit_log(integer, text) TO audit_maintenance;