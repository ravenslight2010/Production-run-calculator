CREATE OR REPLACE FUNCTION public.qc_workflow_events_append_only_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  RAISE EXCEPTION
    'qc_workflow_events is append-only; corrections and redactions must be recorded as new events'
    USING ERRCODE = '42501';
END;
$$;

DROP TRIGGER IF EXISTS qc_workflow_events_append_only_guard
  ON public.qc_workflow_events;
CREATE TRIGGER qc_workflow_events_append_only_guard
  BEFORE UPDATE OR DELETE ON public.qc_workflow_events
  FOR EACH ROW
  EXECUTE FUNCTION public.qc_workflow_events_append_only_guard();
