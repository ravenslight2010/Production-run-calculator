---
name: Allergen tracking
description: Per-run allergen field (free-form incl. custom) + advisory food-safety warnings, web+mobile parity.
---

Per-run allergen lives in shared pure lib `@workspace/allergen` (type, built-in
metadata incl. colors, normalizeAllergen, allergenMeta, allergenOptions,
allergenTransitionWarning, allergenSequenceWarnings). Both apps consume the lib;
never hardcode colors or warning copy in the apps.

**Allergen is FREE-FORM, not a closed None/Egg/Soy enum.** `Allergen` is `string`.
Built-ins (none/egg/soy) keep fixed colors/labels; any other token is a real
custom allergen (e.g. "milk", "tree nuts") imported from a spec sheet.
`normalizeAllergen` lowercases + collapses whitespace and maps none-spellings to
"none" but PRESERVES unknown tokens (never coerce a custom allergen to "none").
It ALSO collapses verbose built-in spellings ("egg allergen"/"soy allergen") onto
canonical "egg"/"soy" via BUILTIN_ALIASES so profiles/imports that stored the
verbose name don't render as a DUPLICATE custom chip alongside the built-in.
Built-in labels intentionally read "Egg Allergen"/"Soy Allergen" (egg yellow
#eab308, soy pink #db2777), so the surviving chip both says "allergen" and is
correctly colored. **Why:** user saw two Egg + two Soy chips (built-in short-label
correct color, plus verbose custom wrong hash color) and wanted one correctly
colored allergen chip. Combined forms like "soy & egg allergen" are NOT aliased
(no built-in) and remain custom by design.
`allergenMeta` derives a stable hash-palette color + contrast text + titleCase
label for customs. `allergenOptions(extra)` = built-ins ∪ deduped/sorted customs;
every picker (web import/run picker/SetupProfileEditor, mobile configure/
setup-profiles) feeds it the day's + profiles' custom allergens so they show up.

**Why free-form:** the spec-sheet importer must read whatever allergen the sheet
names, including values beyond egg/soy; a closed enum silently dropped them.

**Spec import path:** `@workspace/spec-import` ParsedProfile carries optional
`allergen` (lowercased, none-spellings dropped in sanitize); AI prompt schema in
aiParseSpecSheet.ts requests it. Apply guards `if (p.allergen)` so a blank never
clobbers. Add new allergens to the lib first, then both apps, to preserve parity.

**Scheduler must respect custom allergens end-to-end.** `ScheduleAllergen` is
`string` (web+mobile inventoryShared.ts); the aiSchedule.ts builders use
`normalizeAllergen` (the old local `normAllergen` coerced customs→"none" and was
removed). The `ScheduleOptimizeRunInput.allergen` OpenAPI field is plain
`type: string` (NOT `enum: [none, egg, soy]`) so the server's generated Zod
(`zod.string()`) accepts custom allergens instead of 400ing. `@workspace/schedule-optimize`
already computes allergenViolations via the shared allergen lib, so custom
allergens correctly get end-of-day sequencing. If you re-narrow any of these to a
closed enum, custom allergens silently lose food-safety sequencing.

**Warning rules:** allergen→different = "clean" (thoroughly clean line);
allergen→none = "clean-not-advisable" (clean + allergen runs belong at end of
day); none→anything and same→same = none. Warnings are advisory only, never block.

**How to apply:** allergen is client-only for STORAGE — server stores it inside
the opaque sync jsonb blob; do NOT add a db column for it. (The schedule-optimize
request body is the one place allergen crosses the wire as a typed field, and it
is free-form there too.) Default "none". Mobile stores it in RunSettings with
additive normalizeSettings coercion. Sync mapping carries it as a plain string
both directions. Color badge renders wherever run identity shows; no badge when
"none".
