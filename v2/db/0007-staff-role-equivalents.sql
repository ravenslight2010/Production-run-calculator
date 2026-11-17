BEGIN;

-- Least-privilege V2 equivalents for the two reviewed V1 custom role names.
-- Keep these capability lists aligned with the domain-owned V2 workflows.
INSERT INTO v2.roles (name, capabilities, builtin)
VALUES
  (
    'qc-manager',
    '["use-ai-tools","review-incidents","manage-allergens","record-qc","manage-qc"]'::jsonb,
    false
  ),
  (
    'warehouse',
    '["manage-inventory"]'::jsonb,
    false
  )
ON CONFLICT (name) DO NOTHING;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM (
      VALUES
        (
          'qc-manager'::text,
          '["use-ai-tools","review-incidents","manage-allergens","record-qc","manage-qc"]'::jsonb
        ),
        (
          'warehouse'::text,
          '["manage-inventory"]'::jsonb
        )
    ) AS expected(name, capabilities)
    LEFT JOIN v2.roles AS actual ON actual.name = expected.name
    WHERE actual.name IS NULL
       OR actual.builtin IS DISTINCT FROM false
       OR actual.capabilities IS DISTINCT FROM expected.capabilities
  ) THEN
    RAISE EXCEPTION 'V2 staff role equivalents conflict with the reviewed capability mapping';
  END IF;
END
$$;

COMMIT;
