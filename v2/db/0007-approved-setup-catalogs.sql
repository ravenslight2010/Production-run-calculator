BEGIN;

CREATE TABLE v2.setup_catalog_imports (
  facility_id uuid NOT NULL REFERENCES v2.facility_scope (facility_id) ON DELETE RESTRICT,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  actor_id uuid NOT NULL,
  request_id text NOT NULL CHECK (length(btrim(request_id)) BETWEEN 1 AND 200),
  request_hash text NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  family text NOT NULL CHECK (family IN (
    'ingredients', 'mixes', 'die-types', 'die-line-defaults', 'production-rules',
    'freezer-pull-items', 'run-templates', 'manager-lists', 'aliases'
  )),
  records jsonb NOT NULL CHECK (jsonb_typeof(records) = 'array'
    AND jsonb_array_length(records) BETWEEN 1 AND 2000),
  status text NOT NULL DEFAULT 'staged' CHECK (status IN ('staged', 'applied', 'undone')),
  before_snapshot jsonb,
  after_snapshot jsonb,
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  applied_at timestamptz,
  undone_at timestamptz,
  PRIMARY KEY (facility_id, id),
  UNIQUE (facility_id, actor_id, request_id),
  CHECK ((status = 'staged') = (applied_at IS NULL)),
  CHECK ((status = 'undone') = (undone_at IS NOT NULL))
);

CREATE TABLE v2.setup_ingredient_records (
  facility_id uuid NOT NULL REFERENCES v2.facility_scope (facility_id) ON DELETE RESTRICT,
  code text NOT NULL CHECK (code ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$'),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 200),
  data jsonb NOT NULL CHECK (jsonb_typeof(data) = 'object'),
  merged_into_code text GENERATED ALWAYS AS (NULLIF(data->>'mergedIntoCode', '')) STORED,
  source_import_id uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (facility_id, code),
  FOREIGN KEY (facility_id, merged_into_code)
    REFERENCES v2.setup_ingredient_records (facility_id, code)
    ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (facility_id, source_import_id)
    REFERENCES v2.setup_catalog_imports (facility_id, id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX setup_ingredient_code_folded ON v2.setup_ingredient_records(facility_id, lower(code));

CREATE TABLE v2.setup_mix_records (
  facility_id uuid NOT NULL REFERENCES v2.facility_scope (facility_id) ON DELETE RESTRICT,
  code text NOT NULL CHECK (code ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$'),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 200),
  data jsonb NOT NULL CHECK (jsonb_typeof(data) = 'object'),
  source_import_id uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (facility_id, code),
  FOREIGN KEY (facility_id, source_import_id)
    REFERENCES v2.setup_catalog_imports (facility_id, id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX setup_mix_code_folded ON v2.setup_mix_records(facility_id, lower(code));

CREATE TABLE v2.setup_mix_component_links (
  facility_id uuid NOT NULL,
  mix_code text NOT NULL,
  component_index integer NOT NULL CHECK (component_index >= 0),
  ingredient_code text NOT NULL,
  source_import_id uuid NOT NULL,
  PRIMARY KEY (facility_id, mix_code, component_index),
  FOREIGN KEY (facility_id, mix_code)
    REFERENCES v2.setup_mix_records (facility_id, code) ON DELETE CASCADE,
  FOREIGN KEY (facility_id, ingredient_code)
    REFERENCES v2.setup_ingredient_records (facility_id, code) ON DELETE RESTRICT,
  FOREIGN KEY (facility_id, source_import_id)
    REFERENCES v2.setup_catalog_imports (facility_id, id) ON DELETE RESTRICT
);

CREATE TABLE v2.setup_die_type_records (
  facility_id uuid NOT NULL REFERENCES v2.facility_scope (facility_id) ON DELETE RESTRICT,
  code text NOT NULL CHECK (code ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$'),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 200),
  data jsonb NOT NULL CHECK (jsonb_typeof(data) = 'object'),
  source_import_id uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (facility_id, code),
  FOREIGN KEY (facility_id, source_import_id)
    REFERENCES v2.setup_catalog_imports (facility_id, id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX setup_die_type_code_folded ON v2.setup_die_type_records(facility_id, lower(code));

CREATE TABLE v2.setup_die_default_records (
  facility_id uuid NOT NULL REFERENCES v2.facility_scope (facility_id) ON DELETE RESTRICT,
  code text NOT NULL CHECK (code ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$'),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 200),
  data jsonb NOT NULL CHECK (jsonb_typeof(data) = 'object'),
  source_import_id uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (facility_id, code),
  FOREIGN KEY (facility_id, code)
    REFERENCES v2.setup_die_type_records (facility_id, code) ON DELETE RESTRICT,
  FOREIGN KEY (facility_id, source_import_id)
    REFERENCES v2.setup_catalog_imports (facility_id, id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX setup_die_default_code_folded ON v2.setup_die_default_records(facility_id, lower(code));

CREATE TABLE v2.setup_production_rule_records (
  facility_id uuid NOT NULL REFERENCES v2.facility_scope (facility_id) ON DELETE RESTRICT,
  code text NOT NULL CHECK (code ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$'),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 200),
  data jsonb NOT NULL CHECK (jsonb_typeof(data) = 'object'),
  source_import_id uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (facility_id, code),
  FOREIGN KEY (facility_id, source_import_id)
    REFERENCES v2.setup_catalog_imports (facility_id, id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX setup_production_rule_code_folded ON v2.setup_production_rule_records(facility_id, lower(code));

CREATE TABLE v2.setup_freezer_pull_records (
  facility_id uuid NOT NULL REFERENCES v2.facility_scope (facility_id) ON DELETE RESTRICT,
  code text NOT NULL CHECK (code ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$'),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 200),
  data jsonb NOT NULL CHECK (jsonb_typeof(data) = 'object'),
  ingredient_code text GENERATED ALWAYS AS (NULLIF(data->>'ingredientCode', '')) STORED,
  source_import_id uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (facility_id, code),
  FOREIGN KEY (facility_id, ingredient_code)
    REFERENCES v2.setup_ingredient_records (facility_id, code) ON DELETE RESTRICT,
  FOREIGN KEY (facility_id, source_import_id)
    REFERENCES v2.setup_catalog_imports (facility_id, id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX setup_freezer_pull_code_folded ON v2.setup_freezer_pull_records(facility_id, lower(code));

CREATE TABLE v2.setup_run_template_records (
  facility_id uuid NOT NULL REFERENCES v2.facility_scope (facility_id) ON DELETE RESTRICT,
  code text NOT NULL CHECK (code ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$'),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 200),
  data jsonb NOT NULL CHECK (jsonb_typeof(data) = 'object'),
  source_import_id uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (facility_id, code),
  FOREIGN KEY (facility_id, source_import_id)
    REFERENCES v2.setup_catalog_imports (facility_id, id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX setup_run_template_code_folded ON v2.setup_run_template_records(facility_id, lower(code));

CREATE TABLE v2.setup_manager_list_records (
  facility_id uuid NOT NULL REFERENCES v2.facility_scope (facility_id) ON DELETE RESTRICT,
  code text NOT NULL CHECK (code ~ '^run-calc-[a-z-]{1,80}$'),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 200),
  data jsonb NOT NULL CHECK (jsonb_typeof(data) = 'object'),
  source_import_id uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (facility_id, code),
  FOREIGN KEY (facility_id, source_import_id)
    REFERENCES v2.setup_catalog_imports (facility_id, id) ON DELETE RESTRICT
);

CREATE TABLE v2.setup_alias_records (
  facility_id uuid NOT NULL REFERENCES v2.facility_scope (facility_id) ON DELETE RESTRICT,
  code text NOT NULL CHECK (code ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$'),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 200),
  data jsonb NOT NULL CHECK (jsonb_typeof(data) = 'object'),
  source_import_id uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (facility_id, code),
  FOREIGN KEY (facility_id, source_import_id)
    REFERENCES v2.setup_catalog_imports (facility_id, id) ON DELETE RESTRICT
);

CREATE FUNCTION v2.setup_catalog_table_name(p_family text)
RETURNS text
LANGUAGE sql
IMMUTABLE
STRICT
AS $$
  SELECT CASE p_family
    WHEN 'ingredients' THEN 'setup_ingredient_records'
    WHEN 'mixes' THEN 'setup_mix_records'
    WHEN 'die-types' THEN 'setup_die_type_records'
    WHEN 'die-line-defaults' THEN 'setup_die_default_records'
    WHEN 'production-rules' THEN 'setup_production_rule_records'
    WHEN 'freezer-pull-items' THEN 'setup_freezer_pull_records'
    WHEN 'run-templates' THEN 'setup_run_template_records'
    WHEN 'manager-lists' THEN 'setup_manager_list_records'
    WHEN 'aliases' THEN 'setup_alias_records'
    ELSE NULL
  END
$$;

CREATE FUNCTION v2.setup_catalog_object_size(p_value jsonb)
RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE WHEN jsonb_typeof(p_value) = 'object'
    THEN (SELECT count(*)::integer FROM jsonb_object_keys(p_value))
    ELSE -1
  END
$$;

CREATE FUNCTION v2.stage_setup_catalog_import(
  p_facility_id uuid, p_actor_id uuid, p_request_id text, p_request_hash text,
  p_family text, p_records jsonb, p_source_summary jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, v2
AS $$
DECLARE
  v_existing v2.setup_catalog_imports%ROWTYPE;
  v_id uuid;
  v_row jsonb;
  v_stage_result jsonb;
BEGIN
  IF p_facility_id IS NULL OR p_actor_id IS NULL
     OR NOT EXISTS (SELECT 1 FROM v2.facility_scope WHERE singleton AND facility_id = p_facility_id)
     OR p_request_id IS NULL OR length(btrim(p_request_id)) NOT BETWEEN 1 AND 200
     OR p_request_hash IS NULL OR p_request_hash !~ '^[0-9a-f]{64}$'
     OR v2.setup_catalog_table_name(p_family) IS NULL
     OR jsonb_typeof(p_records) <> 'array'
     OR jsonb_array_length(p_records) NOT BETWEEN 1 AND 2000 THEN
    RAISE EXCEPTION 'Invalid setup catalog import' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(
    p_facility_id::text || ':' || p_actor_id::text || ':' || p_request_id, 0
  ));
  SELECT * INTO v_existing FROM v2.setup_catalog_imports
  WHERE facility_id = p_facility_id AND actor_id = p_actor_id AND request_id = p_request_id
  FOR UPDATE;
  IF FOUND THEN
    IF v_existing.request_hash <> p_request_hash OR v_existing.family <> p_family THEN
      RAISE EXCEPTION 'Import request ID was reused with different details' USING ERRCODE = '22023';
    END IF;
    RETURN jsonb_build_object(
      'outcome', v_existing.status, 'importId', v_existing.id, 'family', v_existing.family,
      'rowCount', jsonb_array_length(v_existing.records), 'replayed', true, 'result', v_existing.result,
      'sourceSummary', v_existing.result->'sourceSummary'
    );
  END IF;
  IF p_source_summary IS NOT NULL AND (
    v2.setup_catalog_object_size(p_source_summary) <> 7
    OR NOT (p_source_summary ?& ARRAY[
      'sourceFamily','sourceSha256','parserVersion','sourceRows',
      'importedRows','skippedRows','unresolvedRows'
    ])
    OR p_source_summary->>'sourceFamily' NOT IN (
      'spec-sheets','premix-sheets','cheese-mix-specs',
      'shipping-guides','sauce-guides','dough-guides'
    )
    OR p_source_summary->>'sourceSha256' !~ '^[0-9a-f]{64}$'
    OR p_source_summary->>'parserVersion' <> 'v1-source-import/1'
    OR jsonb_typeof(p_source_summary->'sourceRows') <> 'number'
    OR jsonb_typeof(p_source_summary->'importedRows') <> 'number'
    OR jsonb_typeof(p_source_summary->'skippedRows') <> 'number'
    OR jsonb_typeof(p_source_summary->'unresolvedRows') <> 'number'
    OR (p_source_summary->>'sourceRows')::numeric NOT BETWEEN 0 AND 2000
    OR (p_source_summary->>'importedRows')::numeric <> jsonb_array_length(p_records)
    OR (p_source_summary->>'skippedRows')::numeric NOT BETWEEN 0 AND 2000
    OR (p_source_summary->>'unresolvedRows')::numeric NOT BETWEEN 0 AND 2000
    OR ((p_source_summary->>'sourceRows')::numeric % 1) <> 0
    OR ((p_source_summary->>'importedRows')::numeric % 1) <> 0
    OR ((p_source_summary->>'skippedRows')::numeric % 1) <> 0
    OR ((p_source_summary->>'unresolvedRows')::numeric % 1) <> 0
    OR ((p_source_summary->>'sourceFamily' = 'premix-sheets') <> (p_family = 'mixes'))
    OR (p_source_summary->>'sourceFamily' <> 'premix-sheets' AND p_family <> 'run-templates')
  ) THEN
    RAISE EXCEPTION 'Invalid source import summary' USING ERRCODE = '22023';
  END IF;
  FOR v_row IN SELECT value FROM jsonb_array_elements(p_records) LOOP
    IF jsonb_typeof(v_row) <> 'object' OR v2.setup_catalog_object_size(v_row) <> 3
       OR NOT (v_row ?& ARRAY['code', 'name', 'data'])
       OR jsonb_typeof(v_row->'code') <> 'string'
       OR jsonb_typeof(v_row->'name') <> 'string'
       OR jsonb_typeof(v_row->'data') <> 'object'
       OR length(btrim(v_row->>'code')) NOT BETWEEN 1 AND 80
       OR length(btrim(v_row->>'name')) NOT BETWEEN 1 AND 200 THEN
      RAISE EXCEPTION 'Setup catalog row has an invalid shape' USING ERRCODE = '22023';
    END IF;
    IF
      (p_family = 'ingredients' AND (
        v2.setup_catalog_object_size(v_row->'data') <> 5
        OR NOT ((v_row->'data') ?& ARRAY['categories','allergens','allergensReviewed','mergedIntoCode','enabled'])
        OR jsonb_typeof(v_row->'data'->'categories') <> 'array'
        OR jsonb_typeof(v_row->'data'->'allergens') <> 'array'
        OR jsonb_typeof(v_row->'data'->'allergensReviewed') <> 'boolean'
        OR jsonb_typeof(v_row->'data'->'enabled') <> 'boolean'
      ))
      OR (p_family = 'mixes' AND (
        v2.setup_catalog_object_size(v_row->'data') <> 8
        OR NOT ((v_row->'data') ?& ARRAY['brand','flavor','batchSizeLbs','daysEarly','notes','isPrep','enabled','components'])
        OR jsonb_typeof(v_row->'data'->'components') <> 'array'
        OR jsonb_typeof(v_row->'data'->'isPrep') <> 'boolean'
        OR jsonb_typeof(v_row->'data'->'enabled') <> 'boolean'
      ))
      OR (p_family = 'die-types' AND v2.setup_catalog_object_size(v_row->'data') <> 0)
      OR (p_family = 'die-line-defaults' AND (
        v2.setup_catalog_object_size(v_row->'data') <> 9
        OR NOT ((v_row->'data') ?& ARRAY[
          'crusts_per_cycle','cycle_speed','speed_adjustment','freezer_time','cases_per_layer',
          'pre_tunnel_min','post_tunnel_min','press_oven_min','frontline_min'
        ])
      ))
      OR (p_family = 'production-rules' AND (
        v2.setup_catalog_object_size(v_row->'data') <> 11
        OR NOT ((v_row->'data') ?& ARRAY[
          'type','enforcement','enabled','field','min','max','attribute','before','after','bypass','checklist'
        ])
        OR v_row->'data'->>'type' NOT IN ('required-field','numeric-range','sequence')
        OR v_row->'data'->>'enforcement' NOT IN ('flexible','strict')
        OR jsonb_typeof(v_row->'data'->'enabled') <> 'boolean'
        OR jsonb_typeof(v_row->'data'->'bypass') <> 'array'
        OR jsonb_typeof(v_row->'data'->'checklist') <> 'array'
      ))
      OR (p_family = 'freezer-pull-items' AND (
        v2.setup_catalog_object_size(v_row->'data') <> 4
        OR NOT ((v_row->'data') ?& ARRAY['ingredientName','ingredientCode','daysEarly','enabled'])
        OR jsonb_typeof(v_row->'data'->'ingredientName') <> 'string'
        OR jsonb_typeof(v_row->'data'->'daysEarly') <> 'number'
        OR jsonb_typeof(v_row->'data'->'enabled') <> 'boolean'
      ))
      OR (p_family = 'run-templates' AND (
        v2.setup_catalog_object_size(v_row->'data') <> 3
        OR NOT ((v_row->'data') ?& ARRAY['brand','flavor','values'])
        OR jsonb_typeof(v_row->'data'->'values') <> 'object'
        OR EXISTS (
          SELECT 1 FROM jsonb_object_keys(v_row->'data'->'values') AS field(key)
          WHERE field.key <> ALL (ARRAY[
            'crustsPerCycle','cycleSpeed','speedAdjustment','approxLineSpeed','freezerTime','pizzasPerCase',
            'casesPerSkid','casesPerLayer','doughballsPerTray','crustsPerStack','doughBatchYield','crustsPerCase',
            'mixerLowSec','mixerHighSec','hopperSec','sauceOzPerPizza','sauceBarrelLbs',
            'app1OzPerPizza','app1BatchLbs','app2OzPerPizza','app2BatchLbs','app3OzPerPizza','app3BatchLbs',
            'app4OzPerPizza','app4BatchLbs','pep1Sticks','pep1OzPerPizza','pep1BatchLbs','pep2Sticks',
            'pep2OzPerPizza','pep2BatchLbs','pep1SticksB','pep1OzPerPizzaB','pep1BatchLbsB',
            'pep2SticksB','pep2OzPerPizzaB','pep2BatchLbsB','pep1Combined','app1Type','app2Type','app3Type',
            'app4Type','pep1Type','pep2Type','pep1TypeB','pep2TypeB','dieType','allergen','doughRecipeName',
            'targetDoughballWeight','doughRecipe','app1CheeseRecipeName','app1CheeseRecipe',
            'app2CheeseRecipeName','app2CheeseRecipe','app3CheeseRecipeName','app3CheeseRecipe',
            'app4CheeseRecipeName','app4CheeseRecipe','frontlineRecipeName','frontlineRecipe','cartoned',
            'labelPosition','cartonsPerCase','cartonSize','labelsPerRoll','topLabelsPerRoll',
            'bottomLabelsPerRoll','circles','shipper','skidStacking','gripSheets','slipSheets',
            'preTunnelMin','pressOvenMin','frontlineMin','postTunnelMin'
          ])
        )
      ))
      OR (p_family = 'manager-lists' AND (
        v2.setup_catalog_object_size(v_row->'data') <> 2
        OR NOT ((v_row->'data') ?& ARRAY['key','value'])
        OR v_row->'data'->>'key' <> v_row->>'code'
        OR v_row->>'code' <> ALL (ARRAY[
          'run-calc-brands','run-calc-brand-flavors','run-calc-flavors','run-calc-ingredient-types','run-calc-pep-types',
          'run-calc-die-types','run-calc-cheese-ingredients','run-calc-dough-ingredients',
          'run-calc-frontline-ingredients','run-calc-mix-ingredients','run-calc-dough-recipe-names',
          'run-calc-dough-recipe-presets','run-calc-frontline-recipe-names','run-calc-frontline-recipe-presets',
          'run-calc-cheese-recipe-names','run-calc-cheese-recipe-presets','run-calc-mix-recipe-names',
          'run-calc-stop-reasons','run-calc-circles','run-calc-shippers','run-calc-skid-stacking',
          'run-calc-grip-sheets','run-calc-shift-start-time','run-calc-production-start-time'
        ])
      ))
      OR (p_family = 'aliases' AND (
        v2.setup_catalog_object_size(v_row->'data') <> 6
        OR NOT ((v_row->'data') ?& ARRAY['aliasType','kind','externalName','canonicalName','context','brand'])
        OR v_row->'data'->>'aliasType' NOT IN ('spec','merge')
        OR jsonb_typeof(v_row->'data'->'externalName') <> 'string'
        OR jsonb_typeof(v_row->'data'->'canonicalName') <> 'string'
      ))
    THEN
      RAISE EXCEPTION 'Setup catalog data is outside the approved family field map' USING ERRCODE = '22023';
    END IF;
  END LOOP;
  IF (SELECT count(DISTINCT lower(value->>'code')) FROM jsonb_array_elements(p_records))
     <> jsonb_array_length(p_records) THEN
    RAISE EXCEPTION 'Import contains duplicate codes' USING ERRCODE = '22023';
  END IF;
  v_stage_result := CASE WHEN p_source_summary IS NULL THEN NULL
    ELSE jsonb_build_object('sourceSummary', p_source_summary) END;
  INSERT INTO v2.setup_catalog_imports(
    facility_id, actor_id, request_id, request_hash, family, records, result
  )
  VALUES (p_facility_id, p_actor_id, p_request_id, p_request_hash, p_family, p_records, v_stage_result)
  RETURNING id INTO v_id;
  RETURN jsonb_build_object(
    'outcome', 'staged', 'importId', v_id, 'family', p_family,
    'rowCount', jsonb_array_length(p_records), 'replayed', false,
    'sourceSummary', p_source_summary
  );
END
$$;

CREATE FUNCTION v2.apply_setup_catalog_import(p_facility_id uuid, p_actor_id uuid, p_import_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, v2
AS $$
DECLARE
  v_import v2.setup_catalog_imports%ROWTYPE;
  v_table text;
  v_row jsonb;
  v_old jsonb;
  v_new jsonb;
  v_before jsonb := '[]'::jsonb;
  v_after jsonb := '[]'::jsonb;
  v_now timestamptz;
  v_result jsonb;
  v_component jsonb;
  v_component_index integer;
  v_ingredient_code text;
  v_created_count integer := 0;
  v_updated_count integer := 0;
BEGIN
  IF p_facility_id IS NULL OR p_actor_id IS NULL OR p_import_id IS NULL
     OR NOT EXISTS (SELECT 1 FROM v2.facility_scope WHERE singleton AND facility_id = p_facility_id) THEN
    RAISE EXCEPTION 'Invalid setup catalog scope' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_import FROM v2.setup_catalog_imports
  WHERE facility_id = p_facility_id AND id = p_import_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Import not found' USING ERRCODE = 'P0002'; END IF;
  IF v_import.status = 'applied' THEN
    RETURN COALESCE(v_import.result, '{}'::jsonb) || jsonb_build_object('replayed', true);
  END IF;
  IF v_import.status <> 'staged' THEN
    RAISE EXCEPTION 'Import cannot be applied in its current state' USING ERRCODE = '55000';
  END IF;
  v_table := v2.setup_catalog_table_name(v_import.family);
  v_now := clock_timestamp();
  FOR v_row IN SELECT value FROM jsonb_array_elements(v_import.records) LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended(
      p_facility_id::text || ':' || v_import.family || ':' || lower(v_row->>'code'), 0
    ));
    EXECUTE format(
      'SELECT to_jsonb(t) FROM v2.%I AS t WHERE t.facility_id = $1 AND lower(t.code) = lower($2) FOR UPDATE',
      v_table
    ) INTO v_old USING p_facility_id, v_row->>'code';
    IF v_import.family = 'die-line-defaults' AND NOT EXISTS (
      SELECT 1 FROM v2.setup_die_type_records
      WHERE facility_id = p_facility_id AND lower(code) = lower(v_row->>'code')
    ) THEN
      RAISE EXCEPTION 'Import references an unknown die type; import die types first' USING ERRCODE = '23503';
    END IF;
    IF v_import.family = 'mixes' THEN
      DELETE FROM v2.setup_mix_component_links
      WHERE facility_id = p_facility_id AND lower(mix_code) = lower(v_row->>'code');
    END IF;
    IF v_old IS NULL THEN
      v_created_count := v_created_count + 1;
      EXECUTE format(
        'INSERT INTO v2.%I (facility_id, code, name, data, source_import_id, updated_at) ' ||
        'VALUES ($1, $2, $3, $4, $5, $6)',
        v_table
      ) USING p_facility_id, v_row->>'code', v_row->>'name', v_row->'data', p_import_id, v_now;
    ELSE
      v_updated_count := v_updated_count + 1;
      EXECUTE format(
        'UPDATE v2.%I SET name = $1, data = $2, source_import_id = $3, updated_at = $4 ' ||
        'WHERE facility_id = $5 AND lower(code) = lower($6)',
        v_table
      ) USING v_row->>'name', v_row->'data', p_import_id, v_now,
        p_facility_id, v_row->>'code';
    END IF;
    IF v_import.family = 'mixes' THEN
      v_component_index := 0;
      FOR v_component IN SELECT value FROM jsonb_array_elements(v_row->'data'->'components') LOOP
        IF jsonb_typeof(v_component) <> 'object' THEN
          RAISE EXCEPTION 'Mix component has an invalid field map' USING ERRCODE = '22023';
        END IF;
        IF EXISTS (
          SELECT 1 FROM jsonb_object_keys(v_component) AS item(key)
          WHERE item.key <> ALL (ARRAY['ingredientName','ingredientCode','perPizzaOz','perBatchLbs'])
        ) OR jsonb_typeof(v_component->'ingredientName') <> 'string'
          OR length(btrim(v_component->>'ingredientName')) = 0
          OR (v_component->>'perPizzaOz' IS NULL AND v_component->>'perBatchLbs' IS NULL)
          OR (v_component->>'perPizzaOz' IS NOT NULL AND (
            jsonb_typeof(v_component->'perPizzaOz') <> 'number'
            OR (v_component->>'perPizzaOz')::numeric < 0
          ))
          OR (v_component->>'perBatchLbs' IS NOT NULL AND (
            jsonb_typeof(v_component->'perBatchLbs') <> 'number'
            OR (v_component->>'perBatchLbs')::numeric < 0
          )) THEN
          RAISE EXCEPTION 'Mix component has an invalid field map' USING ERRCODE = '22023';
        END IF;
        IF v_component->>'ingredientCode' IS NOT NULL
           AND v_component->'ingredientCode' <> 'null'::jsonb THEN
          SELECT code INTO v_ingredient_code
          FROM v2.setup_ingredient_records
          WHERE facility_id = p_facility_id
            AND lower(code) = lower(v_component->>'ingredientCode');
          IF NOT FOUND THEN
            RAISE EXCEPTION 'Mix references an unknown ingredient identity' USING ERRCODE = '23503';
          END IF;
          INSERT INTO v2.setup_mix_component_links (
            facility_id, mix_code, component_index, ingredient_code, source_import_id
          ) VALUES (
            p_facility_id, v_row->>'code', v_component_index, v_ingredient_code, p_import_id
          );
        END IF;
        v_component_index := v_component_index + 1;
      END LOOP;
    END IF;
    EXECUTE format(
      'SELECT to_jsonb(t) FROM v2.%I AS t WHERE t.facility_id = $1 AND lower(t.code) = lower($2)',
      v_table
    ) INTO v_new USING p_facility_id, v_row->>'code';
    v_before := v_before || jsonb_build_array(jsonb_build_object('code', v_row->>'code', 'data', v_old));
    v_after := v_after || jsonb_build_array(jsonb_build_object('code', v_row->>'code', 'data', v_new));
  END LOOP;
  v_result := jsonb_build_object(
    'outcome', 'applied', 'importId', p_import_id, 'family', v_import.family,
    'rowCount', jsonb_array_length(v_import.records), 'createdCount', v_created_count,
    'updatedCount', v_updated_count, 'appliedAt', v_now, 'replayed', false
  ) || COALESCE(
    CASE WHEN v_import.result ? 'sourceSummary'
      THEN jsonb_build_object('sourceSummary', v_import.result->'sourceSummary')
      ELSE NULL END,
    '{}'::jsonb
  );
  UPDATE v2.setup_catalog_imports
  SET status = 'applied', before_snapshot = v_before, after_snapshot = v_after,
      applied_at = v_now, result = v_result
  WHERE facility_id = p_facility_id AND id = p_import_id;
  RETURN v_result;
END
$$;

CREATE FUNCTION v2.undo_setup_catalog_import(p_facility_id uuid, p_actor_id uuid, p_import_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, v2
AS $$
DECLARE
  v_import v2.setup_catalog_imports%ROWTYPE;
  v_table text;
  v_after jsonb;
  v_before jsonb;
  v_current jsonb;
  v_component jsonb;
  v_component_index integer;
  v_ingredient_code text;
  v_expected_links integer;
  v_actual_links integer;
  v_now timestamptz;
  v_result jsonb;
BEGIN
  IF p_facility_id IS NULL OR p_actor_id IS NULL OR p_import_id IS NULL
     OR NOT EXISTS (SELECT 1 FROM v2.facility_scope WHERE singleton AND facility_id = p_facility_id) THEN
    RAISE EXCEPTION 'Invalid setup catalog scope' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_import FROM v2.setup_catalog_imports
  WHERE facility_id = p_facility_id AND id = p_import_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Import not found' USING ERRCODE = 'P0002'; END IF;
  IF v_import.status = 'undone' THEN
    RETURN COALESCE(v_import.result, '{}'::jsonb) || jsonb_build_object('outcome', 'undone', 'replayed', true);
  END IF;
  IF v_import.status <> 'applied' THEN
    RAISE EXCEPTION 'Only an applied import can be undone' USING ERRCODE = '55000';
  END IF;
  v_table := v2.setup_catalog_table_name(v_import.family);
  FOR v_after IN SELECT value FROM jsonb_array_elements(v_import.after_snapshot) LOOP
    SELECT NULLIF(value->'data', 'null'::jsonb) INTO v_before
    FROM jsonb_array_elements(v_import.before_snapshot)
    WHERE lower(value->>'code') = lower(v_after->>'code');
    EXECUTE format(
      'SELECT to_jsonb(t) FROM v2.%I AS t WHERE t.facility_id = $1 AND lower(t.code) = lower($2) FOR UPDATE',
      v_table
    ) INTO v_current USING p_facility_id, v_after->>'code';
    IF v_current IS NULL OR v_current->>'source_import_id' <> p_import_id::text
       OR v_current IS DISTINCT FROM v_after->'data' THEN
      RAISE EXCEPTION 'A setup record changed after this import; undo is blocked' USING ERRCODE = '40001';
    END IF;
    IF v_import.family = 'mixes' THEN
      SELECT count(*) INTO v_expected_links
      FROM jsonb_array_elements(v_after->'data'->'data'->'components') AS component(value)
      WHERE component.value->>'ingredientCode' IS NOT NULL;
      SELECT count(*) INTO v_actual_links FROM v2.setup_mix_component_links
      WHERE facility_id = p_facility_id AND lower(mix_code) = lower(v_after->>'code')
        AND source_import_id = p_import_id;
      IF v_expected_links <> v_actual_links OR EXISTS (
        SELECT 1
        FROM jsonb_array_elements(v_after->'data'->'data'->'components') WITH ORDINALITY AS expected(value, position)
        WHERE expected.value->>'ingredientCode' IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM v2.setup_mix_component_links AS link
            WHERE link.facility_id = p_facility_id
              AND lower(link.mix_code) = lower(v_after->>'code')
              AND link.component_index = expected.position - 1
              AND lower(link.ingredient_code) = lower(expected.value->>'ingredientCode')
              AND link.source_import_id = p_import_id
          )
      ) THEN
        RAISE EXCEPTION 'A mix ingredient link changed after this import; undo is blocked' USING ERRCODE = '40001';
      END IF;
    END IF;
    IF v_before IS NULL THEN
      IF v_import.family = 'ingredients' AND (
        EXISTS (
          SELECT 1 FROM v2.setup_mix_records AS mix
          CROSS JOIN LATERAL jsonb_array_elements(mix.data->'components') AS component(value)
          WHERE mix.facility_id = p_facility_id
            AND lower(component.value->>'ingredientCode') = lower(v_after->>'code')
        )
        OR EXISTS (
          SELECT 1 FROM v2.setup_freezer_pull_records AS pull
          WHERE pull.facility_id = p_facility_id
            AND lower(pull.data->>'ingredientCode') = lower(v_after->>'code')
        )
        OR EXISTS (
          SELECT 1 FROM v2.setup_ingredient_records AS ingredient
          WHERE ingredient.facility_id = p_facility_id
            AND lower(ingredient.data->>'mergedIntoCode') = lower(v_after->>'code')
        )
      ) THEN
        RAISE EXCEPTION 'An ingredient is referenced by another setup record; undo is blocked' USING ERRCODE = '40001';
      END IF;
      IF v_import.family = 'die-types' AND EXISTS (
        SELECT 1 FROM v2.setup_die_default_records AS defaults
        WHERE defaults.facility_id = p_facility_id
          AND lower(defaults.code) = lower(v_after->>'code')
      ) THEN
        RAISE EXCEPTION 'A die type is referenced by setup defaults; undo is blocked' USING ERRCODE = '40001';
      END IF;
      EXECUTE format(
        'DELETE FROM v2.%I WHERE facility_id = $1 AND lower(code) = lower($2) AND source_import_id = $3',
        v_table
      ) USING p_facility_id, v_after->>'code', p_import_id;
    ELSE
      IF v_import.family = 'mixes' THEN
        DELETE FROM v2.setup_mix_component_links
        WHERE facility_id = p_facility_id AND lower(mix_code) = lower(v_after->>'code');
      END IF;
      EXECUTE format(
        'UPDATE v2.%I SET code = $1, name = $2, data = $3, source_import_id = $4, updated_at = $5 ' ||
        'WHERE facility_id = $6 AND lower(code) = lower($7)',
        v_table
      ) USING v_before->>'code', v_before->>'name', v_before->'data',
        (v_before->>'source_import_id')::uuid, (v_before->>'updated_at')::timestamptz,
        p_facility_id, v_after->>'code';
      IF v_import.family = 'mixes' THEN
        DELETE FROM v2.setup_mix_component_links
        WHERE facility_id = p_facility_id AND lower(mix_code) = lower(v_after->>'code');
        v_component_index := 0;
        FOR v_component IN SELECT value FROM jsonb_array_elements(v_before->'data'->'components') LOOP
          IF v_component->>'ingredientCode' IS NOT NULL
             AND v_component->'ingredientCode' <> 'null'::jsonb THEN
            SELECT code INTO v_ingredient_code
            FROM v2.setup_ingredient_records
            WHERE facility_id = p_facility_id
              AND lower(code) = lower(v_component->>'ingredientCode');
            IF NOT FOUND THEN
              RAISE EXCEPTION 'The prior mix identity link is no longer available' USING ERRCODE = '40001';
            END IF;
            INSERT INTO v2.setup_mix_component_links (
              facility_id, mix_code, component_index, ingredient_code, source_import_id
            ) VALUES (
              p_facility_id, v_before->>'code', v_component_index, v_ingredient_code,
              (v_before->>'source_import_id')::uuid
            );
          END IF;
          v_component_index := v_component_index + 1;
        END LOOP;
      END IF;
    END IF;
  END LOOP;
  v_now := clock_timestamp();
  v_result := jsonb_build_object(
    'outcome', 'undone', 'importId', p_import_id, 'family', v_import.family,
    'rowCount', jsonb_array_length(v_import.records),
    'createdCount', COALESCE((v_import.result->>'createdCount')::integer, 0),
    'updatedCount', COALESCE((v_import.result->>'updatedCount')::integer, 0),
    'undoneAt', v_now, 'replayed', false
  ) || COALESCE(
    CASE WHEN v_import.result ? 'sourceSummary'
      THEN jsonb_build_object('sourceSummary', v_import.result->'sourceSummary')
      ELSE NULL END,
    '{}'::jsonb
  );
  UPDATE v2.setup_catalog_imports
  SET status = 'undone', undone_at = v_now, result = v_result
  WHERE facility_id = p_facility_id AND id = p_import_id;
  RETURN v_result;
END
$$;

CREATE FUNCTION v2.list_setup_catalog_imports(p_facility_id uuid, p_limit integer)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, v2
AS $$
BEGIN
  IF p_facility_id IS NULL
     OR NOT EXISTS (SELECT 1 FROM v2.facility_scope WHERE singleton AND facility_id = p_facility_id) THEN
    RAISE EXCEPTION 'Invalid setup catalog scope' USING ERRCODE = '42501';
  END IF;
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'Invalid setup catalog list request' USING ERRCODE = '22023';
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', id, 'family', family, 'status', status, 'rowCount', jsonb_array_length(records),
      'createdBy', actor_id, 'createdAt', created_at, 'appliedAt', applied_at, 'undoneAt', undone_at,
      'sourceSummary', result->'sourceSummary',
      'createdCount', (result->>'createdCount')::integer,
      'updatedCount', (result->>'updatedCount')::integer
    ) ORDER BY created_at DESC, id DESC)
    FROM (
      SELECT id, family, status, records, result, actor_id, created_at, applied_at, undone_at
      FROM v2.setup_catalog_imports WHERE facility_id = p_facility_id
      ORDER BY created_at DESC, id DESC LIMIT p_limit
    ) recent
  ), '[]'::jsonb);
END
$$;

CREATE FUNCTION v2.get_setup_catalog_import(p_facility_id uuid, p_import_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, v2
AS $$
DECLARE
  v_import v2.setup_catalog_imports%ROWTYPE;
BEGIN
  IF p_facility_id IS NULL OR p_import_id IS NULL
     OR NOT EXISTS (SELECT 1 FROM v2.facility_scope WHERE singleton AND facility_id = p_facility_id) THEN
    RAISE EXCEPTION 'Invalid setup catalog scope' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_import FROM v2.setup_catalog_imports
  WHERE facility_id = p_facility_id AND id = p_import_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN jsonb_build_object(
    'id', v_import.id, 'family', v_import.family, 'status', v_import.status, 'records', v_import.records,
    'rowCount', jsonb_array_length(v_import.records),
    'createdBy', v_import.actor_id, 'createdAt', v_import.created_at,
    'appliedAt', v_import.applied_at, 'undoneAt', v_import.undone_at,
    'sourceSummary', v_import.result->'sourceSummary',
    'createdCount', (v_import.result->>'createdCount')::integer,
    'updatedCount', (v_import.result->>'updatedCount')::integer
  );
END
$$;

REVOKE ALL ON ALL TABLES IN SCHEMA v2 FROM PUBLIC;
REVOKE ALL ON FUNCTION v2.setup_catalog_table_name(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION v2.setup_catalog_object_size(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION v2.stage_setup_catalog_import(uuid, uuid, text, text, text, jsonb, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION v2.apply_setup_catalog_import(uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION v2.undo_setup_catalog_import(uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION v2.list_setup_catalog_imports(uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION v2.get_setup_catalog_import(uuid, uuid) FROM PUBLIC;

COMMENT ON TABLE v2.setup_catalog_imports IS
  'Manager-reviewed V2-only imports for approved, schema-backed production setup families.';
COMMENT ON TABLE v2.setup_run_template_records IS
  'Allowlisted run-setup values only; live run state, counters, temporary overrides, and history are excluded.';

COMMIT;
