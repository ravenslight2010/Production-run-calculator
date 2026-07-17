---
name: import-bug-investigation
description: Diagnose spec/premix/cheese/shipping Excel import bugs. Use when the user says an import got something wrong, mislinked, misnamed, duplicated, or skipped data. Standard drill for tracing what the parse saw vs what landed in profiles/pools.
---

# Import Bug Investigation

When an import "got it wrong," find WHICH layer is wrong before touching code: the AI parse (saved sheet), the apply/tie logic, the pool, or the profile.

## Drill

1. **Look at the saved parse first** — imports reuse saved parses (hash reuse), so the sheet shows exactly what the AI/parser produced:
   ```sql
   select id, label, created_at from saved_spec_sheets order by created_at desc limit 10;
   select r->>'kind', r->>'name', r->>'brand', r->>'variantLabel', r->>'doughballOz', r->>'doughBatchYield'
   from saved_spec_sheets, jsonb_array_elements(data->'recipes') r where id = <ID>;
   -- profiles block: jsonb_array_elements(data->'profiles')
   ```
   Also `saved_premix_sheets`, `saved_shipping_guides`.
2. **Compare against what landed:** `brand_profiles` (values jsonb), `dough_recipes`/`sauce_recipes`/`cheese_recipes`/`mixes` pools, learned aliases (`spec_import_aliases`, `import_aliases`).
3. **Classify:**
   - Parse wrong → prompt/pipeline fix in `lib/spec-import`; bump `SPEC_PARSE_VERSION` or stale parses resurrect.
   - Parse right, profile wrong → apply/tie bug in `artifacts/run-calculator/src/storage.ts` `applySpecImport`.
   - Pool wrong → link/dedupe pass (name-match, aliases).
4. **If bad data already landed**, follow the `data-heal-playbook` skill — code fix alone won't clear stored values.

## Sharp edges (check the memory topic files before assuming a bug)

- **Same-named variant rows:** dough mixing sheets carry MANY rows named alike (one per customer). Relinked ties are blank-fill-only for weight/per-tray/batch-yield; only anchored ties write verbatim.
- Dough family collapse: ONE recipe per family; variant names snap onto the base recipe.
- M&V/Cheese recipes are per-BATCH lbs; premix is per-pizza oz. Sauce == "frontline".
- Import order matters: spec → dough/sauce → cheese/premix; dedup keys differ (cheese exact, mix/dough/sauce loose).
- Aliases auto-apply with priority alias > AI > fuzzy; digit-mismatch/generic aliases are dropped at apply time.
- Relevant memories: `spec-import.md`, `import-order-dedup-keys.md`, `doughball-variants.md`, `spec-import-brand-backfill.md`, `dough-family-collapse.md`, `profile-autofill-from-saved-sheets.md`.
