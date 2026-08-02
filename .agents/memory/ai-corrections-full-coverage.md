---
name: AI corrections full coverage
description: How ai_corrections is wired to all AI routes and all rename/merge paths — architecture decision and coverage map.
---

## Rule
`groundPromptWithMemory` is the single place that loads and appends the corrections block. Every AI route that calls it automatically receives factory-wide name equivalences (merges + renames). Domain-targeted import/match AIs pass `correctionDomains: string[]`; general-purpose AIs omit it (all domains); intentionally un-grounded routes pass `correctionDomains: false`.

**Why:** Before this change, corrections were only loaded by 6 import/matching routes. Chat, optimize, alerts, summary, anomalies, schedule-optimize, forecast, mix-assistant, spec-reconcile, and mix-reconcile all received no correction context, so they could refer to old names the manager had already merged or renamed.

**How to apply:** When adding a new AI route, call `groundPromptWithMemory` (not `appendFacilityMemoryBlock` directly). Only use `appendFacilityMemoryBlock` directly when you also need the pre-loaded `knowledge` object for non-prompt purposes (e.g. accuracy calculations in forecast).

## Write-side coverage (client home.tsx)
Every rename/merge in home.tsx now writes `void saveAiCorrections([...])` best-effort. Domains used:
- `"brand"` — renameBrand, brand merges
- `"flavor"` — renameFlavor, flavor merges
- `"recipe"` — renameDoughRecipeName, renameFrontlineRecipeName, renameCheeseRecipeName, renameMixRecipeName, dough/sauce/cheese/mix recipe-name merges
- `"ingredient"` — renameDoughIngredient, renameFrontlineIngredient, renameCheeseIngredient, renameMixIngredient, renameIngredientType, renamePepType
- `"die"` — renameDieType

Ingredient merges already wrote corrections before this change.

## Parity gap
The archived mobile app (RunContext.tsx) has the same rename functions and does NOT write to ai_corrections. Not implemented since mobile is archived. Revisit when mobile is un-archived.

## New domain: "recipe"
"recipe" was added as a domain for recipe-name changes (dough, sauce, cheese, mixes). The `ai_corrections.domain` column is a free-form string — no schema change needed. The corrections block renders it as `- [recipe] "Old Name" => "New Name"`.
