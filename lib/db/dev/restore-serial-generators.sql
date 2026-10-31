-- One-time, explicitly approved DEVELOPMENT repair. Never run from deployment,
-- server startup, or the regular schema-push hooks. Publish manages production.
-- Restore serial metadata without losing rows, sequence progress, or grants.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';
CREATE TEMP TABLE serial_repair_targets (
  table_name text PRIMARY KEY,
  column_name text NOT NULL
) ON COMMIT DROP;
INSERT INTO serial_repair_targets VALUES
  ('action_items', 'id'),
  ('ai_conversation_turns', 'id'),
  ('ai_corrections', 'id'),
  ('ai_result_cache', 'id'),
  ('audit_logs', 'id'),
  ('background_operation_events', 'id'),
  ('cache_maintenance_events', 'id'),
  ('denied_merges', 'id'),
  ('duplicate_review_groups', 'id'),
  ('facility_knowledge', 'id'),
  ('factory_kv', 'id'),
  ('field_check_issues', 'id'),
  ('field_check_observations', 'id'),
  ('fill_missing_values', 'id'),
  ('freezer_surplus_adjustments', 'id'),
  ('import_aliases', 'id'),
  ('import_history', 'id'),
  ('ingredient_batch_weights', 'id'),
  ('inventory_items', 'id'),
  ('inventory_ledger', 'id'),
  ('inventory_locations', 'id'),
  ('inventory_lots', 'id'),
  ('inventory_observations', 'id'),
  ('inventory_product_references', 'id'),
  ('merge_aliases', 'id'),
  ('merged_away', 'id'),
  ('operational_intent_ledger', 'sequence'),
  ('photo_aliases', 'id'),
  ('production_runs', 'id'),
  ('qc_workflow_events', 'id'),
  ('quality_checks', 'id'),
  ('saved_cheese_sheets', 'id'),
  ('saved_premix_sheets', 'id'),
  ('saved_shipping_guides', 'id'),
  ('saved_spec_sheets', 'id'),
  ('spec_import_aliases', 'id'),
  ('sync_conflict_logs', 'id');

DO $repair$
DECLARE
  target record;
  generator record;
  permission record;
  sequence_oid regclass;
  sequence_name text;
  identity_kind text;
  default_expression text;
  last_id bigint;
  was_called boolean;
  maximum_id bigint;
  rows_before bigint;
  rows_after bigint;
  hash_before numeric;
  hash_after numeric;
BEGIN
  -- Lock all parents before reading any counters; application inserts must not
  -- race sequence replacement. No CASCADE or data-changing statement is used.
  FOR target IN SELECT * FROM serial_repair_targets ORDER BY table_name LOOP
    EXECUTE format('LOCK TABLE public.%I IN ACCESS EXCLUSIVE MODE', target.table_name);
  END LOOP;

  FOR target IN SELECT * FROM serial_repair_targets ORDER BY table_name LOOP
    SELECT a.attidentity, pg_get_expr(d.adbin, d.adrelid)
      INTO STRICT identity_kind, default_expression
    FROM pg_attribute a
    LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
    WHERE a.attrelid = format('public.%I', target.table_name)::regclass
      AND a.attname = target.column_name AND NOT a.attisdropped;

    sequence_oid := pg_get_serial_sequence(
      format('public.%I', target.table_name), target.column_name
    )::regclass;
    IF sequence_oid IS NULL THEN
      RAISE EXCEPTION 'Missing owned generator for %.%', target.table_name, target.column_name;
    END IF;
    sequence_name := target.table_name || '_' || target.column_name || '_seq';
    IF sequence_oid <> to_regclass(format('public.%I', sequence_name)) THEN
      RAISE EXCEPTION 'Unexpected sequence name for %.%', target.table_name, target.column_name;
    END IF;
    IF identity_kind = '' THEN
      IF default_expression IS DISTINCT FROM
        format('nextval(%L::regclass)', sequence_oid::text) THEN
        RAISE EXCEPTION 'Unexpected serial default for %.%', target.table_name, target.column_name;
      END IF;
      CONTINUE; -- Already repaired; never reset a serial counter on reruns.
    END IF;
    IF identity_kind <> 'd' THEN
      RAISE EXCEPTION 'Unsupported identity mode for %.%', target.table_name, target.column_name;
    END IF;

    SELECT s.*, c.relacl, c.relowner,
      (SELECT relowner FROM pg_class
       WHERE oid = format('public.%I', target.table_name)::regclass) AS table_owner
      INTO STRICT generator
    FROM pg_sequence s JOIN pg_class c ON c.oid = s.seqrelid
    WHERE s.seqrelid = sequence_oid;
    IF generator.seqtypid <> 'integer'::regtype
       OR generator.seqincrement <> 1 OR generator.seqmin <> 1
       OR generator.seqmax <> 2147483647 OR generator.seqcycle
       OR generator.relowner <> generator.table_owner THEN
      RAISE EXCEPTION 'Unexpected generator configuration for %.%', target.table_name, target.column_name;
    END IF;
    EXECUTE format('SELECT last_value, is_called FROM %s', sequence_oid)
      INTO last_id, was_called;
    EXECUTE format(
      'SELECT count(*), max(%I), coalesce(sum(hashtextextended(row_to_json(t)::text, 0)::numeric), 0) FROM public.%I t',
      target.column_name, target.table_name
    ) INTO rows_before, maximum_id, hash_before;

    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I DROP IDENTITY',
      target.table_name, target.column_name);
    EXECUTE format(
      'CREATE SEQUENCE public.%I AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH %s CACHE %s NO CYCLE',
      sequence_name, generator.seqstart, generator.seqcache);
    -- Keep both the previous sequence high-water mark (including deleted IDs)
    -- and any explicitly inserted IDs beyond it.
    IF maximum_id IS NOT NULL AND
       (maximum_id > last_id OR (maximum_id = last_id AND NOT was_called)) THEN
      last_id := maximum_id;
      was_called := true;
    END IF;
    PERFORM setval(format('public.%I', sequence_name)::regclass, last_id, was_called);
    EXECUTE format('ALTER SEQUENCE public.%I OWNER TO %I',
      sequence_name, pg_get_userbyid(generator.relowner));
    EXECUTE format('ALTER SEQUENCE public.%I OWNED BY public.%I.%I',
      sequence_name, target.table_name, target.column_name);
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I SET DEFAULT nextval(%L::regclass)',
      target.table_name, target.column_name, format('public.%I', sequence_name));
    FOR permission IN SELECT * FROM aclexplode(generator.relacl) LOOP
      IF permission.privilege_type NOT IN ('SELECT', 'UPDATE', 'USAGE') THEN
        RAISE EXCEPTION 'Unexpected sequence privilege';
      END IF;
      EXECUTE format('GRANT %s ON SEQUENCE public.%I TO %s%s',
        permission.privilege_type, sequence_name,
        CASE WHEN permission.grantee = 0 THEN 'PUBLIC'
          ELSE quote_ident(pg_get_userbyid(permission.grantee)) END,
        CASE WHEN permission.is_grantable THEN ' WITH GRANT OPTION' ELSE '' END);
    END LOOP;
    EXECUTE format(
      'SELECT count(*), coalesce(sum(hashtextextended(row_to_json(t)::text, 0)::numeric), 0) FROM public.%I t',
      target.table_name
    ) INTO rows_after, hash_after;
    IF rows_before <> rows_after OR hash_before <> hash_after THEN
      RAISE EXCEPTION 'Row preservation check failed for %', target.table_name;
    END IF;
  END LOOP;
END
$repair$;
SELECT count(*) AS verified_serial_generators
FROM serial_repair_targets t JOIN pg_attribute a
  ON a.attrelid = format('public.%I', t.table_name)::regclass
 AND a.attname = t.column_name
WHERE a.attidentity = ''
 AND pg_get_serial_sequence(format('public.%I', t.table_name), t.column_name) IS NOT NULL;
COMMIT;
