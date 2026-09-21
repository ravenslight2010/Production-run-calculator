-- Rollback for 0001_audit_logs_append_only.sql.
-- This intentionally leaves the NOLOGIN audit_maintenance role in place;
-- role ownership and credentials are managed separately from schema rollback.

DROP TRIGGER IF EXISTS audit_logs_append_only_guard ON public.audit_logs;
DROP FUNCTION IF EXISTS public.record_audit_maintenance_approval(integer, text, text, text, text);
DROP FUNCTION IF EXISTS public.delete_audit_log(integer, text);
DROP FUNCTION IF EXISTS public.redact_audit_log(integer, jsonb);
DROP FUNCTION IF EXISTS public.audit_logs_append_only_guard();

REVOKE ALL ON TABLE public.audit_logs FROM audit_maintenance;
REVOKE ALL ON SEQUENCE public.audit_logs_id_seq FROM audit_maintenance;