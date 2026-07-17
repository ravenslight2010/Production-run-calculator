---
name: wrong-number-triage
description: Trace where a wrong number on screen comes from. Use when the user reports a specific wrong value ("it says 5.7 but should be 8.25", "wrong yield", "wrong batch count") anywhere in the web app.
---

# Wrong-Number Triage

A number on screen flows through layers. Find which layer holds the wrong value BEFORE changing code — the fix differs completely per layer.

## The chain (check in order)

1. **Live form / day-state** — the open run form; synced via `daily_sync` (data->runValues jsonb). Some values are DERIVED, not stored (e.g. dough batch yield derives from dough rows lbs ÷ doughball weight when both present, and the form auto-zeroes the stored fallback).
2. **Profile** — `brand_profiles.values` jsonb (server pool, LWW-stamped). Loaded into the form on brand+flavor pick.
   ```sql
   select brand, flavor, (values::jsonb)->>'<field>' from brand_profiles where brand ilike '%X%';
   ```
3. **Recipe pool** — `dough_recipes` / `sauce_recipes` / `cheese_recipes` / `mixes`. Dough recipes carry `doughballVariants` (per-customer weight/per-tray) — recipe-level numbers belong to no particular customer.
4. **Saved spec sheet** — `saved_spec_sheets.data` (the parse). Dough mixing sheets have MANY same-named variant rows; check the row for THIS customer's variantLabel, not the last row.
5. **Auto-Fill planner** — `artifacts/run-calculator/src/profileAutofill.ts` combines sheets + pools into fills/mismatches; must mirror the real import's blank-fill rules.

## Diagnosis rules

- Compare each layer's value to the expected one; the FIRST wrong layer is the culprit; everything downstream is just displaying it.
- If the sheet is right but the profile is wrong → import/apply bug (`storage.ts applySpecImport`) — see `import-bug-investigation`.
- If stored data is wrong in many rows → also needs a heal — see `data-heal-playbook`.
- If only the Auto-Fill suggestion is wrong (stored data fine) → planner-only fix in `profileAutofill.ts`.
- Formulas live in `lib/*` (inventory-math etc.) — if the derivation itself is wrong, fix the lib, never the app inline.

Relevant memories: `profile-autofill-from-saved-sheets.md`, `doughball-variants.md`, `brand-profile-server-pool.md`, `dough-weight-server-pool.md`.
