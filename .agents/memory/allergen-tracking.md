---
name: Allergen tracking
description: Per-run allergen field + advisory food-safety warnings, web+mobile parity, client-only.
---

Per-run allergen (None/Egg/Soy) lives in shared pure lib `@workspace/allergen`
(type, ALLERGENS metadata incl. colors, normalizeAllergen, allergenMeta,
allergenTransitionWarning, allergenSequenceWarnings). Both apps consume the lib;
never hardcode colors or warning copy in the apps.

**Warning rules:** allergen→different = "clean" (thoroughly clean line);
allergen→none = "clean-not-advisable" (clean + allergen runs belong at end of
day); none→anything and same→same = none. Warnings are advisory only, never block.

**Why:** matches app's existing advisory philosophy; food-safety is operator
judgment, the app only surfaces sequence risk across the day's run order.

**How to apply:** allergen is client-only — server stores it inside the opaque
sync jsonb blob; do NOT add server/OpenAPI/db columns for it. Default "none".
Mobile stores it in RunSettings with additive normalizeSettings coercion
(normalizeAllergen handles legacy/junk values). Sync mapping carries it as a
plain string both directions (runToFormValues + formValuesToSettings).
Color badge renders wherever run identity shows (web run header, mobile run
navigator center); no badge when "none". Add new allergens to the lib first,
then both apps, to preserve parity.
