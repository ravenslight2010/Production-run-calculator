-- Convert legacy serial generators to SQL-standard identity columns without
-- rewinding sequence progress or discarding sequence grants. The package push
-- commands run this before drizzle-kit so an existing serial sequence cannot
-- collide with the identity sequence Drizzle expects. Already-identity columns
-- are skipped without changing their counters. The whole helper runs in one
-- transaction; any unexpected configuration or dependency rolls every table back.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

DO $migration$
DECLARE
  target record;
  generator record;
  permission record;
  sequence_oid regclass;
  sequence_name text;
  backup_name text;
  identity_kind text;
  default_expression text;
  column_type regtype;
  last_id bigint;
  was_called boolean;
  maximum_id bigint;
  rows_before bigint;
  rows_after bigint;
  hash_before numeric;
  hash_after numeric;
BEGIN
  -- Convert in stable table order, locking each existing parent before reading
  -- its counter. Fresh databases skip missing tables and continue to Drizzle.
  FOR target IN
    SELECT * FROM (VALUES
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
      ('freezer_surplus_decision_corrections', 'id'),
      ('import_aliases', 'id'),
      ('import_history', 'id'),
      ('ingredient_batch_weights', 'id'),
      ('inventory_items', 'id'),
      ('inventory_ledger', 'id'),
      ('inventory_locations', 'id'),
      ('inventory_lots', 'id'),
      ('inventory_observations', 'id'),
      ('inventory_product_references', 'id'),
      ('master_data_operations', 'sequence'),
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
      ('sync_conflict_logs', 'id')
    ) AS columns_to_convert(table_name, column_name)
    ORDER BY table_name
  LOOP
    IF to_regclass(format('public.%I', target.table_name)) IS NULL THEN
      CONTINUE;
    END IF;
    EXECUTE format('LOCK TABLE public.%I IN ACCESS EXCLUSIVE MODE', target.table_name);

    SELECT a.attidentity, a.atttypid, pg_get_expr(d.adbin, d.adrelid)
      INTO STRICT identity_kind, column_type, default_expression
    FROM pg_attribute a
    LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
    WHERE a.attrelid = format('public.%I', target.table_name)::regclass
      AND a.attname = target.column_name AND NOT a.attisdropped;

    -- Reruns never rebase an identity sequence or recreate its grants.
    IF identity_kind = 'd' THEN
      CONTINUE;
    ELSIF identity_kind <> '' THEN
      RAISE EXCEPTION 'Unsupported identity mode for %.%', target.table_name, target.column_name;
    END IF;

    sequence_oid := pg_get_serial_sequence(
      format('public.%I', target.table_name), target.column_name
    )::regclass;
    IF sequence_oid IS NULL THEN
      RAISE EXCEPTION 'Missing owned serial generator for %.%', target.table_name, target.column_name;
    END IF;
    sequence_name := target.table_name || '_' || target.column_name || '_seq';
    IF sequence_oid <> to_regclass(format('public.%I', sequence_name)) THEN
      RAISE EXCEPTION 'Unexpected sequence name for %.%', target.table_name, target.column_name;
    END IF;
    IF default_expression IS DISTINCT FROM format('nextval(%L::regclass)', sequence_oid::text) THEN
      RAISE EXCEPTION 'Unexpected serial default for %.%', target.table_name, target.column_name;
    END IF;

    SELECT s.*, c.relacl, c.relowner,
      (SELECT relowner FROM pg_class
       WHERE oid = format('public.%I', target.table_name)::regclass) AS table_owner
      INTO STRICT generator
    FROM pg_sequence s JOIN pg_class c ON c.oid = s.seqrelid
    WHERE s.seqrelid = sequence_oid;
    IF generator.seqtypid <> column_type
       OR generator.seqincrement <> 1 OR generator.seqmin <> 1
       OR generator.seqcycle OR generator.relowner <> generator.table_owner THEN
      RAISE EXCEPTION 'Unexpected generator configuration for %.%', target.table_name, target.column_name;
    END IF;

    EXECUTE format('SELECT last_value, is_called FROM %s', sequence_oid)
      INTO last_id, was_called;
    EXECUTE format(
      'SELECT count(*), max(%I), coalesce(sum(hashtextextended(row_to_json(t)::text, 0)::numeric), 0) FROM public.%I t',
      target.column_name, target.table_name
    ) INTO rows_before, maximum_id, hash_before;

    -- Free the conventional name for the new identity sequence while retaining
    -- the old sequence until counter and grant metadata have been copied.
    backup_name := left(sequence_name, 45) || '_pre_identity';
    IF to_regclass(format('public.%I', backup_name)) IS NOT NULL THEN
      RAISE EXCEPTION 'Backup sequence already exists for %.%', target.table_name, target.column_name;
    END IF;
    EXECUTE format('ALTER SEQUENCE %s RENAME TO %I', sequence_oid, backup_name);
    EXECUTE format('ALTER SEQUENCE public.%I OWNED BY NONE', backup_name);
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I DROP DEFAULT',
      target.table_name, target.column_name);
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I ADD GENERATED BY DEFAULT AS IDENTITY',
      target.table_name, target.column_name);

    -- Preserve both issued values (including deleted rows and advanced empty
    -- tables) and explicit IDs beyond the old high-water mark.
    IF maximum_id IS NOT NULL AND
       (maximum_id > last_id OR (maximum_id = last_id AND NOT was_called)) THEN
      last_id := maximum_id;
      was_called := true;
    END IF;
    PERFORM setval(format('public.%I', sequence_name)::regclass, last_id, was_called);
    EXECUTE format('ALTER SEQUENCE public.%I OWNER TO %I',
      sequence_name, pg_get_userbyid(generator.relowner));

    FOR permission IN SELECT * FROM aclexplode(generator.relacl) LOOP
      IF permission.privilege_type NOT IN ('SELECT', 'UPDATE', 'USAGE') THEN
        RAISE EXCEPTION 'Unexpected sequence privilege for %.%', target.table_name, target.column_name;
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

    -- An external dependency still pointing at the old sequence fails here and
    -- rolls back every conversion instead of leaving a partially migrated schema.
    EXECUTE format('DROP SEQUENCE public.%I', backup_name);
  END LOOP;
END
$migration$;
