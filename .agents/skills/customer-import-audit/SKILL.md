---
name: customer-import-audit
description: Audit after importing a new customer's spec workbook. Use when the user imports a new brand/customer and wants confirmation everything landed right, or reports something off after a new-customer import.
---

# New-Customer Import Audit

Quick post-import sanity pass over what a new customer's workbook created.

## Checks (dev DB via `psql "$DATABASE_URL"`)

1. **Profiles created** — one per flavor:
   ```sql
   select brand, flavor, (values::jsonb)->>'dieType', (values::jsonb)->>'targetDoughballWeight',
          (values::jsonb)->>'doughRecipeName', (values::jsonb)->>'frontlineRecipeName'
   from brand_profiles where scope='live' and brand ilike '%<name>%';
   ```
2. **Weights sane per die size** — doughball weight should track the die (bigger die = heavier ball); a value matching ANOTHER customer's variant is the last-variant-wins smell.
3. **Links, not duplicates** — dough/sauce/cheese names in profiles should point at EXISTING pool recipes (`dough_recipes`, `sauce_recipes`, `cheese_recipes`), not near-duplicate new entries ("Spicy Cheese Mix" vs "Cheese Mix"). Check pool for new rows created by the import.
4. **No cross-brand collisions** — the new brand's rows didn't rename/re-scope another customer's pool entries; curated brands never get re-scoped.
5. **Applicator slots** — station order App 1, App 2, PEPS, App 3, App 4; pep rows landed in the right before/after slots; cheese cards link to real cheese recipes.
6. **Learned aliases** — new `spec_import_aliases` rows look sensible (no generic/digit-mismatch mappings).

## If something is off

Follow `import-bug-investigation` to classify the layer; if bad data landed, `data-heal-playbook`. Report findings to the user in plain language: what looks right, what needs a fix.
